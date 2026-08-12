export type KernelState =
  | { status: 'booting'; message: string }
  | { status: 'ready'; mode: string; imageVersion: number | null; protocolVersion: number }
  | { status: 'locked'; message: string }
  | { status: 'fatal'; message: string };

export type FsEntry = { name: string; kind: 'file' | 'directory'; size: number; lastModified: number; mode: number };
export type FsStat = { kind: 'file' | 'directory'; size: number; mode: number; mtimeMs: number };
// The {mtimeMs, size} identity a conditional write compares against, and what
// fs-write returns for the just-written file (so callers rebase without a
// second, racy stat). The kernel worker services every fs mutation on one
// thread, so the guard checks inside one RPC are atomic against all writers.
export type FsSnapshot = { mtimeMs: number; size: number };
export type SurfaceInfo = { id: number; title: string; width: number; height: number; transport: 'shared-memory' | 'bitmap'; parentId: number | null };
export type ProcessInfo = {
  pid: number; ppid: number; pgid: number; sid: number; state: 'running' | 'stopped' | 'zombie';
  command: string; path: string; cwd: string; startedAt: number; exitStatus: number | null;
  controllingTerminal: boolean; surfaces: SurfaceInfo[];
};
export type ExecStart = { executionId: string; pid: number; pgid: number };
export type ExecExit = { executionId: string; pid: number; pgid: number; status: number | null; signal: number | null;
  cause: 'exit' | 'signal' | 'abort' | 'timeout' | 'leaked-group'; truncated: boolean; outputBytes: number;
  stdoutCapturedBytes: number; stdoutTotalBytes: number; stdoutTruncated: boolean;
  stderrCapturedBytes: number; stderrTotalBytes: number; stderrTruncated: boolean;
  escalated: boolean; leakedPids: number[] };

export type KernelRequest =
  | { op: 'system-info' }
  | { op: 'terminal-list' }
  | { op: 'fs-list'; path: string }
  | { op: 'fs-stat'; path: string }
  | { op: 'fs-read'; path: string; offset: number; length: number }
  | { op: 'fs-write'; path: string; bytes: ArrayBuffer; mode?: number; exclusive?: boolean; ifUnchanged?: FsSnapshot | null }
  | { op: 'fs-append'; path: string; bytes: ArrayBuffer; mode?: number; sync?: boolean }
  | { op: 'fs-mkdir'; path: string; mode?: number }
  | { op: 'fs-rename'; from: string; to: string; noReplace?: boolean }
  | { op: 'fs-remove'; path: string; recursive?: boolean }
  | { op: 'process-list' }
  | { op: 'process-signal'; pid: number; signal: number }
  | { op: 'exec-start'; executionId?: string; command: string; timeoutMs?: number }
  | { op: 'exec-abort'; executionId: string }
  | { op: 'surface-attach'; surfaceId: number; width: number; height: number }
  | { op: 'surface-detach'; surfaceId: number };

export type KernelEvent =
  | { type: 'boot-log'; msg: string }
  | { type: 'ready'; mode: string; imageVersion?: number; protocolVersion?: number }
  | { type: 'boot-error'; msg: string }
  | { type: 'boot-locked' }
  | { type: 'terminal-opened'; id: number; pid: number }
  | { type: 'terminal-output'; id: number; bytes: Uint8Array }
  | { type: 'terminal-closed'; id: number; reason: 'user' }
  | { type: 'terminal-exited'; id: number; status: number | null }
  | { type: 'terminal-error'; id: number; msg: string }
  | { type: 'surface-frame'; surfaceId: number; width: number; height: number; sequence: number; rgba?: ArrayBuffer; bitmap?: ImageBitmap }
  | { type: 'surface-list'; processes: ProcessInfo[] }
  | { type: 'surface-created'; surfaceId: number; pid: number }
  | { type: 'surface-destroyed'; surfaceId: number; pid: number }
  | { type: 'process-changed'; processes: ProcessInfo[] }
  | { type: 'exec-output'; executionId: string; fd: 'stdout' | 'stderr'; bytes: Uint8Array }
  | ({ type: 'exec-exit' } & ExecExit)
  | { type: 'clip-read' }
  | { type: 'clipboard'; text: string }
  | { type: 'egress'; dispo: 'download' | 'saveas'; name: string; bytes: ArrayBuffer }
  | { type: 'host-error'; operation: 'clipboard-read' | 'clipboard-write' | 'egress' | 'audio'; message: string }
  | { type: 'audio'; sab: SharedArrayBuffer; bufferSize: number; freq: number; channels: number; format: number }
  | { type: 'pointer-lock'; wanted: boolean }
  | { type: 'cursor'; shape: number }
  | { type: 'rpc-result'; id: number; value: unknown }
  | { type: 'rpc-error'; id: number; error: { code?: string; message: string } };

export class KernelError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'KernelError'; }
}
