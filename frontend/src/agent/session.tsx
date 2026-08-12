import {createContext,useCallback,useContext,useRef,useState} from 'react';
import {appendRecord,createThread,replayJournal,updateThread,type ThreadSummary,type DisplayMessage} from './repository';
import {DEFAULT_PROFILE,streamMessages} from './transport';
import {ReadState,runTool,serializeToolResult,TOOL_DEFINITIONS} from './tools';
import {ensureAgentWorkspace} from './workspace';

export type ImageAttachment={mediaType:string;data:string;name:string};
export type ChatMessage=DisplayMessage&{error?:boolean;streaming?:boolean;streamId?:string;id?:string;activeBlockCount?:number};
type Session={messages:ChatMessage[];streaming:boolean;status:string|null;thread:ThreadSummary|null;model:string;profileId:string;profileError:string|null;error:string|null;setModel(v:string):void;send(text:string,images?:ImageAttachment[]):Promise<void>;stop():void;newThread():void;cancelOpen():void;openThread(thread:ThreadSummary):Promise<void>};
const Context=createContext<Session|null>(null);
export const useAgentSession=()=>{const value=useContext(Context);if(!value)throw new Error('AgentSessionProvider missing');return value};
export const SYSTEM_PROMPT=`You are the gucOS browser agent. Use only the modern Read, List, Search, Write, Edit, and Bash tools. gucOS provides BusyBox hush at /bin/sh. Every Bash call is a new real process in /root/agent with a fixed minimal environment; cwd and exports do not persist. Relative file paths also resolve from /root/agent. Read before overwriting or editing. Tool output is deliberately bounded: follow has_more and next_offset repeatedly when complete enumeration is needed, and use narrower Bash follow-ups when either fd is truncated. Never ask one call to dump a large file, directory, search set, or command output. Never request or expose API keys.`;

export function AgentSessionProvider({children}:{children:React.ReactNode}){
 const stored=localStorage.getItem('gucos2:model')??DEFAULT_PROFILE.models[0];
 const [messages,setMessages]=useState<ChatMessage[]>([]),[streaming,setStreaming]=useState(false),[status,setStatus]=useState<string|null>(null),[thread,setThread]=useState<ThreadSummary|null>(null),[model,setModelState]=useState(stored),[profileId,setProfileId]=useState(DEFAULT_PROFILE.id),[error,setError]=useState<string|null>(null);
 const abortRef=useRef<AbortController|null>(null),reads=useRef(new ReadState()),running=useRef(false),navigationVersion=useRef(0);
 const profileError=profileId!==DEFAULT_PROFILE.id?`Endpoint profile is unavailable: ${profileId}`:!DEFAULT_PROFILE.models.includes(model)?`${model} is not supported by endpoint ${DEFAULT_PROFILE.label}`:null;
 const setModel=useCallback((value:string)=>{
  if(!DEFAULT_PROFILE.models.includes(value)){setError(`${value} is not supported by endpoint ${DEFAULT_PROFILE.label}`);return}
  setModelState(value);localStorage.setItem('gucos2:model',value);
  if(thread){const next={...thread,model:value};setThread(next);void updateThread(next,{model:value}).catch(e=>setError(String(e)))}
 },[thread]);
 const stop=useCallback(()=>abortRef.current?.abort(new Error('Stopped by user')),[]);
 const newThread=useCallback(()=>{if(running.current){setError('Stop the running turn before starting a new thread');return}navigationVersion.current++;setThread(null);setMessages([]);setError(null);setProfileId(DEFAULT_PROFILE.id);reads.current=new ReadState()},[]);
 const cancelOpen=useCallback(()=>{navigationVersion.current++},[]);
 const openThread=useCallback(async(next:ThreadSummary)=>{if(running.current)throw new Error('Cannot open a thread during a running turn');const version=++navigationVersion.current,replay=await replayJournal(next.path);if(version!==navigationVersion.current)return;setThread(next);setProfileId(next.endpoint_profile_id);setModelState(next.model);localStorage.setItem('gucos2:model',next.model);setMessages(replay.displayMessages);setError(replay.warnings.join('; ')||null);reads.current=new ReadState()},[]);
 const send=useCallback(async(text:string,images:ImageAttachment[]=[] )=>{
  if(running.current)return;if(!text.trim()&&!images.length)return;if(profileError){setError(profileError);return}
  running.current=true;setStreaming(true);setStatus('Preparing turn…');setError(null);const abort=new AbortController();abortRef.current=abort;let active=thread,turnEnded=false,activeStreamId:string|null=null,turnId=crypto.randomUUID();
  try{
   await ensureAgentWorkspace();if(!active){active=await createThread(profileId,model,text.trim().replace(/\s+/g,' ').slice(0,64));setThread(active)}
   await appendRecord(active,'turn_start',{});const userContent:unknown=images.length?[...(text.trim()?[{type:'text',text}]:[]),...images.map(image=>({type:'image',source:{type:'base64',media_type:image.mediaType,data:image.data}}))]:text,user={role:'user' as const,content:userContent},userRecord=await appendRecord(active,'message',{wire_message:user});setMessages(v=>[...v,{...user,createdAt:userRecord.timestamp,threadId:userRecord.thread_id,recordSeq:userRecord.seq}]);
   const replay=await replayJournal(active.path),wire=[...replay.providerMessages];
   for(let round=1;round<=24;round++){
    const streamId=crypto.randomUUID(),roundStarted=Date.now(),createdAt=new Date().toISOString();activeStreamId=streamId;setStatus(round===1?'Generating response…':`Continuing agent round ${round}…`);setMessages(v=>[...v,{role:'assistant',content:[{type:'text',text:''}],streaming:true,streamId,createdAt,model,round,id:turnId}]);
    const custom=localStorage.getItem('gucos2:custom-instructions')?.trim();
    const system=[SYSTEM_PROMPT,custom?`User instructions:\n${custom}`:''].filter(Boolean).join('\n\n');
    const result=await streamMessages(DEFAULT_PROFILE,model,wire,[...TOOL_DEFINITIONS],abort.signal,{onUpdate(blocks){setMessages(v=>v.map(m=>m.streamId===streamId?{...m,content:blocks}:m))}},system);
    const durationMs=Date.now()-roundStarted,calls=result.content.filter(b=>b.type==='tool_use') as {id:string;name:string;input:Record<string,unknown>}[],assistantMessage:ChatMessage={role:'assistant',content:result.content,createdAt,model,stopReason:result.stop_reason,usage:result.usage,durationMs,round,toolCount:calls.length,id:turnId},assistant={role:'assistant' as const,content:result.content};wire.push(assistant);
    await appendRecord(active,'api_round',{round,model,stop_reason:result.stop_reason,usage:result.usage,content:result.content,duration_ms:durationMs});const assistantRecord=await appendRecord(active,'message',{wire_message:assistant,model,stop_reason:result.stop_reason,usage:result.usage,content:result.content,duration_ms:durationMs,round,tool_count:calls.length,turn_id:turnId});setMessages(v=>v.map(m=>m.streamId===streamId?{...assistantMessage,createdAt:assistantRecord.timestamp,threadId:assistantRecord.thread_id,recordSeq:assistantRecord.seq}:m));activeStreamId=null;
    if(!calls.length){await appendRecord(active,'turn_end',{status:'completed'});turnEnded=true;break}
    const toolBlocks:Record<string,unknown>[]=[];
    for(let i=0;i<calls.length;i++){
     const call=calls[i];setStatus(`Running ${call.name}…`);if(abort.signal.aborted){for(const rest of calls.slice(i)){const block={type:'tool_result',tool_use_id:rest.id,is_error:true,status:'not_run',content:'Not run: turn stopped'};toolBlocks.push(block);await appendRecord(active,'tool_result',{...block,tool_name:rest.name})}break}
     try{const content=serializeToolResult(JSON.parse(await runTool(call.name,call.input,reads.current,abort.signal))),wasAborted=abort.signal.aborted,block={type:'tool_result',tool_use_id:call.id,...(wasAborted?{is_error:true}:{}),status:wasAborted?'aborted':'completed',content};toolBlocks.push(block);await appendRecord(active,'tool_result',{...block,tool_name:call.name})}
     catch(e){const status=abort.signal.aborted?'aborted':'error',content=serializeToolResult({ok:false,error:(e instanceof Error?e.message:String(e)).slice(0,65536)}),block={type:'tool_result',tool_use_id:call.id,is_error:true,status,content};toolBlocks.push(block);await appendRecord(active,'tool_result',{...block,tool_name:call.name})}
    }
    const tools={role:'user' as const,content:toolBlocks};wire.push(tools);const toolsRecord=await appendRecord(active,'message',{wire_message:tools});setMessages(v=>[...v,{...tools,createdAt:toolsRecord.timestamp}]);
    if(abort.signal.aborted){await appendRecord(active,'turn_end',{status:'aborted'});turnEnded=true;break}if(round===24)throw new Error('Agent exceeded 24 API rounds');
   }
  }catch(e){if(activeStreamId)setMessages(v=>v.filter(m=>m.streamId!==activeStreamId));const message=e instanceof Error?e.message:String(e);setError(message);if(active&&!turnEnded)try{await appendRecord(active,'turn_end',{status:abort.signal.aborted?'aborted':'error',error:message})}catch{/* original remains visible */}}
  finally{if(activeStreamId)setMessages(v=>v.filter(m=>m.streamId!==activeStreamId));running.current=false;abortRef.current=null;setStreaming(false);setStatus(null)}
 },[thread,model,profileId,profileError]);
 return <Context.Provider value={{messages,streaming,status,thread,model,profileId,profileError,error,setModel,send,stop,newThread,cancelOpen,openThread}}>{children}</Context.Provider>
}
