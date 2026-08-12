import type {ChatMessage} from './session';

const blocks=(content:unknown)=>Array.isArray(content)?content:typeof content==='string'?[{type:'text',text:content}]:[];
const pureResults=(message:ChatMessage)=>message.role==='user'&&blocks(message.content).length>0&&blocks(message.content).every(block=>block&&typeof block==='object'&&(block as {type?:unknown}).type==='tool_result');
const addUsage=(left:Record<string,unknown>|undefined,right:Record<string,unknown>|undefined)=>{if(!left)return right;if(!right)return left;const out={...left};for(const[key,value]of Object.entries(right))out[key]=typeof value==='number'&&typeof out[key]==='number'?(out[key] as number)+value:value;return out};

/** One authored user message starts one visible turn. Provider rounds and their
 * durable tool-result user messages fold into a single assistant presentation,
 * preserving raw text boundaries while grouping every consecutive non-text run. */
export function coalescePresentationMessages(messages:ChatMessage[]):ChatMessage[]{
 const out:ChatMessage[]=[];
 for(const message of messages){
  const prior=out.at(-1);
  if(pureResults(message)&&prior?.role==='assistant'){
   out[out.length-1]={...prior,content:[...blocks(prior.content),...blocks(message.content)]};continue;
  }
  if(message.role==='assistant'&&prior?.role==='assistant'){
   // `id` is the stable logical-turn identity (turnId): every provider round of
   // one authored turn shares it, so the coalesced article keeps one identity
   // across streaming → finalize → next round → final. `streamId` is the
   // per-round update handle (newest wins) and is NOT the React key.
   // `activeBlockCount` counts the trailing blocks that belong to the round
   // currently streaming (message.streaming); only those are "active", which
   // styles the newest thinking card as streaming (violet pulse + "Thinking…").
   // It never auto-opens anything — disclosure is always user-driven.
   out[out.length-1]={...prior,...message,content:[...blocks(prior.content),...blocks(message.content)],createdAt:prior.createdAt,usage:addUsage(prior.usage,message.usage),durationMs:(prior.durationMs??0)+(message.durationMs??0),round:Math.max(prior.round??0,message.round??0),toolCount:(prior.toolCount??0)+(message.toolCount??0),streaming:prior.streaming||message.streaming,streamId:message.streamId??prior.streamId,id:message.id??prior.id,activeBlockCount:message.streaming?blocks(message.content).length:0};continue;
  }
  // The push branch covers the first assistant of a turn while it is still the
  // only round (round 1 streaming): it must also mark its trailing blocks
  // active so the round-1 thinking card styles as streaming before a second
  // round arrives.
  out.push({...message, activeBlockCount: message.streaming ? blocks(message.content).length : 0});
 }
 return out;
}
