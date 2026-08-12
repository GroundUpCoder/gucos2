// The typed adapter must carry the kernel-seam clobber guards (data-loss
// audit): exclusive create, snapshot-conditional write, and no-replace rename
// all ride the wire to the kernel worker, where the check-and-mutate is
// atomic. Dropping an option here would silently re-open the overwrite hole,
// so every option is pinned against the wire call.
import { describe, expect, it, vi } from 'vitest';

const { write, rename } = vi.hoisted(() => ({ write: vi.fn(async () => ({ mtimeMs: 111, size: 5 })), rename: vi.fn(async () => undefined) }));
vi.mock('../kernel/kernel-client', () => ({ kernelClient: { write, rename } }));
const { gucFs, FsError } = await import('./kernel-fs');
const { KernelError } = await import('../kernel/protocol');

describe('gucFs write guards', () => {
  it('sends exclusive on the wire and returns the written snapshot', async () => {
    write.mockClear();
    const snap = await gucFs.write('root/new.txt', 'hello', { exclusive: true });
    expect(write).toHaveBeenCalledWith('/root/new.txt', expect.any(Uint8Array), { exclusive: true });
    expect(snap).toEqual({ mtimeMs: 111, size: 5 });
  });
  it('sends the ifUnchanged snapshot on the wire', async () => {
    write.mockClear();
    await gucFs.write('root/doc.md', 'body', { ifUnchanged: { mtimeMs: 42, size: 9 } });
    expect(write).toHaveBeenCalledWith('/root/doc.md', expect.any(Uint8Array), { ifUnchanged: { mtimeMs: 42, size: 9 } });
  });
  it('keeps a plain write unconditional for owned state files', async () => {
    write.mockClear();
    await gucFs.write('root/.guc/agent/index.json', '{}');
    expect(write).toHaveBeenCalledWith('/root/.guc/agent/index.json', expect.any(Uint8Array), undefined);
  });
  it('maps a kernel conflict into a typed FsError the pages can branch on', async () => {
    write.mockImplementationOnce(async () => { throw new KernelError('ECONFLICT', 'write /root/doc.md: the file changed on disk'); });
    const error = await gucFs.write('root/doc.md', 'body', { ifUnchanged: { mtimeMs: 42, size: 9 } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FsError);
    expect((error as InstanceType<typeof FsError>).code).toBe('ECONFLICT');
  });
});

describe('gucFs rename guard', () => {
  it('sends noReplace on the wire', async () => {
    rename.mockClear();
    await gucFs.rename('root/from.txt', 'root/to.txt', { noReplace: true });
    expect(rename).toHaveBeenCalledWith('/root/from.txt', '/root/to.txt', { noReplace: true });
  });
});
