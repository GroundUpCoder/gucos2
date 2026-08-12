import {afterEach,describe,expect,it,vi} from 'vitest';
import {resolveAgentPath} from './workspace';
import {DEFAULT_PROFILE,keyStorageName,streamMessages,validateProfile} from './transport';

describe('agent invariants',()=>{
 it('resolves relative, tilde, absolute, and dot segments canonically',()=>{expect(resolveAgentPath('src/../a.c')).toBe('/root/agent/a.c');expect(resolveAgentPath('~/.guc/agent/index.json')).toBe('/root/.guc/agent/index.json');expect(resolveAgentPath('/tmp/../root/agent/x')).toBe('/root/agent/x')});
 it('rejects every supported credential header and exposes both DeepSeek v4 choices',()=>{for(const name of ['Authorization','x-api-key','xi-api-key','api-key','Cookie'])expect(()=>validateProfile({...DEFAULT_PROFILE,headers:{[name]:'secret'}})).toThrow('forbidden');expect(DEFAULT_PROFILE.models).toEqual(['deepseek-v4-pro','deepseek-v4-flash'])});
 it('uses browser-local key and parses deterministic chunk-split streaming',async()=>{const values=new Map([[keyStorageName('deepseek'),'browser-secret']]);vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null});const enc=new TextEncoder(),parts=['event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n','event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\nevent: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n'];let body='';vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{body=String(init.body);return new Response(new ReadableStream({start(c){for(const p of parts)c.enqueue(enc.encode(p));c.close()}}),{status:200})}));const got=await streamMessages(DEFAULT_PROFILE,'deepseek-v4-pro',[],[],new AbortController().signal);expect(got.content).toEqual([{type:'text',text:'hello'}]);expect(got.stop_reason).toBe('end_turn');expect(body).not.toContain('browser-secret')});
 it('sends an exact recovered signed-thinking block in the next provider body',async()=>{
  const signature='signed:AAECAwQFBgcICQ==',thinking='durable private reasoning';
  vi.stubGlobal('localStorage',{getItem:()=> 'browser-secret'});
  let request:Record<string,unknown>|undefined;
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
   request=JSON.parse(String(init.body));
   return new Response('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',{status:200});
  }));
  const recovered=[{role:'assistant',content:[{type:'thinking',thinking,signature}]}];
  await streamMessages(DEFAULT_PROFILE,'deepseek-v4-pro',recovered,[],new AbortController().signal);
  expect(request?.messages).toEqual(recovered);
 });
 it('puts the explicitly selected flash model in the provider body',async()=>{vi.stubGlobal('localStorage',{getItem:()=> 'browser-secret'});let request:Record<string,unknown>|undefined;vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{request=JSON.parse(String(init.body));return new Response('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',{status:200})}));await streamMessages(DEFAULT_PROFILE,'deepseek-v4-flash',[],[],new AbortController().signal);expect(request?.model).toBe('deepseek-v4-flash')});
});
afterEach(()=>vi.unstubAllGlobals());
