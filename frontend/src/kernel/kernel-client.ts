import type { ExecExit, ExecStart, FsEntry, FsSnapshot, FsStat, KernelEvent, KernelRequest, KernelState, ProcessInfo } from './protocol';
import { KernelError } from './protocol';

type Listener<T> = (value: T) => void;
type Pending = { resolve(value: unknown): void; reject(error: Error): void };

export class KernelClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private eventListeners = new Set<Listener<KernelEvent>>();
  private stateListeners = new Set<Listener<KernelState>>();
  private executions = new Map<string, { output?: (fd: 'stdout'|'stderr', bytes: Uint8Array) => void; resolve(v: ExecExit): void; reject(e: Error): void }>();
  private nextExecutionId = 1;
  private _state: KernelState = { status: 'booting', message: 'Starting gucOS…' };
  constructor(
    private readonly workerFactory: (url: string) => Worker = url => new Worker(url),
    private readonly isolated: () => boolean = () => crossOriginIsolated,
    private readonly host = defaultHostBridge,
  ) {}

  get state(): KernelState { return this._state; }
  subscribeState(fn: Listener<KernelState>): () => void { this.stateListeners.add(fn); fn(this._state); return () => this.stateListeners.delete(fn); }
  subscribe(fn: Listener<KernelEvent>): () => void { this.eventListeners.add(fn); return () => this.eventListeners.delete(fn); }

  boot(): void {
    if (this.worker) return;
    if (!this.isolated()) {
      this.setState({ status: 'fatal', message: 'gucOS requires cross-origin isolation (COOP/COEP).' });
      return;
    }
    const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
    const generation = typeof __RUNTIME_GENERATION__ === 'string' ? __RUNTIME_GENERATION__ : 'dev';
    params.set('generation', generation);
    const worker = this.workerFactory(`/runtime/${generation}/os/kernel-worker.js?${params}`);
    this.worker = worker;
    worker.onmessage = event => this.onMessage(event.data as KernelEvent);
    worker.onerror = event => this.fail(new Error(event.message || 'kernel worker crashed'));
    worker.onmessageerror = () => this.fail(new Error('kernel worker message could not be decoded'));
  }

  retryBoot(): void { this.post({ type: 'boot-retry' }); }
  prepareStorageReset(): void {
    const error=new Error('Kernel stopped for storage recovery');
    this.worker?.terminate();this.worker=null;
    this.pending.forEach(p=>p.reject(error));this.pending.clear();
    this.executions.forEach(p=>p.reject(error));this.executions.clear();
    this.setState({status:'booting',message:'Preparing storage recovery…'});
  }
  openTerminal(cols: number, rows: number): void { this.post({ type: 'terminal-new', cols, rows }); }
  terminalInput(id: number, data: string | Uint8Array): void {
    const payload = data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
    this.post({ type: 'terminal-input', id, data: payload }, payload instanceof ArrayBuffer ? [payload] : []);
  }
  resizeTerminal(id: number, cols: number, rows: number): void { this.post({ type: 'terminal-resize', id, cols, rows }); }
  closeTerminal(id: number): void { this.post({ type: 'terminal-close', id }); }

  request<T>(request: KernelRequest, transfer: Transferable[] = []): Promise<T> {
    if (!this.worker || this._state.status !== 'ready') return Promise.reject(new KernelError('EAGAIN', 'kernel is not ready'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject });
      this.post({ type: 'rpc', id, request }, transfer);
    });
  }
  listFiles(path: string): Promise<FsEntry[]> { return this.request({ op: 'fs-list', path }); }
  stat(path: string): Promise<FsStat | null> { return this.request({ op: 'fs-stat', path }); }
  read(path: string, offset: number, length: number): Promise<Uint8Array> {
    return this.request<ArrayBuffer>({ op: 'fs-read', path, offset, length }).then(v => new Uint8Array(v));
  }
  write(path: string, bytes: Uint8Array, guard?: { exclusive?: boolean; ifUnchanged?: FsSnapshot }): Promise<FsSnapshot> {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return this.request({ op: 'fs-write', path, bytes: buffer, ...guard }, [buffer]);
  }
  append(path: string, bytes: Uint8Array, mode = 0o600, sync = true): Promise<void> {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return this.request({ op: 'fs-append', path, bytes: buffer, mode, sync }, [buffer]);
  }
  mkdir(path: string): Promise<void> { return this.request({ op: 'fs-mkdir', path }); }
  rename(from: string, to: string, guard?: { noReplace?: boolean }): Promise<void> { return this.request({ op: 'fs-rename', from, to, ...guard }); }
  remove(path: string, recursive = false): Promise<void> { return this.request({ op: 'fs-remove', path, recursive }); }
  processes(): Promise<ProcessInfo[]> { return this.request({ op: 'process-list' }); }
  signal(pid: number, signal: number): Promise<void> { return this.request({ op: 'process-signal', pid, signal }); }
  async exec(command: string, options: { timeoutMs?: number; onOutput?: (fd: 'stdout'|'stderr', bytes: Uint8Array) => void; signal?: AbortSignal } = {}): Promise<{ start: ExecStart; completed: Promise<ExecExit>; abort(): Promise<void> }> {
    const executionId=`page-${this.nextExecutionId++}`;
    const abort = async () => { try { await this.request<void>({ op: 'exec-abort', executionId }); } catch(error) { if (!(error instanceof KernelError) || error.code !== 'ENOENT') throw error; } };
    const onAbort=()=>{void abort().catch(()=>undefined)};
    if(options.signal){if(options.signal.aborted)onAbort();else options.signal.addEventListener('abort',onAbort,{once:true});}
    let start:ExecStart;
    try { start = await this.request<ExecStart>({ op: 'exec-start', executionId, command, timeoutMs: options.timeoutMs }); }
    catch(error){options.signal?.removeEventListener('abort',onAbort);throw error;}
    let resolve!: (v: ExecExit) => void, reject!: (e: Error) => void;
    const completed = new Promise<ExecExit>((res, rej) => { resolve = res; reject = rej; });
    this.executions.set(start.executionId, { output: options.onOutput, resolve, reject });
    void completed.finally(()=>options.signal?.removeEventListener('abort',onAbort)).catch(()=>undefined);
    return { start, completed, abort };
  }
  attachSurface(surfaceId: number, width: number, height: number): Promise<void> { return this.request({ op: 'surface-attach', surfaceId, width, height }); }
  detachSurface(surfaceId: number): Promise<void> { return this.request({ op: 'surface-detach', surfaceId }); }
  surfaceInput(event: Record<string, unknown>): void { this.post({ type: 'surface-input', ev: event }); }

  private post(message: unknown, transfer: Transferable[] = []): void { this.worker?.postMessage(message, transfer); }
  private setState(state: KernelState): void { this._state = state; this.stateListeners.forEach(fn => fn(state)); if (typeof window !== 'undefined') window.__osState = state.status; }
  private onMessage(event: KernelEvent): void {
    if (event.type === 'rpc-result' || event.type === 'rpc-error') {
      const pending = this.pending.get(event.id); if (!pending) return;
      this.pending.delete(event.id);
      if (event.type === 'rpc-result') pending.resolve(event.value);
      else pending.reject(new KernelError(event.error.code || 'EIO', event.error.message));
      return;
    }
    if (event.type === 'exec-output') this.executions.get(event.executionId)?.output?.(event.fd, event.bytes);
    else if (event.type === 'exec-exit') {
      const run = this.executions.get(event.executionId);
      if (run) { this.executions.delete(event.executionId); run.resolve(event); }
    }
    if (event.type === 'boot-log') this.setState({ status: 'booting', message: event.msg });
    else if (event.type === 'ready') {
      if (event.protocolVersion !== 2) this.fail(new Error(`Unsupported kernel protocol ${event.protocolVersion ?? 'missing'} (expected 2)`));
      else this.setState({ status: 'ready', mode: event.mode, imageVersion: event.imageVersion ?? null, protocolVersion: 2 });
    }
    else if (event.type === 'boot-locked') this.setState({ status: 'locked', message: 'gucOS is already open in another tab.' });
    else if (event.type === 'boot-error') this.setState({ status: 'fatal', message: event.msg });
    if (event.type === 'clip-read') void this.handleClipboardRead();
    else if (event.type === 'clipboard') void this.handleClipboardWrite(event.text);
    else if (event.type === 'egress') void this.handleEgress(event);
    this.eventListeners.forEach(fn => fn(event));
  }
  private hostError(operation: 'clipboard-read'|'clipboard-write'|'egress'|'audio', error: unknown): void {
    const event: KernelEvent = { type: 'host-error', operation, message: error instanceof Error ? error.message : String(error) };
    this.eventListeners.forEach(fn => fn(event));
  }
  private async handleClipboardRead(): Promise<void> {
    try { const text = await this.host.readClipboard(); if (text) this.post({ type: 'clipboard', text }); }
    catch (error) { this.hostError('clipboard-read', error); }
    finally { this.post({ type: 'clip-read-done' }); }
  }
  private async handleClipboardWrite(text: string): Promise<void> {
    try { await this.host.writeClipboard(text); } catch (error) { this.hostError('clipboard-write', error); }
  }
  private async handleEgress(event: Extract<KernelEvent,{type:'egress'}>): Promise<void> {
    try { await this.host.saveArtifact(event.dispo, event.name, event.bytes); } catch (error) { this.hostError('egress', error); }
  }
  private fail(error: Error): void {
    this.pending.forEach(p => p.reject(error)); this.pending.clear();
    this.executions.forEach(p => p.reject(error)); this.executions.clear();
    this.setState({ status: 'fatal', message: error.message });
  }
}

export type HostBridge = {
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  saveArtifact(dispo: 'download'|'saveas', name: string, bytes: ArrayBuffer): Promise<void>;
};
export const defaultHostBridge: HostBridge = {
  readClipboard: () => navigator.clipboard.readText(),
  writeClipboard: text => navigator.clipboard.writeText(text),
  async saveArtifact(dispo, name, bytes) {
    window.__lastEgress={name,disposition:dispo,bytes:bytes.byteLength};
    if (dispo === 'saveas' && 'showSaveFilePicker' in window) {
      const handle = await (window as Window & {showSaveFilePicker(o:{suggestedName:string}):Promise<{createWritable():Promise<{write(b:ArrayBuffer):Promise<void>;close():Promise<void>}>}>}).showSaveFilePicker({ suggestedName: name });
      const writable = await handle.createWritable(); await writable.write(bytes); await writable.close(); return;
    }
    const url = URL.createObjectURL(new Blob([bytes]));
    try { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  },
};

export const kernelClient = new KernelClient();
