import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowDown,Plus} from 'lucide-react';
import {useNavigate,useParams} from 'react-router-dom';
import {toast} from 'sonner';
import {DEFAULT_PROFILE} from '../agent/transport';
import {listThreads} from '../agent/repository';
import {useAgentSession} from '../agent/session';
import {useKernelState} from '../kernel/context';
import ChatComposer from '../components/ChatComposer';
import {Message} from '../components/chat/ChatMessage';
import {coalescePresentationMessages} from '../agent/presentation';
import {getAutoScroll,latestUserIndex,messageKey,newPinTracker,pinMessageToTop,trackLatestUserMessage} from '../agent/scroll';

const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:undefined;
const modelLabel=(model:string)=>model==='deepseek-v4-pro'?'V4 Pro':model==='deepseek-v4-flash'?'V4 Flash':model;
export default function ChatPage(){
 const s=useAgentSession(),kernel=useKernelState(),navigate=useNavigate(),{threadId}=useParams(),[routeError,setRouteError]=useState('');
 useEffect(()=>{let cancelled=false;if(kernel.status==='ready'&&threadId&&s.thread?.id!==threadId)void listThreads().then(all=>{if(cancelled)return;const found=all.find(t=>t.id===threadId);if(!found)throw new Error(`Thread not found: ${threadId}`);return s.openThread(found)}).then(()=>{if(!cancelled)setRouteError('')}).catch(e=>{if(!cancelled)setRouteError(String(e))});return()=>{cancelled=true;s.cancelOpen()}},[kernel.status,threadId,s.thread?.id,s.openThread,s.cancelOpen]);
 useEffect(()=>{if(s.streaming&&s.thread&&!threadId)navigate(`/chat/${s.thread.id}`,{replace:true})},[s.streaming,s.thread,threadId,navigate]);
 useEffect(()=>{if(!s.streaming||localStorage.getItem('gucos2:keep-awake')!=='true'||!('wakeLock'in navigator))return;let lock:WakeLockSentinel|undefined,cancelled=false;void navigator.wakeLock.request('screen').then(v=>{if(cancelled)void v.release();else lock=v}).catch(e=>toast.error(`Keep awake unavailable: ${String(e)}`));return()=>{cancelled=true;void lock?.release()}},[s.streaming]);
 const messages=useMemo(()=>coalescePresentationMessages(s.messages),[s.messages]),latestUsage=useMemo(()=>[...messages].reverse().find(m=>m.role==='assistant'&&m.usage)?.usage,[messages]),contextTokens=number(latestUsage?.input_tokens);
 // cc's scroll model (ported via c): when a NEW user message appears, pin it to
 // the top of the viewport once and let the answer stream in below — no bottom
 // following, so streamed growth and expansions never move a user who scrolled
 // away. The sticky preference lives in Settings; this page remounts on
 // navigation, so returning from Settings re-reads it. The tracker primes on
 // the first observation of each thread, so opening/reloading a populated
 // thread never scrolls — only a message appended after the baseline pins. The
 // transcript ends in a viewport-sized spacer so the last question can
 // actually reach the top even when the header/status/composer are unusually
 // short.
 const [autoScroll]=useState(getAutoScroll),pinTracker=useRef(newPinTracker());
 useEffect(()=>{const target=trackLatestUserMessage(pinTracker.current,s.thread?.id??null,messages);if(!autoScroll||!target)return;pinMessageToTop(target)},[messages,s.thread?.id,autoScroll]);
 const scrollToLatest=()=>{const idx=latestUserIndex(messages);if(idx!==-1)pinMessageToTop({index:idx,key:messageKey(messages[idx],idx)})};
 return <div className="relative flex min-h-0 flex-1 flex-col" data-testid="chat-page"><div className="flex items-center gap-2 border-b px-3 py-1.5"><span data-testid="endpoint-select" data-profile={s.profileId} title="AI endpoint (fixed)" className="flex h-8 shrink-0 items-center rounded-md border bg-muted/30 px-2 text-xs text-muted-foreground">{DEFAULT_PROFILE.label}</span><label className="sr-only" htmlFor="model-select">Model</label><select id="model-select" aria-label="Model" title={s.model} data-testid="model-select" value={s.model} disabled={s.streaming} onChange={e=>s.setModel(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2">{DEFAULT_PROFILE.models.map(m=><option key={m} value={m}>{modelLabel(m)}</option>)}</select>{contextTokens!==undefined&&<span className="hidden text-[10px] text-muted-foreground sm:inline" title="Latest provider input tokens">{contextTokens.toLocaleString()} ctx</span>}<button type="button" onClick={scrollToLatest} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground" title="Scroll to latest message" aria-label="Scroll to latest message" data-testid="scroll-to-latest-button"><ArrowDown className="size-3.5"/><span className="hidden sm:inline">Latest</span></button><button disabled={s.streaming} className="grid size-8 place-items-center rounded-md hover:bg-accent disabled:opacity-40" onClick={()=>{navigate('/chat');s.newThread()}} title="New thread" aria-label="New thread" data-testid="new-thread"><Plus className="size-4"/></button></div>
  {(s.profileError||routeError)&&<div role="alert" data-testid="profile-model-error" className="m-3 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">{s.profileError||routeError}</div>}
  <div className="flex-1 overflow-y-auto px-3 py-4" data-testid="chat-messages"><div className="mx-auto max-w-2xl space-y-4">{!messages.length&&<p className="py-12 text-center text-sm text-muted-foreground">Talk to the agent. It can read and edit gucOS files and run real processes.</p>}{messages.map((m,i)=><Message key={messageKey(m,i)} message={m} index={i}/>)}{s.error&&<div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive" data-testid="chat-error">{s.error}</div>}{messages.length>0&&<div className="min-h-[100dvh] shrink-0" data-testid="chat-scroll-spacer"/>}</div></div>
  <div aria-live="polite" role="status" className="min-h-6 border-t px-3 py-1 text-center text-xs text-muted-foreground" data-testid="turn-status">{s.status??(s.streaming?'Working…':'Ready')}</div><ChatComposer/>
 </div>
}
