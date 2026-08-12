import { useSyncExternalStore, useState } from 'react';
import { ClipboardPaste, Minus, Plus, SquareTerminal } from 'lucide-react';
import { useKernel } from '../kernel/context';
import { terminalStore } from '../kernel/terminal-store';
import { XtermView } from '../components/XtermView';
import { Dialog } from '../components/Dialog';

const KEYS = [['Esc','\u001b'],['Tab','\t'],['Ctrl-C','\u0003'],['↑','\u001b[A'],['↓','\u001b[B'],['←','\u001b[D'],['→','\u001b[C'],['|','|'],['~','~'],['/','/']] as const;
export default function TermPage() {
  useSyncExternalStore(terminalStore.subscribe, terminalStore.snapshot); const kernel = useKernel(); const [font, setFont] = useState(18); const [error, setError] = useState(''); const [renaming,setRenaming]=useState<number|null>(null);
  const sessions = [...terminalStore.sessions.values()];
  const input = (data: string) => { if (terminalStore.active) { kernel.terminalInput(terminalStore.active, data); (window.__terminals.get(terminalStore.active) as {term?:{focus():void}}|undefined)?.term?.focus(); } };
  return <div className="flex-1 min-h-0 flex flex-col" data-testid="term-page">
    <div className="flex items-center gap-2 px-3 md:px-4 py-1.5 border-b border-border shrink-0" data-testid="term-toolbar">
      <SquareTerminal className="w-4 h-4 text-muted-foreground"/><span className="text-xs text-muted-foreground font-mono truncate flex-1">gucOS shell</span>
      <button className="flex items-center gap-1 text-xs px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50" title="Smaller" onClick={() => setFont(v => Math.max(12, v - 2))}><Minus className="w-3.5 h-3.5"/><span className="hidden sm:inline">Smaller</span></button>
      <button className="flex items-center gap-1 text-xs px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50" title="Larger" onClick={() => setFont(v => Math.min(34, v + 2))}><Plus className="w-3.5 h-3.5"/><span className="hidden sm:inline">Larger</span></button>
      <button className="flex items-center gap-1 text-xs px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50" title="Paste" onClick={() => navigator.clipboard.readText().then(input).catch(e => setError(String(e)))}><ClipboardPaste className="w-3.5 h-3.5"/><span className="hidden sm:inline">Paste</span></button>
    </div>
    <div id="tabs" role="tablist" aria-label="Terminal sessions" className="flex gap-1 overflow-x-auto px-2 py-1.5 border-b bg-card">
      {sessions.map(s => <div key={s.id} className={`flex items-center rounded whitespace-nowrap ${terminalStore.active === s.id ? 'bg-accent' : 'text-muted-foreground'}`}><button role="tab" aria-selected={terminalStore.active===s.id} tabIndex={terminalStore.active===s.id?0:-1} data-terminal-id={s.id} className="px-2 py-1.5 text-sm" onClick={() => terminalStore.activate(s.id)} onDoubleClick={() => setRenaming(s.id)} onKeyDown={e=>{
        if(e.key==='F2'){e.preventDefault();setRenaming(s.id)}
        else if(e.key==='Delete'){e.preventDefault();terminalStore.close(s.id)}
        else if(e.key==='ArrowRight'||e.key==='ArrowLeft'){
          e.preventDefault();const at=sessions.findIndex(item=>item.id===s.id),step=e.key==='ArrowRight'?1:-1,next=sessions[(at+step+sessions.length)%sessions.length];
          if(next){terminalStore.activate(next.id);requestAnimationFrame(()=>document.querySelector<HTMLElement>(`#tabs [role=tab][data-terminal-id="${next.id}"]`)?.focus())}
        }
      }}>{s.name}</button><button type="button" data-testid="terminal-close" className="mr-1 px-1 text-destructive" aria-label={`Close ${s.name}`} onClick={() => terminalStore.close(s.id)}>×</button></div>)}
      <button id="new" className="px-2 py-1.5 rounded text-sm" onClick={() => terminalStore.open()}>+ New shell</button>
    </div>
    {error && <div className="text-xs text-destructive px-2">Paste failed: {error}</div>}
    <div className="relative flex-1 min-h-0 bg-[#080b12]" role="region" aria-label="Terminal output">{sessions.map(s => <XtermView key={s.id} session={s} active={s.id === terminalStore.active} fontSize={font} />)}</div>
    <div id="keys" role="toolbar" aria-label="Terminal shortcut keys" className="flex gap-1 overflow-x-auto p-1.5 bg-card safe-bottom md:hidden">{KEYS.map(([label,data]) => <button key={label} aria-label={`Send ${label}`} className="min-w-11 px-2 py-2 border rounded" onClick={() => input(data)}>{label}</button>)}</div><Dialog open={renaming!==null} title="Rename terminal" initial={renaming!==null?terminalStore.sessions.get(renaming)?.name:''} onCancel={()=>setRenaming(null)} onConfirm={v=>{if(renaming!==null&&v)terminalStore.rename(renaming,v);setRenaming(null);}} />
  </div>;
}
