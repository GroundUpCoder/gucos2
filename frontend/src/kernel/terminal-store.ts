import { kernelClient } from './kernel-client';
import type { KernelEvent } from './protocol';

export type TerminalSession = { id: number; pid: number; name: string; scrollback: Uint8Array };
type Listener = () => void;
type OutputListener = (bytes: Uint8Array) => void;
const SCROLLBACK_CAP = 256 * 1024;
class TerminalStore {
  sessions = new Map<number, TerminalSession>(); active = 0;
  private listeners = new Set<Listener>(); private output = new Map<number,Set<OutputListener>>(); private started = false; private opening = false;
  start() {
    if (this.started) return; this.started = true;
    kernelClient.subscribeState(s => { if (s.status === 'ready' && this.sessions.size === 0 && !this.opening) this.open(); });
    kernelClient.subscribe(e => this.onEvent(e));
  }
  subscribe = (fn: Listener) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  subscribeOutput(id: number, fn: OutputListener) {
    const set = this.output.get(id) || new Set<OutputListener>(); this.output.set(id, set);
    set.add(fn); const replay = this.sessions.get(id)?.scrollback; if (replay?.length) fn(replay);
    return () => { set.delete(fn); if (!set.size) this.output.delete(id); };
  }
  snapshot = () => `${this.active}:${[...this.sessions.keys()].join(',')}`;
  open() { if (this.opening) return; this.opening = true; kernelClient.openTerminal(80, 24); }
  close(id: number) { kernelClient.closeTerminal(id); }
  activate(id: number) { if (this.sessions.has(id)) { this.active = id; window.__activeTerminal = id; this.emit(); } }
  rename(id: number, name: string) { const s = this.sessions.get(id); if (s) { s.name = name.slice(0, 24); this.emit(); } }
  private emit() { this.listeners.forEach(fn => fn()); }
  private onEvent(e: KernelEvent) {
    if (e.type === 'terminal-opened') { this.opening = false; this.sessions.set(e.id, { id: e.id, pid: e.pid, name: `Shell ${e.id}`, scrollback: new Uint8Array() }); this.active = e.id; window.__activeTerminal = e.id; this.emit(); }
    if (e.type === 'terminal-output') {
      const s = this.sessions.get(e.id); if (!s) return;
      const keep = Math.min(SCROLLBACK_CAP, s.scrollback.length + e.bytes.length);
      const merged = new Uint8Array(keep); const oldTake = Math.min(s.scrollback.length, Math.max(0, keep - e.bytes.length));
      if (oldTake) merged.set(s.scrollback.subarray(s.scrollback.length - oldTake));
      merged.set(e.bytes.subarray(Math.max(0, e.bytes.length - keep)), oldTake); s.scrollback = merged;
      this.output.get(e.id)?.forEach(fn => fn(e.bytes));
    }
    if (e.type === 'terminal-error') { this.opening = false; this.emit(); }
    if (e.type === 'terminal-closed' || e.type === 'terminal-exited') { this.sessions.delete(e.id); this.output.delete(e.id); if (this.active === e.id) this.active = [...this.sessions.keys()].at(-1) || 0; if (!this.sessions.size && kernelClient.state.status === 'ready') this.open(); this.emit(); }
  }
}
export const terminalStore = new TerminalStore(); terminalStore.start();
