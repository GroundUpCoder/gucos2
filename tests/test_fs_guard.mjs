// test_fs_guard.mjs — the kernel-seam clobber guards (gucos2 data-loss
// audit, lane-os-dataloss). The kernel worker services every filesystem
// mutation in the system on one thread (pages, agent tools, chat journals,
// and process syscalls all arrive as kernel-page work), so a check-and-write
// inside ONE call is atomic against every other writer. These tests drive the
// real BlockFS through the same OS_COMMON helpers the kernel worker calls —
// no boot, light leg.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (n, c) => c ? console.log('  ok  ' + n) : (failed++, console.error('  FAIL ' + n));
const require = createRequire(import.meta.url);
const common = require(path.join(APP, 'guc/os/os-common.js'));
const BLOCK_FS = require(path.join(APP, 'guc/host.js')).BLOCK_FS;

const enc = (s) => new TextEncoder().encode(s);
const read = (m, p) => { const b = common.readFileBytes(m, p); return b === null ? null : new TextDecoder().decode(b); };
const mkfs = () => { const v = BLOCK_FS.createV4(new BLOCK_FS.MemoryByteStore(1 << 20)); const m = new BLOCK_FS.MountFS({ '/': v }); common.initRootVolume(m); return m; };
const caught = (fn) => { try { fn(); return null; } catch (e) { return e; } };

check('guarded fs seam exists (writeFileGuarded/renameGuarded/fsSnapshot)',
  typeof common.writeFileGuarded === 'function' && typeof common.renameGuarded === 'function' && typeof common.fsSnapshot === 'function');
if (failed) { console.error('test_fs_guard: seam absent — every guard below would clobber'); process.exit(1); }

const mfs = mkfs();

// --- exclusive create: the Files create/upload guard -----------------------
const s1 = common.writeFileGuarded(mfs, '/root/a.txt', enc('alpha'), 0o644, { exclusive: true });
check('exclusive create on a fresh path writes and returns a {mtimeMs,size} snapshot',
  s1 && s1.size === 5 && Number.isFinite(s1.mtimeMs) && read(mfs, '/root/a.txt') === 'alpha');
check('snapshot matches fsSnapshot of the written file',
  JSON.stringify(common.fsSnapshot(mfs, '/root/a.txt')) === JSON.stringify(s1));

const exclErr = caught(() => common.writeFileGuarded(mfs, '/root/a.txt', enc('CLOBBER'), 0o644, { exclusive: true }));
check('exclusive create over an existing file refuses with EEXIST',
  exclErr !== null && exclErr.code === 'EEXIST');
check('the refused exclusive write destroyed nothing', read(mfs, '/root/a.txt') === 'alpha');

mfs.mkdir('/root/adir', 0o755);
const exclDirErr = caught(() => common.writeFileGuarded(mfs, '/root/adir', enc('x'), 0o644, { exclusive: true }));
check('exclusive create over an existing directory refuses with EEXIST', exclDirErr !== null && exclDirErr.code === 'EEXIST');

// --- ifUnchanged: the editor concurrent-modification guard -----------------
const s2 = common.writeFileGuarded(mfs, '/root/a.txt', enc('beta!!'), 0o644, { ifUnchanged: s1 });
check('ifUnchanged with the current snapshot writes and returns the new snapshot',
  read(mfs, '/root/a.txt') === 'beta!!' && s2 && s2.size === 6);

const staleErr = caught(() => common.writeFileGuarded(mfs, '/root/a.txt', enc('editor-buffer'), 0o644, { ifUnchanged: s1 }));
check('ifUnchanged with a stale snapshot refuses with ECONFLICT', staleErr !== null && staleErr.code === 'ECONFLICT');
check('the refused stale write preserved the newer on-disk content', read(mfs, '/root/a.txt') === 'beta!!');

// Same-size rewrites must still conflict once enough time passes for the v4
// ms-resolution mtime to advance — the editor's defense for same-length edits.
await new Promise((r) => setTimeout(r, 5));
const s3 = common.writeFileGuarded(mfs, '/root/a.txt', enc('BETA!!'), 0o644, {});
check('a plain rewrite advances the snapshot even at identical size',
  s3.size === s2.size && s3.mtimeMs > s2.mtimeMs);
const sameSizeErr = caught(() => common.writeFileGuarded(mfs, '/root/a.txt', enc('editor'), 0o644, { ifUnchanged: s2 }));
check('ifUnchanged detects a same-size concurrent change via mtime', sameSizeErr !== null && sameSizeErr.code === 'ECONFLICT');

mfs.unlink('/root/a.txt');
const goneErr = caught(() => common.writeFileGuarded(mfs, '/root/a.txt', enc('resurrect'), 0o644, { ifUnchanged: s3 }));
check('ifUnchanged after a concurrent delete refuses with ECONFLICT', goneErr !== null && goneErr.code === 'ECONFLICT');
check('the refused write did not recreate the deleted file', mfs.lstat('/root/a.txt') === null);

// --- renameGuarded: the Files rename-over-existing guard -------------------
common.writeFileGuarded(mfs, '/root/from.txt', enc('from-content'), 0o644, { exclusive: true });
common.writeFileGuarded(mfs, '/root/to.txt', enc('to-content'), 0o644, { exclusive: true });
const renErr = caught(() => common.renameGuarded(mfs, '/root/from.txt', '/root/to.txt', { noReplace: true }));
check('noReplace rename onto an existing destination refuses with EEXIST', renErr !== null && renErr.code === 'EEXIST');
check('the refused rename left both files intact',
  read(mfs, '/root/from.txt') === 'from-content' && read(mfs, '/root/to.txt') === 'to-content');
common.renameGuarded(mfs, '/root/from.txt', '/root/to.txt', {});
check('an unguarded rename keeps POSIX replace semantics',
  read(mfs, '/root/to.txt') === 'from-content' && mfs.lstat('/root/from.txt') === null);
const renMissErr = caught(() => common.renameGuarded(mfs, '/root/absent.txt', '/root/elsewhere.txt', { noReplace: true }));
check('renaming a missing source still fails loudly', renMissErr !== null && typeof renMissErr.code === 'string');

// --- the kernel worker actually routes the RPCs through the guards ---------
const worker = fs.readFileSync(path.join(APP, 'guc/os/kernel-worker.js'), 'utf8');
check('fs-write RPC routes through writeFileGuarded honoring exclusive/ifUnchanged',
  worker.includes('writeFileGuarded') && worker.includes('q.exclusive') && worker.includes('q.ifUnchanged'));
check('fs-write RPC no longer calls the unguarded writeFile', !/case 'fs-write':.*OS_COMMON\.writeFile\(/.test(worker));
check('fs-rename RPC routes through renameGuarded honoring noReplace',
  worker.includes('renameGuarded') && worker.includes('q.noReplace'));

if (failed) process.exit(1);
console.log('test_fs_guard: atomic exclusive-create, snapshot-conditional write, and no-replace rename guards passed');
