// run.mjs — the gucos2 test entry point. Serial by design (the boot leg is
// RAM-heavy and joins the machine-wide heavy-test lock).
//
//   node tests/run.mjs             # full suite: build both ends, then test
//   node tests/run.mjs --no-boot   # skip both heavy boot-backed legs
//
// The record states its own scope: the summary prints selected/executed/
// passed/failed and writes build/test-summary.json with done:true only when
// every selected member executed. A member that did not run is a FAIL, never
// a skip — a SKIP is not a PASS.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const noBoot = process.argv.includes('--no-boot');

const MEMBERS = [
  { name: 'build-frontend', cmd: process.execPath, args: [path.join(APP, 'scripts', 'build-dist.mjs')], cwd: APP },
  { name: 'build-backend', cmd: 'pnpm', args: ['install', '--prod=false'], cwd: path.join(APP, 'backend'), then: { cmd: 'pnpm', args: ['build'] } },
  { name: 'test-frontend-unit', cmd: 'pnpm', args: ['test'], cwd: path.join(APP, 'frontend') },
  { name: 'test_source', cmd: process.execPath, args: [path.join(HERE, 'test_source.mjs')], cwd: APP },
  { name: 'test_fs_guard', cmd: process.execPath, args: [path.join(HERE, 'test_fs_guard.mjs')], cwd: APP },
  { name: 'test_dist', cmd: process.execPath, args: [path.join(HERE, 'test_dist.mjs')], cwd: APP },
  { name: 'test_packages', cmd: process.execPath, args: [path.join(HERE, 'test_packages.mjs')], cwd: APP, heavy: true },
  { name: 'test_backend', cmd: process.execPath, args: [path.join(HERE, 'test_backend.mjs')], cwd: APP },
  { name: 'test_browser', cmd: process.execPath, args: [path.join(HERE, 'test_browser.mjs')], cwd: APP },
  { name: 'test_chat_agent', cmd: process.execPath, args: [path.join(HERE, 'test_chat_agent.mjs')], cwd: APP },
  { name: 'test_chat_streaming', cmd: process.execPath, args: [path.join(HERE, 'test_chat_streaming.mjs')], cwd: APP },
  { name: 'test_graphical', cmd: process.execPath, args: [path.join(HERE, 'test_graphical.mjs')], cwd: APP },
  { name: 'test_boot', cmd: process.execPath, args: [path.join(HERE, 'test_boot.mjs')], cwd: APP, heavy: true },
];

// Environment-dependent contracts are declared here, not silently skipped.
// Run them explicitly after supplying their required inputs.
const ACCEPTANCE_MEMBERS = [
  { name: 'test_stt_real_media', file: 'test_stt_real_media.mjs', requires: ['OS_STT_AUDIO'] },
];

const registeredTestFiles = new Set([
  ...MEMBERS.flatMap(member => member.args?.filter(arg => typeof arg === 'string' && /test_[^/]+\.mjs$/.test(arg)).map(arg => path.basename(arg)) ?? []),
  ...ACCEPTANCE_MEMBERS.map(member => member.file),
]);
const diskTestFiles = fs.readdirSync(HERE).filter(name => /^test_.*\.mjs$/.test(name));
const unregistered = diskTestFiles.filter(name => !registeredTestFiles.has(name));
const missing = [...registeredTestFiles].filter(name => !diskTestFiles.includes(name));
if (unregistered.length || missing.length) {
  throw new Error(`test registry mismatch; unregistered=[${unregistered.join(', ')}], missing=[${missing.join(', ')}]`);
}

const selected = MEMBERS.filter((m) => !(noBoot && m.heavy));
const results = [];
const t0 = Date.now();
for (const m of selected) {
  const started = Date.now();
  process.stdout.write(`\n=== ${m.name} ===\n`);
  let r = spawnSync(m.cmd, m.args, { cwd: m.cwd, stdio: 'inherit', timeout: 90 * 60 * 1000 });
  if (r.status === 0 && m.then) {
    r = spawnSync(m.then.cmd, m.then.args, { cwd: m.cwd, stdio: 'inherit', timeout: 90 * 60 * 1000 });
  }
  const status = r.status === 0 ? 'pass' : 'fail';
  results.push({ name: m.name, status, exit: r.status, ms: Date.now() - started });
  if (status === 'fail') {
    console.error(`\n${m.name} FAILED (exit ${r.status}${r.signal ? ', signal ' + r.signal : ''}) — stopping.`);
    break;
  }
}

const executed = results.length;
const passed = results.filter((r) => r.status === 'pass').length;
const failed = executed - passed;
const summary = {
  done: executed === selected.length,
  total: MEMBERS.length,
  selected: selected.length,
  executed,
  passed,
  failed,
  omitted: MEMBERS.filter((m) => !selected.includes(m)).map((m) => m.name),
  acceptance: ACCEPTANCE_MEMBERS.map(member => ({ ...member, executed: false })),
  results,
  elapsedMs: Date.now() - t0,
};
fs.mkdirSync(path.join(APP, 'build'), { recursive: true });
fs.writeFileSync(path.join(APP, 'build', 'test-summary.json'), JSON.stringify(summary, null, 2) + '\n');

console.log(`\n=== gucos2 tests: ${passed}/${selected.length} passed, ${failed} failed, `
  + `${summary.omitted.length} deliberately omitted (${summary.omitted.join(', ') || 'none'}) ===`);
if (!summary.done || failed) process.exit(1);
