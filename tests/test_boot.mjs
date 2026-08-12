// test_boot.mjs — the fork REALLY IS gucOS: boot the OS headless from the
// self-contained os/guc tree (guc/os/boot.js — same kernel, same manifest,
// same shell as the served page, tty on stdio) and drive the shell.
//
// The boot uses a throwaway image pair in a mkdtemp (never contends with
// another boot's lockfile) with --packages=none, which matches the deployed
// artifact (the minimal bake). boot.js joins the machine-wide heavy-test
// lock; --wait-lock queues politely behind any running gate rather than
// failing — a boot may wait behind a gate, never the reverse.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const GUC = path.join(APP, 'guc');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ok  ${name}`); }
  else { failures++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gucos2-boot-'));
const image = path.join(tmp, 'fork-system.img');
const script = [
  'ls /bin',
  'echo FORK-MARKER-$((6*7))',
  'cat /usr/share/os-release',
  'exit',
].join('\n') + '\n';

console.log('  booting guc/os/boot.js (headless, minimal image, throwaway pair)…');
const r = spawnSync(process.execPath,
  [path.join(GUC, 'os', 'boot.js'), `--image=${image}`,
   `--manifest=${path.join(APP,'build','cli-image.json')}`,
   `--fixture=${path.join(APP,'frontend','dist','os','os-system.img')}`,
   '--stale-ok', '--packages=none', '--no-default-packages', '--wait-lock=1800'],
  { cwd: GUC, input: script, encoding: 'utf-8', maxBuffer: 64 << 20, timeout: 40 * 60 * 1000 });

const out = (r.stdout || '') + (r.stderr || '');
if (r.status !== 0) console.error(out.slice(-4000));
check('boot exited 0', r.status === 0, `status=${r.status} signal=${r.signal}`);
check('shell ran the arithmetic marker', out.includes('FORK-MARKER-42'));
check('/bin has the shell', /\bsh\b/.test(out));
check('/bin has the compiler driver', /\bcc\b/.test(out));
check('/bin excludes the window manager', !/\bwm\b/.test(out));
check('os-release names gucOS', /gucOS|guc/i.test(out));
check('os-release carries the manifest version',
  new RegExp(`VERSION_ID=${JSON.parse(fs.readFileSync(path.join(GUC, 'os', 'image.json'), 'utf-8')).version}\\b`).test(out));

fs.rmSync(tmp, { recursive: true, force: true });

if (failures) { console.error(`test_boot: ${failures} failure(s)`); process.exit(1); }
console.log('test_boot: all checks passed');
