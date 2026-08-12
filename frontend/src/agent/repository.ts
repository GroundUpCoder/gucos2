import { gucFs } from '../fs/kernel-fs';
import { kernelClient } from '../kernel/kernel-client';
import { ensureAgentWorkspace, STATE_ROOT, THREADS_ROOT } from './workspace';

export type RecordType = 'thread_meta'|'thread_update'|'turn_start'|'message'|'api_round'|'tool_result'|'turn_end';
export type JournalRecord = { schema_version: 1; thread_id: string; seq: number; timestamp: string; type: RecordType|string; [key: string]: unknown };
export type ThreadSummary = { id: string; path: string; title: string; model: string; endpoint_profile_id: string; createdAt: string; updatedAt: string; archived?:boolean; pinned?:boolean; journalSize?: number; corrupt?: string };
export type DisplayMessage={role:'user'|'assistant';content:unknown;createdAt?:string;threadId?:string;recordSeq?:number;model?:string;stopReason?:string|null;usage?:Record<string,unknown>;durationMs?:number;round?:number;toolCount?:number;id?:string};
export type Replay = { records: JournalRecord[]; warnings: string[]; interrupted: boolean; providerMessages: unknown[]; displayMessages:DisplayMessage[] };

const encoder = new TextEncoder();
const queues = new Map<string, Promise<void>>();
const seqs = new Map<string, number>();

function enqueue(path: string, op: () => Promise<void>): Promise<void> {
  const prior = queues.get(path) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(op);
  queues.set(path, next); void next.finally(() => { if (queues.get(path) === next) queues.delete(path); });
  return next;
}

export async function createThread(profileId: string, model: string, title = 'New thread', now = new Date()): Promise<ThreadSummary> {
  await ensureAgentWorkspace();
  const id = crypto.randomUUID(), stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14), path = `${THREADS_ROOT}/${stamp}_${id}.jsonl`;
  const summary = { id, path, title, model, endpoint_profile_id: profileId, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  seqs.set(path, 0);
  await appendRecord(summary, 'thread_meta', { title, model, endpoint_profile_id: profileId, created_at: summary.createdAt });
  return summary;
}

export async function appendRecord(thread: Pick<ThreadSummary,'id'|'path'>, type: RecordType, fields: Record<string, unknown>): Promise<JournalRecord> {
  let record!: JournalRecord;
  await enqueue(thread.path, async () => {
    let seq = seqs.get(thread.path);
    if (seq === undefined) { const replay = await replayJournal(thread.path); seq = replay.records.at(-1)?.seq ?? 0; }
    record = { schema_version: 1, thread_id: thread.id, seq: seq + 1, timestamp: new Date().toISOString(), type, ...fields };
    await kernelClient.append(thread.path, encoder.encode(`${JSON.stringify(record)}\n`), 0o600, true);
    seqs.set(thread.path, record.seq);
  });
  return record;
}

export async function replayJournal(path: string): Promise<Replay> {
  const stat = await gucFs.stat(path); if (!stat) throw new Error(`journal not found: ${path}`);
  const decoder = new TextDecoder('utf-8', { fatal: true }); let offset = 0, pending = '', lineNo = 0;
  const records: JournalRecord[] = [], warnings: string[] = [];
  while (offset < stat.size) {
    const bytes = await gucFs.readRange(path, offset, Math.min(1024 * 1024, stat.size - offset)); offset += bytes.length;
    pending += decoder.decode(bytes, { stream: offset < stat.size });
    const lines = pending.split('\n'); pending = lines.pop() ?? '';
    for (const line of lines) parseLine(line, false);
  }
  if (pending) parseLine(pending, true);
  function parseLine(line: string, tail: boolean) {
    lineNo++; if (!line) return;
    try { records.push(JSON.parse(line) as JournalRecord); }
    catch (error) { warnings.push(`${tail ? 'Discarded torn final fragment' : `Malformed middle record at line ${lineNo}`}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (!records.length || records[0].type !== 'thread_meta') warnings.push('Missing first thread_meta record');
  for (let i = 0; i < records.length; i++) {
    if (records[i].seq !== i + 1) warnings.push(`Sequence gap at record ${i + 1}: found ${records[i].seq}`);
  }
  const providerMessages: unknown[] = [],displayMessages:DisplayMessage[]=[], pendingTools = new Map<string, Record<string, unknown>>(), results = new Map<string, JournalRecord>();
  let pendingToolStamp:string|undefined;
  const flushResults = (aggregateStamp?:string) => {
    if (!pendingTools.size) return;
    const providerContent: Record<string,unknown>[] = [],displayContent:Record<string,unknown>[]=[];
    pendingTools.forEach((_use,id) => {
      const durable = results.get(id);
      const status=durable?(typeof durable.status==='string'?durable.status:'completed'):'not_run',content=durable?String(durable.content??''):'Interrupted before tool execution completed',isError=!durable||durable.is_error===true||status!=='completed';
      providerContent.push({type:'tool_result',tool_use_id:id,content,...(isError?{is_error:true}:{})});
      displayContent.push({type:'tool_result',tool_use_id:id,content,status,...(isError?{is_error:true}:{})});
    });
    const resultStamp=[...results.values()].at(-1)?.timestamp;
    const lastResult=[...results.values()].at(-1);providerMessages.push({role:'user',content:providerContent});displayMessages.push({role:'user',content:displayContent,createdAt:aggregateStamp??resultStamp??pendingToolStamp,threadId:lastResult?.thread_id,recordSeq:lastResult?.seq}); pendingTools.clear(); results.clear();pendingToolStamp=undefined;
  };
  for (const r of records) {
    if (r.type === 'message' && r.wire_message) {
      const message=r.wire_message as {role?:string;content?:unknown};
      const content=Array.isArray(message.content)?message.content:[];
      const aggregate=message.role==='user'&&content.length>0&&content.every(b=>b&&typeof b==='object'&&(b as {type?:string}).type==='tool_result');
      if (aggregate) { flushResults(r.timestamp); continue; }
      if (pendingTools.size) flushResults();
      providerMessages.push(r.wire_message);displayMessages.push({role:message.role==='assistant'?'assistant':'user',content:message.content??'',createdAt:r.timestamp,threadId:r.thread_id,recordSeq:r.seq,model:typeof r.model==='string'?r.model:undefined,stopReason:typeof r.stop_reason==='string'?r.stop_reason:null,usage:r.usage&&typeof r.usage==='object'?r.usage as Record<string,unknown>:undefined,durationMs:typeof r.duration_ms==='number'?r.duration_ms:undefined,round:typeof r.round==='number'?r.round:undefined,toolCount:typeof r.tool_count==='number'?r.tool_count:undefined,id:typeof r.turn_id==='string'?r.turn_id:undefined});
      if (message.role==='assistant') for(const b of content) if(b&&typeof b==='object'&&(b as {type?:string}).type==='tool_use'){pendingTools.set(String((b as {id?:unknown}).id),b as Record<string,unknown>);pendingToolStamp=r.timestamp}
    } else if (r.type === 'tool_result') {
      const id = String(r.tool_use_id ?? '');
      if (!pendingTools.has(id)) warnings.push(`Dropped orphan tool result ${id}`); else results.set(id,r);
    }
  }
  flushResults();
  let unmatchedTurns = 0;
  for (const record of records) {
    if (record.type === 'turn_start') unmatchedTurns++;
    else if (record.type === 'turn_end' && unmatchedTurns > 0) unmatchedTurns--;
  }
  const interrupted = unmatchedTurns > 0;
  if (interrupted) warnings.push('Interrupted turn (missing turn_end)');
  return { records, warnings, interrupted, providerMessages,displayMessages };
}

export async function rebuildIndex(): Promise<ThreadSummary[]> {
  await ensureAgentWorkspace(); const entries = await gucFs.list(THREADS_ROOT), summaries: ThreadSummary[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.jsonl')) continue;
    const path = `${THREADS_ROOT}/${entry.name}`;
    try {
      const replay = await replayJournal(path), meta = replay.records[0],updates=replay.records.filter(r=>r.type==='thread_update'),latest=Object.assign({},...updates);
      summaries.push({ id: String(meta?.thread_id ?? entry.name), path, title: String(latest.title??meta?.title ?? entry.name), model: String(latest.model??meta?.model ?? ''), endpoint_profile_id: String(meta?.endpoint_profile_id ?? ''), createdAt: String(meta?.created_at ?? meta?.timestamp ?? ''), updatedAt: String(replay.records.at(-1)?.timestamp ?? meta?.timestamp ?? ''),archived:latest.archived===true,pinned:latest.pinned===true, journalSize:entry.size, ...(replay.warnings.some(w => w.startsWith('Malformed middle') || w.startsWith('Sequence')) ? { corrupt: replay.warnings.join('; ') } : {}) });
    } catch (error) { summaries.push({ id: entry.name, path, title: entry.name, model: '', endpoint_profile_id: '', createdAt: '', updatedAt: '', corrupt: error instanceof Error ? error.message : String(error) }); }
  }
  summaries.sort((a,b) => Number(!!b.pinned)-Number(!!a.pinned)||b.updatedAt.localeCompare(a.updatedAt));
  await gucFs.write(`${STATE_ROOT}/index.json`, JSON.stringify({ schema_version: 1, rebuilt_at: new Date().toISOString(), threads: summaries }, null, 2));
  return summaries;
}

export async function listThreads():Promise<ThreadSummary[]>{
  await ensureAgentWorkspace();
  try { const raw=await gucFs.readText(`${STATE_ROOT}/index.json`),parsed=JSON.parse(raw) as {threads?:ThreadSummary[]};if(Array.isArray(parsed.threads)){const entries=(await gucFs.list(THREADS_ROOT)).filter(e=>e.kind==='file'&&e.name.endsWith('.jsonl'));const sizes=new Map(entries.map(e=>[`${THREADS_ROOT}/${e.name}`,e.size]));if(parsed.threads.length===entries.length&&parsed.threads.every(t=>sizes.get(t.path)===t.journalSize))return parsed.threads;} } catch { /* disposable cache: rebuild */ }
  return rebuildIndex();
}
export async function deleteThread(thread: ThreadSummary): Promise<void> { await enqueue(thread.path,async()=>{await gucFs.remove(thread.path);seqs.delete(thread.path)});queues.delete(thread.path);await rebuildIndex(); }
export async function updateThread(thread:ThreadSummary,patch:{title?:string;archived?:boolean;pinned?:boolean;model?:string}){const record=await appendRecord(thread,'thread_update',patch);try{const raw=await gucFs.readText(`${STATE_ROOT}/index.json`),index=JSON.parse(raw) as {schema_version?:number;threads?:ThreadSummary[]};if(!Array.isArray(index.threads))throw new Error('index has no threads');const at=index.threads.findIndex(item=>item.id===thread.id);if(at<0)throw new Error('thread is absent from index');const stat=await gucFs.stat(thread.path);if(!stat)throw new Error('thread journal disappeared');index.threads[at]={...index.threads[at],...patch,updatedAt:record.timestamp,journalSize:stat.size};index.threads.sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||b.updatedAt.localeCompare(a.updatedAt));await gucFs.write(`${STATE_ROOT}/index.json`,JSON.stringify({...index,rebuilt_at:new Date().toISOString()},null,2))}catch{await rebuildIndex()}}
export async function forkThread(thread:ThreadSummary){
 const replay=await replayJournal(thread.path),fork=await createThread(thread.endpoint_profile_id,thread.model,`${thread.title} (fork)`);
 for(const source of replay.records.slice(1)){const {schema_version:_schema,thread_id:_thread,seq:_seq,type,...fields}=source;await appendRecord(fork,type as RecordType,fields)}
 await appendRecord(fork,'thread_update',{title:`${thread.title} (fork)`,model:thread.model,archived:false,pinned:false});await rebuildIndex();return fork
}
function searchableText(value:unknown):string{if(typeof value==='string')return value;if(Array.isArray(value))return value.map(searchableText).join('\n');if(!value||typeof value!=='object')return '';const record=value as Record<string,unknown>;if(record.type==='image')return [record.alt,record.name,(record.source as Record<string,unknown>|undefined)?.media_type].map(searchableText).join('\n');return Object.entries(record).filter(([key])=>!['schema_version','thread_id','seq','signature'].includes(key)).map(([,item])=>searchableText(item)).join('\n')}
export function searchableJournalText(records:JournalRecord[]){return searchableText(records)}
export async function searchThreads(query:string){const needle=query.trim().toLocaleLowerCase(),threads=await listThreads();if(!needle)return threads;const out:ThreadSummary[]=[];for(const thread of threads){if(thread.title.toLocaleLowerCase().includes(needle)){out.push(thread);continue}try{const replay=await replayJournal(thread.path);if(searchableJournalText(replay.records).toLocaleLowerCase().includes(needle))out.push(thread)}catch{/* corrupt is already surfaced by index */}}return out}
