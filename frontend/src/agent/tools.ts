import { gucFs } from '../fs/kernel-fs';
import { kernelClient } from '../kernel/kernel-client';
import { ensureParent, resolveAgentPath } from './workspace';

export const TOOL_LIMITS = {
  readByteDefault: 64 * 1024, readByteMax: 256 * 1024,
  readLineDefault: 200, readLineMax: 2000,
  readLineTextMax: 512,
  listDefault: 100, listMax: 1000,
  searchDefault: 100, searchMax: 500,
  searchTextMax: 1024,
  bashFdDefault: 64 * 1024, bashFdMax: 1024 * 1024,
  serializedResultMax: 2 * 1024 * 1024 + 64 * 1024,
} as const;
const IO_CHUNK = 64 * 1024;
const encoder = new TextEncoder(), decoder = new TextDecoder();

type Snapshot = { size: number; mtime_ms: number };
function integer(value: unknown, fallback: number, min: number, max: number, name: string): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return n;
}
function result(value: Record<string, unknown>): string { return serializeToolResult(value); }
function fitJsonString(text:string,budget:number):string{if(encoder.encode(JSON.stringify(text)).length<=budget)return text;let lo=0,hi=text.length;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(encoder.encode(JSON.stringify(text.slice(0,mid))).length<=budget)lo=mid;else hi=mid-1;}return text.slice(0,lo)}
export function serializeToolResult(value: unknown): string {
  let json: string;
  try { json = JSON.stringify(value); } catch { json = JSON.stringify({ ok: false, error: 'Tool result was not JSON-serializable' }); }
  if (encoder.encode(json).length <= TOOL_LIMITS.serializedResultMax) return json;
  return JSON.stringify({ ok: false, error: 'Tool result exceeded the serialization cap', cap_bytes: TOOL_LIMITS.serializedResultMax });
}

export class ReadState {
  private values = new Map<string, { size: number; mtimeMs: number }>();
  async mark(path: string): Promise<void> { const p = resolveAgentPath(path), s = await gucFs.stat(p); if (s) this.values.set(p, { size: s.size, mtimeMs: s.mtimeMs }); }
  // The marked {mtimeMs, size} for a path — fed to the kernel's ifUnchanged
  // write guard so the freshness check and the write are one atomic RPC
  // (requireUnchanged alone leaves a stat-to-write race).
  snapshot(path: string): { size: number; mtimeMs: number } | undefined { return this.values.get(resolveAgentPath(path)); }
  async requireUnchanged(path: string): Promise<void> {
    const p = resolveAgentPath(path), prior = this.values.get(p);
    if (!prior) throw new Error(`Read ${p} before modifying it`);
    const now = await gucFs.stat(p);
    if (!now || now.size !== prior.size || now.mtimeMs !== prior.mtimeMs) throw new Error(`${p} changed since it was read`);
  }
}

export const TOOL_DEFINITIONS = [
  { name: 'Read', description: `Read one explicit line or byte window. Defaults: 200 lines or 65536 bytes; maxima: ${TOOL_LIMITS.readLineMax} lines or ${TOOL_LIMITS.readByteMax} bytes. Line previews are capped at ${TOOL_LIMITS.readLineTextMax} characters; use byte mode for a deliberately huge line. Results include a stable file snapshot, has_more, and next_offset; repeat with that continuation to enumerate a large file without placing it all in one result.`, input_schema: { type: 'object', properties: { path: { type: 'string' }, unit: { type: 'string', enum: ['line','byte'] }, line_offset: { type: 'integer', minimum: 1 }, line_limit: { type: 'integer', minimum: 1, maximum: TOOL_LIMITS.readLineMax }, byte_offset: { type: 'integer', minimum: 0 }, byte_limit: { type: 'integer', minimum: 1, maximum: TOOL_LIMITS.readByteMax } }, required: ['path'], additionalProperties: false } },
  { name: 'List', description: `List a directory in stable name order using offset pagination. Default page ${TOOL_LIMITS.listDefault}, maximum ${TOOL_LIMITS.listMax}. Results report total, remaining, has_more, and next_offset; follow continuations to enumerate every entry exactly once.`, input_schema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: TOOL_LIMITS.listMax } }, required: ['path'], additionalProperties: false } },
  { name: 'Search', description: `Search UTF-8 file lines beneath a path, ordered by canonical path then line number, with offset pagination. Default page ${TOOL_LIMITS.searchDefault}, maximum ${TOOL_LIMITS.searchMax}. Results expose total/remaining/next_offset so repeated calls can enumerate every match without gaps or duplicates.`, input_schema: { type: 'object', properties: { path: { type: 'string' }, query: { type: 'string', maxLength: 4096 }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: TOOL_LIMITS.searchMax } }, required: ['path','query'], additionalProperties: false } },
  { name: 'Write', description: 'Create or overwrite a gucOS file after it has been read when it already exists. Creates parent directories.', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string', maxLength: TOOL_LIMITS.serializedResultMax } }, required: ['path', 'content'], additionalProperties: false } },
  { name: 'Edit', description: 'Replace one exact occurrence in a gucOS file after reading it; refuses stale or ambiguous edits.', input_schema: { type: 'object', properties: { path: { type: 'string' }, old_text: { type: 'string', maxLength: TOOL_LIMITS.serializedResultMax }, new_text: { type: 'string', maxLength: TOOL_LIMITS.serializedResultMax } }, required: ['path', 'old_text', 'new_text'], additionalProperties: false } },
  { name: 'Bash', description: `Run /bin/sh -c as a real gucOS process. Each call starts fresh in /root/agent. stdout and stderr are independently captured (default ${TOOL_LIMITS.bashFdDefault} bytes each, maximum ${TOOL_LIMITS.bashFdMax} each). Results preserve exit/signal facts and report per-fd captured/total bytes and truncation; use narrower follow-up commands or file pagination instead of requesting giant output.`, input_schema: { type: 'object', properties: { command: { type: 'string', maxLength: 131072 }, timeout_ms: { type: 'integer', minimum: 1, maximum: 600000 }, stdout_max_bytes: { type: 'integer', minimum: 0, maximum: TOOL_LIMITS.bashFdMax }, stderr_max_bytes: { type: 'integer', minimum: 0, maximum: TOOL_LIMITS.bashFdMax } }, required: ['command'], additionalProperties: false } },
] as const;

async function readLines(path: string, size: number, start: number, limit: number) {
  let byteOffset = 0, lineNumber = 1, pending = '', selected: { line: number; text: string }[] = [], hasMore = false;
  while (byteOffset < size && !hasMore) {
    const bytes = await gucFs.readRange(path, byteOffset, Math.min(IO_CHUNK, size - byteOffset)); byteOffset += bytes.length;
    pending += decoder.decode(bytes, { stream: byteOffset < size });
    const lines = pending.split('\n'); pending = lines.pop() ?? '';
    for (const text of lines) { if (lineNumber >= start && selected.length < limit) selected.push({ line: lineNumber, text: text.slice(0,TOOL_LIMITS.readLineTextMax), ...(text.length>TOOL_LIMITS.readLineTextMax?{text_truncated:true}: {}) }); else if (lineNumber >= start + limit) { hasMore = true; break; } lineNumber++; }
  }
  if (!hasMore && pending.length) { if (lineNumber >= start && selected.length < limit) selected.push({ line: lineNumber, text: pending.slice(0,TOOL_LIMITS.readLineTextMax), ...(pending.length>TOOL_LIMITS.readLineTextMax?{text_truncated:true}: {}) }); else if (lineNumber >= start + limit) hasMore = true; }
  return { selected, hasMore, next: hasMore ? start + selected.length : null };
}
async function allFiles(path: string): Promise<string[]> {
  const stat = await gucFs.stat(path); if (!stat) throw new Error(`Search ${path}: not found`); if (stat.kind === 'file') return [path];
  const out: string[] = [], entries = (await gucFs.list(path)).slice().sort((a,b)=>a.name.localeCompare(b.name));
  for (const entry of entries) { const child = `${path==='/'?'':path}/${entry.name}`; if (entry.kind === 'file') out.push(child); else out.push(...await allFiles(child)); }
  return out;
}

export async function runTool(name: string, input: Record<string, unknown>, reads: ReadState, signal?: AbortSignal): Promise<string> {
  if (name === 'Read') {
    const path = resolveAgentPath(String(input.path)), stat = await gucFs.stat(path); if (!stat || stat.kind !== 'file') throw new Error(`Read ${path}: not a file`);if((stat.mode&0o170000)===0o120000)throw new Error(`Read ${path}: symbolic links are refused; use the canonical target path`);
    const snapshot: Snapshot = { size: stat.size, mtime_ms: stat.mtimeMs }, unit = input.unit === 'byte' ? 'byte' : 'line'; await reads.mark(path);
    if (unit === 'byte') { const offset=integer(input.byte_offset??input.offset,0,0,Number.MAX_SAFE_INTEGER,'byte_offset'),limit=integer(input.byte_limit??input.limit,TOOL_LIMITS.readByteDefault,1,TOOL_LIMITS.readByteMax,'byte_limit'), bytes=await gucFs.readRange(path,offset,Math.min(limit,Math.max(0,stat.size-offset))), next=offset+bytes.length, hasMore=next<stat.size; return result({ok:true,path,unit,offset,limit,snapshot,data:decoder.decode(bytes),captured_bytes:bytes.length,has_more:hasMore,next_offset:hasMore?next:null,remaining_bytes:Math.max(0,stat.size-next)}); }
    const offset=integer(input.line_offset??input.offset,1,1,Number.MAX_SAFE_INTEGER,'line_offset'),limit=integer(input.line_limit??input.limit,TOOL_LIMITS.readLineDefault,1,TOOL_LIMITS.readLineMax,'line_limit'), page=await readLines(path,stat.size,offset,limit);
    return result({ok:true,path,unit,offset,limit,snapshot,lines:page.selected,returned:page.selected.length,has_more:page.hasMore,next_offset:page.next});
  }
  if (name === 'List') {
    const path=resolveAgentPath(String(input.path)),offset=integer(input.offset,0,0,Number.MAX_SAFE_INTEGER,'offset'),limit=integer(input.limit,TOOL_LIMITS.listDefault,1,TOOL_LIMITS.listMax,'limit');
    const entries=(await gucFs.list(path)).slice().sort((a,b)=>a.name.localeCompare(b.name)), page=entries.slice(offset,offset+limit), next=offset+page.length;
    return result({ok:true,path,ordering:'name-ascending',offset,limit,entries:page,total:entries.length,returned:page.length,remaining:Math.max(0,entries.length-next),has_more:next<entries.length,next_offset:next<entries.length?next:null});
  }
  if (name === 'Search') {
    const path=resolveAgentPath(String(input.path)),query=String(input.query??''); if (!query || query.length>4096) throw new Error('query length must be 1..4096');
    const offset=integer(input.offset,0,0,Number.MAX_SAFE_INTEGER,'offset'),limit=integer(input.limit,TOOL_LIMITS.searchDefault,1,TOOL_LIMITS.searchMax,'limit'), matches:{path:string;line:number;text:string}[]=[];
    for(const file of await allFiles(path)){const stat=await gucFs.stat(file);if(!stat)continue;if((stat.mode&0o170000)===0o120000)throw new Error(`Search ${file}: symbolic links are refused; use the canonical target path`);let pos=0,pending='',line=1;while(pos<stat.size){const b=await gucFs.readRange(file,pos,Math.min(IO_CHUNK,stat.size-pos));pos+=b.length;pending+=decoder.decode(b,{stream:pos<stat.size});const lines=pending.split('\n');pending=lines.pop()??'';for(const text of lines){if(text.includes(query))matches.push({path:file,line,text:text.slice(0,TOOL_LIMITS.searchTextMax)});line++;}}if(pending.includes(query))matches.push({path:file,line,text:pending.slice(0,TOOL_LIMITS.searchTextMax)});}
    const page=matches.slice(offset,offset+limit),next=offset+page.length;return result({ok:true,path,query,ordering:'path-ascending,line-ascending',offset,limit,matches:page,total:matches.length,returned:page.length,remaining:Math.max(0,matches.length-next),has_more:next<matches.length,next_offset:next<matches.length?next:null});
  }
  if (name === 'Write') { const path=resolveAgentPath(String(input.path));const st=await gucFs.stat(path);if(st)await reads.requireUnchanged(path);await ensureParent(path);await gucFs.write(path,String(input.content),st?{ifUnchanged:reads.snapshot(path)}:{exclusive:true});await reads.mark(path);return result({ok:true,path,written_bytes:encoder.encode(String(input.content)).length}); }
  if (name === 'Edit') { const path=resolveAgentPath(String(input.path));await reads.requireUnchanged(path);const text=await gucFs.readText(path),oldText=String(input.old_text),at=text.indexOf(oldText);if(at<0)throw new Error('old_text was not found');if(text.indexOf(oldText,at+1)>=0)throw new Error('old_text is not unique');await gucFs.write(path,text.slice(0,at)+String(input.new_text)+text.slice(at+oldText.length),{ifUnchanged:reads.snapshot(path)});await reads.mark(path);return result({ok:true,path}); }
  if (name === 'Bash') {
    const stdoutMax=integer(input.stdout_max_bytes,TOOL_LIMITS.bashFdDefault,0,TOOL_LIMITS.bashFdMax,'stdout_max_bytes'),stderrMax=integer(input.stderr_max_bytes,TOOL_LIMITS.bashFdDefault,0,TOOL_LIMITS.bashFdMax,'stderr_max_bytes');let stdout='',stderr='',stdoutBytes=0,stderrBytes=0;const stdoutDecoder=new TextDecoder(),stderrDecoder=new TextDecoder();
    const run=await kernelClient.exec(String(input.command),{timeoutMs:input.timeout_ms===undefined?undefined:Number(input.timeout_ms),signal,onOutput(fd,chunk){const used=fd==='stdout'?stdoutBytes:stderrBytes,max=fd==='stdout'?stdoutMax:stderrMax,keep=chunk.slice(0,Math.max(0,max-used));if(fd==='stdout'){stdout+=stdoutDecoder.decode(keep,{stream:true});stdoutBytes+=keep.length}else{stderr+=stderrDecoder.decode(keep,{stream:true});stderrBytes+=keep.length}}});const exit=await run.completed;stdout+=stdoutDecoder.decode();stderr+=stderrDecoder.decode();const stringBudget=Math.floor((TOOL_LIMITS.serializedResultMax-65536)/2);stdout=fitJsonString(stdout,stringBudget);stderr=fitJsonString(stderr,stringBudget);stdoutBytes=encoder.encode(stdout).length;stderrBytes=encoder.encode(stderr).length;
    return result({ok:true,pid:run.start.pid,pgid:run.start.pgid,cwd:'/root/agent',stdout,stderr,stdout_captured_bytes:stdoutBytes,stdout_total_bytes:exit.stdoutTotalBytes,stdout_truncated:exit.stdoutTotalBytes>stdoutBytes,stderr_captured_bytes:stderrBytes,stderr_total_bytes:exit.stderrTotalBytes,stderr_truncated:exit.stderrTotalBytes>stderrBytes,exit_code:exit.status,signal:exit.signal,cause:exit.cause,escalated:exit.escalated,leaked_pids:exit.leakedPids});
  }
  throw new Error(`Unknown tool: ${name}`);
}
