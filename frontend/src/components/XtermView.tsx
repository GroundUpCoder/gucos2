import { useEffect, useRef, useState } from 'react';
import { useKernel } from '../kernel/context';
import type { TerminalSession } from '../kernel/terminal-store';
import { terminalStore } from '../kernel/terminal-store';

type Disposable = { dispose(): void };
type Term = { cols: number; rows: number; open(el: HTMLElement): void; loadAddon(a: unknown): void; onData(fn: (s: string) => void): Disposable; onResize(fn: (v: {cols:number;rows:number}) => void): Disposable; write(b: Uint8Array): void; focus(): void; dispose(): void; options: {fontSize:number}; buffer: unknown };
declare global { interface Window { Terminal: new (opts: unknown) => Term; FitAddon: new () => { fit(): void } } }
let loader: Promise<void> | null = null;
function loadXterm(): Promise<void> {
  if (window.Terminal && window.FitAddon) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/vendor/xterm/xterm.css'; document.head.appendChild(css);
    const one = document.createElement('script'); one.src = '/vendor/xterm/xterm.js'; one.onerror = () => reject(new Error('xterm failed to load'));
    one.onload = () => { const two = document.createElement('script'); two.src = '/vendor/xterm/xterm-addon-fit.js'; two.onload = () => resolve(); two.onerror = () => reject(new Error('xterm fit addon failed to load')); document.head.appendChild(two); };
    document.head.appendChild(one);
  }); return loader;
}
export function XtermView({ session, active, fontSize }: { session: TerminalSession; active: boolean; fontSize: number }) {
  const host = useRef<HTMLDivElement>(null); const kernel = useKernel(); const [error, setError] = useState('');
  useEffect(() => {
    let dead = false, term: Term | null = null, ro: ResizeObserver | null = null, off: (() => void) | null = null;
    void loadXterm().then(() => {
      if (dead || !host.current) return;
      const fit = new window.FitAddon(); term = new window.Terminal({ cursorBlink: true, convertEol: true, fontSize, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', scrollback: 5000, theme: { background: '#0a0a0a', foreground: '#f4f4f5' } });
      term.loadAddon(fit); term.open(host.current); fit.fit();
      term.onData(data => kernel.terminalInput(session.id, data)); term.onResize(z => kernel.resizeTerminal(session.id, z.cols, z.rows));
      off = terminalStore.subscribeOutput(session.id, bytes => term?.write(bytes));
      ro = new ResizeObserver(() => { if (active) { try { fit.fit(); } catch (e) { console.warn('terminal fit failed', e); } } }); ro.observe(host.current);
      const exposed = { id: session.id, pid: session.pid, term, fit, el: host.current, tab: null };
      window.__terminals.set(session.id, exposed);
      if (active) { term.focus(); kernel.resizeTerminal(session.id, term.cols, term.rows); }
    }).catch(e => setError(e instanceof Error ? e.message : String(e)));
    return () => { dead = true; off?.(); ro?.disconnect(); window.__terminals.delete(session.id); term?.dispose(); };
  }, [kernel, session.id, session.pid]);
  useEffect(() => { const x = window.__terminals.get(session.id) as {term?:Term;fit?:{fit():void}} | undefined; if (active && x?.term) { x.term.options.fontSize = fontSize; x.fit?.fit(); x.term.focus(); } }, [active, fontSize, session.id]);
  return <div className={active ? 'absolute inset-0 p-2 bg-[#0a0a0a]' : 'hidden'}>{error ? <p className="text-destructive p-4">{error}</p> : <div ref={host} className="w-full h-full" />}</div>;
}
