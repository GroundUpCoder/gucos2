import { Check, ChevronRight, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { MessageBlocks, UserBlocks } from './MessageBlocks';
import { READER_SIZE_TEXT_CLASSES, useReaderSize } from '../../agent/reader-size';
import { estimateCostUsd, formatCost, PRICING_AS_OF } from '../../agent/pricing';
import { messageKey } from '../../agent/scroll';
import type { ChatMessage } from '../../agent/session';

const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const messageText = (content: unknown) => typeof content === 'string' ? content : Array.isArray(content) ? content.filter(block => block && typeof block === 'object' && (block as { type?: string }).type === 'text').map(block => String((block as { text?: unknown }).text ?? '')).join('\n') : '';
function formatTime(stamp: Date | null) {
  if (!stamp || Number.isNaN(stamp.valueOf())) return 'time unavailable';
  const today = stamp.toDateString() === new Date().toDateString();
  return today ? stamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : stamp.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Metadata({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false), usage = message.usage ?? {}, input = number(usage.input_tokens), output = number(usage.output_tokens), cacheRead = number(usage.cache_read_input_tokens), cacheWrite = number(usage.cache_creation_input_tokens), total = (input ?? 0) + (output ?? 0), assistant = message.role === 'assistant', cost = assistant ? estimateCostUsd(message.model, usage) : null, stamp = message.createdAt ? new Date(message.createdAt) : null, role = assistant ? 'ASSISTANT' : 'USER', source = assistant ? (message.streaming ? 'provider stream' : 'provider response') : 'authored in this browser';
  return <div className="min-w-0 text-sm text-muted-foreground" data-testid={assistant ? 'assistant-meta' : 'user-meta'}>
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${role.toLowerCase()} metadata`} className="flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 text-left hover:text-foreground">
      <ChevronRight className={`size-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
      <span className="font-semibold tracking-wide">{role}</span><span title={stamp?.toISOString()}>{formatTime(stamp)}</span>
      {assistant && message.model && <><span className="opacity-50">|</span><span className="font-mono">{message.model}</span></>}
      {assistant && message.stopReason && <><span className="opacity-50">|</span><span>{message.stopReason}</span></>}
      {message.recordSeq !== undefined && <><span className="opacity-50">|</span><span className="font-mono text-xs">record {message.recordSeq}</span></>}
    </button>
    {open && <dl className="ml-4 mt-1 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm" data-testid="message-meta-detail">
      <dt>Role</dt><dd className="font-mono">{role}</dd><dt>Source</dt><dd>{source}</dd>
      {stamp && !Number.isNaN(stamp.valueOf()) && <><dt>Timestamp</dt><dd className="break-words font-mono">{stamp.toLocaleString()}</dd></>}
      {message.threadId && <><dt>Thread ID</dt><dd className="break-all font-mono text-xs">{message.threadId}</dd></>}
      {message.recordSeq !== undefined && <><dt>Journal record</dt><dd className="font-mono">{message.recordSeq}</dd></>}
      {cost !== null && <><dt>Cost (estimate)</dt><dd className="font-mono">~{formatCost(cost)}</dd><dt className="opacity-60">↳ basis</dt><dd className="opacity-60">token counts × DeepSeek list prices ({PRICING_AS_OF})</dd></>}
      {input !== undefined && <><dt>Input tokens</dt><dd className="font-mono">{input.toLocaleString()}</dd></>}{output !== undefined && <><dt>Output tokens</dt><dd className="font-mono">{output.toLocaleString()}</dd></>}{total > 0 && <><dt>Total tokens</dt><dd className="font-mono">{total.toLocaleString()}</dd></>}
      {cacheRead !== undefined && <><dt>Cache read</dt><dd className="font-mono">{cacheRead.toLocaleString()} tokens</dd></>}{cacheWrite !== undefined && <><dt>Cache creation</dt><dd className="font-mono">{cacheWrite.toLocaleString()} tokens</dd></>}
      {message.round !== undefined && <><dt>Rounds</dt><dd className="font-mono">{message.round}</dd></>}{message.toolCount !== undefined && <><dt>Tool calls</dt><dd className="font-mono">{message.toolCount}</dd></>}
      {message.model && <><dt>Model</dt><dd className="break-all font-mono">{message.model}</dd></>}{message.stopReason && <><dt>Stop reason</dt><dd className="font-mono">{message.stopReason}</dd></>}{message.durationMs !== undefined && <><dt>Duration</dt><dd className="font-mono">{message.durationMs.toLocaleString()} ms</dd></>}
    </dl>}
  </div>;
}

function InfoBar({ message, collapsed, onToggle }: { message: ChatMessage; collapsed: boolean; onToggle(): void }) {
  const [copied, setCopied] = useState(false), plain = messageText(message.content);
  const copy = async () => { await navigator.clipboard.writeText(plain); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return <div className="flex items-start gap-1" data-testid="message-info-bar">
    <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${message.role} message`} title={`${collapsed ? 'Expand' : 'Collapse'} message`} className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground"><ChevronRight className={`size-4 transition-transform ${collapsed ? '' : 'rotate-90'}`} /></button>
    <div className="min-w-0 flex-1"><Metadata message={message} /></div>
    {plain && <button type="button" onClick={() => void copy().catch(error => toast.error(String(error)))} aria-label="Copy message" title={copied ? 'Copied!' : 'Copy message'} className="shrink-0 p-1 text-muted-foreground hover:text-foreground">{copied ? <Check className="size-4" /> : <Copy className="size-4" />}</button>}
  </div>;
}

export function Message({ message, index }: { message: ChatMessage; index: number }) {
  const size = useReaderSize(), [collapsed, setCollapsed] = useState(false), user = message.role === 'user', authored = user && (typeof message.content === 'string' || Array.isArray(message.content) && message.content.some(block => block && typeof block === 'object' && ['text', 'image'].includes(String((block as { type?: unknown }).type))));
  if (!user) return <article id={`message-${index}`} className="space-y-2" data-reader-size={size} data-role={message.role} data-message-key={messageKey(message, index)} data-streaming={message.streaming ? 'true' : undefined}>
    <div className="rounded-lg border border-border bg-muted/50 px-3 py-1.5"><InfoBar message={message} collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} /></div>
    {!collapsed && <MessageBlocks content={message.content} streaming={message.streaming} activeBlockCount={message.activeBlockCount} />}
  </article>;
  return <article id={`message-${index}`} className={authored ? 'ml-auto w-[80%] overflow-hidden rounded-lg border border-border' : 'space-y-2'} data-reader-size={size} data-role={message.role} data-user-authored={authored ? 'true' : undefined} data-message-key={messageKey(message, index)} data-streaming={message.streaming ? 'true' : undefined}>
    {authored && <div className="bg-slate-100 px-3 py-1.5 dark:bg-slate-800"><InfoBar message={message} collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} /></div>}
    {!collapsed && <div className={authored ? `bg-slate-200 px-3 py-2 text-foreground dark:bg-slate-700 ${READER_SIZE_TEXT_CLASSES[size]}` : undefined}><UserBlocks content={message.content} /></div>}
  </article>;
}
