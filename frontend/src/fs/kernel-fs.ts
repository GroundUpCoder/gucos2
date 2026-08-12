import { kernelClient } from '../kernel/kernel-client';
import { KernelError, type FsEntry, type FsSnapshot } from '../kernel/protocol';

export class FsError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'FsError'; }
}
const abs = (path: string) => path === '' || path === '/' ? '/' : '/' + path.split('/').filter(Boolean).join('/');
const map = async <T>(fn: () => Promise<T>): Promise<T> => { try { return await fn(); } catch (e) { if (e instanceof KernelError) throw new FsError(e.code, e.message); throw e; } };

export const gucFs = {
  list: (path: string): Promise<FsEntry[]> => map(() => kernelClient.listFiles(abs(path))),
  stat: (path: string) => map(() => kernelClient.stat(abs(path))),
  readRange: (path: string, offset: number, length: number) => map(() => kernelClient.read(abs(path), offset, length)),
  readBytes: async (path: string, maxBytes = 4 * 1024 * 1024) => {
    const st = await gucFs.stat(path); if (!st) throw new FsError('ENOENT', `read ${path}: ENOENT`);
    if (st.kind !== 'file') throw new FsError('EISDIR', `read ${path}: EISDIR`);
    if (st.size > maxBytes) throw new FsError('EFBIG', `read ${path}: ${st.size} bytes exceeds ${maxBytes} byte limit`);
    return gucFs.readRange(path, 0, st.size);
  },
  readText: async (path: string, maxBytes = 2 * 1024 * 1024) => new TextDecoder('utf-8', { fatal: true }).decode(await gucFs.readBytes(path, maxBytes)),
  // Clobber guards ride to the kernel worker, where the check-and-write in
  // one RPC is atomic against every other writer (pages, agent, processes):
  //   exclusive   — refuse an existing path (FsError EEXIST)
  //   ifUnchanged — refuse unless the file still matches this {mtimeMs, size}
  //                 snapshot (FsError ECONFLICT; a deleted file conflicts too)
  // A plain write stays unconditional for owned state files. Returns the
  // written file's fresh snapshot for conditional-write rebasing.
  write: async (path: string, data: string | Blob | Uint8Array, guard?: { exclusive?: boolean; ifUnchanged?: FsSnapshot }): Promise<FsSnapshot> => {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data)
      : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    return map(() => kernelClient.write(abs(path), bytes, guard));
  },
  mkdir: (path: string) => map(() => kernelClient.mkdir(abs(path))),
  // noReplace refuses a rename onto an existing destination (FsError EEXIST)
  // instead of POSIX silent replacement.
  rename: (from: string, to: string, guard?: { noReplace?: boolean }) => map(() => kernelClient.rename(abs(from), abs(to), guard)),
  remove: (path: string, recursive = false) => map(() => kernelClient.remove(abs(path), recursive)),
};
