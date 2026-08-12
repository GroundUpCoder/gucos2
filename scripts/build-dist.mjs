// build-dist.mjs — assemble the static Cloudflare Pages output.
//
// This is the fork-local descendant of comguc/scripts/build.mjs (the script
// that builds the groundupcoder.com apex from ~/git/c-compiler): the whole
// site IS the gucOS tree — os/os.html sits at /os/ and its relative refs
// (../host.js, ../vendor/...) resolve against the site root, so we mirror
// the guc/ repo layout under dist/ and let / redirect to /os/ (backend +
// Caddy). Differences from comguc, all deliberate:
//   • sources come from the SELF-CONTAINED os/guc mirror (c-compiler pinned
//     at upstream.json's commit), never from ~/git/c-compiler;
//   • the package index is the BASE set (no clang/rust sibling repos here —
//     the gated packages/<n>-clang.json definitions are skipped by mkpkg by
//     construction);
//   • PWA: manifest + service worker + generated icons, injected into the
//     served os.html copies at assembly time (guc/ itself stays pristine);
//   • frontend/public owns the Pages header and routing model; the local
//     server mirrors it for acceptance tests;
//   • bumps frontend/build-number.txt (deploy.sh requires it to advance).
//
// Steps:
//   0. deck content-safety allowlist guard (BEFORE the bake — carried from
//      comguc #584; the public origin must never serve unreleased decks)
//   1. bake a fresh MINIMAL os-system.img via guc/tools/mkimage.js
//      (+ the content-hashed immutable twin, the todos/0249 pattern)
//   2. build the gucman package repo via guc/tools/mkpkg.js (base index) and
//      copy pool/* + index.json → dist/packages/
//   3. copy the runtime allowlist (never the vendor source tree)
//   4. transform image.json: strip ROM seeds/launchers, point manifest.image
//      at the hashed blob
//   5. PWA assembly: icons, manifest.webmanifest, sw.js + <head> injection
//   6. ROM + deck leak guard (loose files AND inside package payloads)
//   7. provenance (build-info.json) + build-number bump
//
// Usage: node scripts/build-dist.mjs   (or: pnpm build, from frontend/)
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeIcons } from './gen-icons.mjs';
import { preserveImmutableAssets, restoreImmutableAssets } from './immutable-dist.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const GUC = path.join(APP, 'guc');                    // the faithful mirror
const DIST = path.join(APP, 'frontend', 'dist');
const BN_FILE = path.join(APP, 'frontend', 'build-number.txt');

if (!fs.existsSync(path.join(GUC, 'os', 'image.json'))) {
  console.error(`build: gucOS mirror not found at ${GUC} (os/guc/os/image.json missing)`);
  process.exit(1);
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// --- 0. deck content-safety guard (comguc #584, carried verbatim) -----------
const DECK_ALLOWLIST = new Set(['gucos.deck', 'deck-title.png']);
const DECK_DEMO_DIR = path.join(GUC, 'os', 'deck', 'demo');
function failDeckGuard(violations) {
  console.error('build: DECK CONTENT BLOCKED — ' + violations.join(', '));
  console.error('  The deck allowlist (DECK_ALLOWLIST in scripts/build-dist.mjs) is a content-');
  console.error('  safety boundary: the public origin must never serve unreleased deck content');
  console.error('  (standing rule deck-013-never-seeded, 2026-07-24). Do NOT widen the allowlist');
  console.error('  unless that exact content has been cleared for public release.');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(path.join(GUC, 'os', 'image.json'), 'utf-8'));
// The fork's product manifest is CLI-only. Keep the upstream manifest as an
// auditable source input, but remove every desktop/runtime entry before bake.
const GUI_PATH = /(?:^\/usr\/lib\/ksvc|^\/usr\/share\/(?:fonts|sounds|menu|mgp|deck|display|screensaver|term|openwith|keys)|^\/usr\/bin\/(?:wm|wmctl|term|software|desktop-defaults|snake|deck|mgp|mgpp|calc|notepad|fileman|paint|ctlpanel|filepick)|^\/root\/Desktop)/;
manifest.defaultPackages = [];
manifest.overlays = [];
manifest.system.files['/usr/bin/init'] = { c: 'init.c' };
manifest.system.dirs = manifest.system.dirs.filter((p) => !GUI_PATH.test(p));
for (const p of Object.keys(manifest.system.files)) if (GUI_PATH.test(p)) delete manifest.system.files[p];
if (manifest.user) {
  manifest.user.dirs = (manifest.user.dirs || []).filter((p) => !GUI_PATH.test(p));
  for (const p of Object.keys(manifest.user.files || {})) if (GUI_PATH.test(p)) delete manifest.user.files[p];
}
const CLI_MANIFEST = path.join(APP, 'build', 'cli-image.json');
fs.mkdirSync(path.dirname(CLI_MANIFEST), { recursive: true });
fs.writeFileSync(CLI_MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
{
  const violations = [];
  if (fs.existsSync(DECK_DEMO_DIR)) {
    for (const name of fs.readdirSync(DECK_DEMO_DIR)) {
      if (!DECK_ALLOWLIST.has(name)) violations.push(`os/deck/demo/${name} (present in the globbed demo dir)`);
    }
  }
  const manifestJson = JSON.stringify(manifest);
  const deckRefs = new Set([
    ...(manifestJson.match(/[A-Za-z0-9._/-]+\.deck\b/g) || []),
    ...(manifestJson.match(/os\/deck\/demo\/[A-Za-z0-9._/-]+/g) || []),
  ]);
  for (const ref of deckRefs) {
    if (!DECK_ALLOWLIST.has(ref.split('/').pop())) violations.push(`${ref} (referenced by image.json)`);
  }
  if (violations.length) failDeckGuard([...new Set(violations)]);
  console.log(`[build] deck guard: demo dir + manifest refs all on the ${DECK_ALLOWLIST.size}-name allowlist ✓`);
}

// --- 1. fresh mutable dist, retain every prior immutable URL ----------------
const immutableBackup = fs.mkdtempSync(path.join(os.tmpdir(), 'gucos2-immutable-'));
const cleanupImmutableBackup = () => fs.rmSync(immutableBackup, { recursive: true, force: true });
process.once('exit', cleanupImmutableBackup);
preserveImmutableAssets(DIST, immutableBackup);
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'os'), { recursive: true });

console.log('[build] baking the minimal os-system.img via guc/tools/mkimage.js …');
const bake = spawnSync(process.execPath,
  ['--experimental-wasm-exnref', path.join(GUC, 'tools', 'mkimage.js'), `--out=${path.join(DIST, 'os', 'os-system.img')}`, `--manifest=${CLI_MANIFEST}`, '--quiet'],
  { cwd: GUC, stdio: 'inherit' });
if (bake.status !== 0) { console.error('build: mkimage failed'); process.exit(1); }

const imgSha256 = sha256File(path.join(DIST, 'os', 'os-system.img'));
const IMG_HASHED = `os-system.${imgSha256.slice(0, 16)}.img`;
fs.copyFileSync(path.join(DIST, 'os', 'os-system.img'), path.join(DIST, 'os', IMG_HASHED));
console.log(`[build] image published as ${IMG_HASHED} (immutable) + os-system.img (compat)`);

// --- 2. build + copy the gucman package repo (BASE index) -------------------
console.log('[build] building gucman packages via guc/tools/mkpkg.js …');
const packageSet = JSON.parse(fs.readFileSync(path.join(APP, 'package-repository-set.json'), 'utf8'));
const CLI_PACKAGES = [...packageSet.publishedDefinitions, ...packageSet.publishedSourceCompanions];
const mkpkg = spawnSync(process.execPath, ['--experimental-wasm-exnref', path.join(GUC, 'tools', 'mkpkg.js'), '--quiet', `--manifest=${CLI_MANIFEST}`, ...CLI_PACKAGES],
  { cwd: GUC, stdio: 'inherit' });
if (mkpkg.status !== 0) { console.error('build: mkpkg failed'); process.exit(1); }
const PKG_SRC = path.join(GUC, 'dist', 'packages');

// --- runtime allowlist ------------------------------------------------------
const ROOT_JS = ['host.js', 'kernel.js', 'compiler.js', 'libc-ext.js'];
const OS_FILES = ['kernel-worker.js', 'process-worker.js', 'os-common.js', 'hello.c'];
const VENDOR_FILES = [
  'vendor/xterm/xterm.css',
  'vendor/xterm/xterm.js',
  'vendor/xterm/xterm-addon-fit.js',
];
function walkMgp(dir, rel, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const r = rel + '/' + name;
    if (fs.statSync(full).isDirectory()) walkMgp(full, r, out);
    else if (name.endsWith('.mgp')) out.push(r);
  }
}
const MAGICPOINT_FILES = [];
// No desktop decks or graphical application assets in the CLI distribution.
const DECK_FILES = [];

// --- 3. copy allowlist + the package repo ----------------------------------
function copy(rel, destRel = rel) {
  const src = path.join(GUC, rel);
  const dst = path.join(DIST, destRel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return fs.statSync(dst).size;
}

let bytes = fs.statSync(path.join(DIST, 'os', 'os-system.img')).size;
bytes += fs.statSync(path.join(DIST, 'os', IMG_HASHED)).size;
for (const f of ROOT_JS) bytes += copy(f);
for (const f of OS_FILES) bytes += copy(path.join('os', f), path.join('os', f));
for (const f of VENDOR_FILES) bytes += copy(f);
for (const f of MAGICPOINT_FILES) bytes += copy(f);
for (const f of DECK_FILES) bytes += copy(f);

const runtimeHash = crypto.createHash('sha256').update(imgSha256);
for (const f of ROOT_JS) runtimeHash.update(fs.readFileSync(path.join(GUC, f)));
for (const f of OS_FILES) runtimeHash.update(fs.readFileSync(path.join(GUC, 'os', f)));
const runtimeGeneration = runtimeHash.digest('hex').slice(0, 16);

let pkgBytes = 0;
const poolFiles = fs.readdirSync(path.join(PKG_SRC, 'pool'));
for (const f of poolFiles) {
  pkgBytes += (() => {
    const dst = path.join(DIST, 'packages', 'pool', f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(PKG_SRC, 'pool', f), dst);
    return fs.statSync(dst).size;
  })();
}
{
  const dst = path.join(DIST, 'packages', 'index.json');
  fs.copyFileSync(path.join(PKG_SRC, 'index.json'), dst);
  pkgBytes += fs.statSync(dst).size;
}
bytes += pkgBytes;
console.log(`[build] packages: ${poolFiles.length} payload(s), ${(pkgBytes / (1 << 20)).toFixed(1)} MiB → /packages/`);

// --- 4. transform image.json (strip ROM seeds + launchers, point at blob) ---
const removed = [];
if (manifest.user && manifest.user.files) {
  for (const [p, e] of Object.entries(manifest.user.files)) {
    const isRomBin = e && typeof e.bin === 'string' && e.bin.startsWith('vendor/gameboy/roms/');
    const isRomLauncher = e && typeof e.content === 'string' && /\/roms\//.test(e.content);
    if (isRomBin || isRomLauncher) { delete manifest.user.files[p]; removed.push(p); }
  }
}
if (manifest.user && Array.isArray(manifest.user.dirs)) {
  manifest.user.dirs = manifest.user.dirs.filter((d) => d !== '/root/roms');
}
manifest.image = '/os/' + IMG_HASHED;
fs.writeFileSync(path.join(DIST, 'os', 'image.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`[build] image.json: removed ${removed.length} ROM entries → ${removed.join(', ') || '(none)'}`);

// Cross-check: every user-section seed the manifest fetches over HTTP at
// first boot MUST be shipped, or the OS 404s and never reaches ready.
const seedRefs = [...new Set(
  (JSON.stringify(manifest.user || {}).match(/(?:vendor\/magicpoint|os\/deck\/demo)\/[A-Za-z0-9._/-]+/g) || []))];
const seedMissing = seedRefs.filter((r) => !fs.existsSync(path.join(DIST, r)));
if (seedMissing.length) {
  console.error('build: user-seeded assets referenced by image.json are missing from dist/ — '
    + seedMissing.join(', '));
  process.exit(1);
}
console.log(`[build] user seeds: ${seedRefs.length} asset(s) shipped, all present ✓`);

// Immutable, self-contained ABI generation. A booted kernel and every nested
// process worker resolve host/kernel/compiler/os-common from this directory;
// a deploy therefore cannot change bytes underneath a running session.
const generationRoot = path.join(DIST, 'runtime', runtimeGeneration);
for (const f of ROOT_JS) {
  const dst = path.join(generationRoot, f); fs.mkdirSync(path.dirname(dst), {recursive:true}); fs.copyFileSync(path.join(DIST, f), dst);
}
for (const f of OS_FILES) {
  const dst = path.join(generationRoot, 'os', f); fs.mkdirSync(path.dirname(dst), {recursive:true}); fs.copyFileSync(path.join(DIST, 'os', f), dst);
}
fs.copyFileSync(path.join(DIST, 'os', 'image.json'), path.join(generationRoot, 'os', 'image.json'));
restoreImmutableAssets(DIST, immutableBackup);
process.removeListener('exit', cleanupImmutableBackup);
console.log(`[build] runtime ABI generation ${runtimeGeneration} pinned under /runtime/`);

// --- 5. PWA + React assembly ------------------------------------------------
writeIcons(path.join(DIST, 'icons'));
fs.copyFileSync(path.join(APP, 'frontend', 'pwa', 'manifest.webmanifest'),
  path.join(DIST, 'manifest.webmanifest'));
fs.writeFileSync(path.join(DIST, 'sw.js'), fs.readFileSync(path.join(APP, 'frontend', 'pwa', 'sw.js'), 'utf8').replaceAll('__RUNTIME_GENERATION__', runtimeGeneration));

let bn = 0;
try { bn = parseInt(fs.readFileSync(BN_FILE, 'utf-8').trim(), 10) || 0; } catch { /* first build */ }
bn++;
fs.writeFileSync(BN_FILE, `${bn}\n`);
const vite = spawnSync('pnpm', ['run', 'build:vite'], {
  cwd: path.join(APP, 'frontend'), stdio: 'inherit',
  env: { ...process.env, GUCOS2_BUILD_NUMBER: String(bn), GUCOS2_RUNTIME_GENERATION: runtimeGeneration },
});
if (vite.status !== 0) { console.error('build: Vite React build failed'); process.exit(1); }
console.log('[build] PWA: React/Vite shell + manifest + service worker + icons emitted ✓');

// --- 6. ROM + deck leak guard (loose AND inside package payloads) -----------
const leaks = [];
const deckLeaks = [];
(function scan(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) scan(full);
    else if (/\.gbc?$/i.test(name)) leaks.push(path.relative(DIST, full));
    else if (/\.deck$/i.test(name) && !DECK_ALLOWLIST.has(name)) deckLeaks.push(path.relative(DIST, full));
  }
})(DIST);
function tarMemberNames(buf) {
  const names = [];
  for (let off = 0; off + 512 <= buf.length;) {
    const name = buf.toString('utf-8', off, off + 100).replace(/\0.*$/, '');
    if (!name) break;
    const prefix = buf.toString('utf-8', off + 345, off + 500).replace(/\0.*$/, '');
    names.push(prefix ? prefix + '/' + name : name);
    const size = parseInt(buf.toString('ascii', off + 124, off + 135).replace(/\0.*$/, '').trim() || '0', 8) || 0;
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}
const POOL = path.join(DIST, 'packages', 'pool');
if (fs.existsSync(POOL)) {
  for (const f of fs.readdirSync(POOL)) {
    if (!f.endsWith('.tar.gz')) continue;
    let members;
    try { members = tarMemberNames(zlib.gunzipSync(fs.readFileSync(path.join(POOL, f)))); }
    catch (e) { console.error(`build: unreadable package payload packages/pool/${f} — ${e.message}`); process.exit(1); }
    for (const m of members) {
      if (/\.gbc?$/i.test(m) || /(^|\/)roms\//.test(m)) leaks.push(`packages/pool/${f} :: ${m}`);
      if (/\.deck$/i.test(m) && !DECK_ALLOWLIST.has(m.split('/').pop())) deckLeaks.push(`packages/pool/${f} :: ${m}`);
    }
  }
}
const imgJson = fs.readFileSync(path.join(DIST, 'os', 'image.json'), 'utf-8');
if (/gameboy\/roms|\/roms\//.test(imgJson)) leaks.push('image.json references roms/');
if (leaks.length) { console.error('build: ROM LEAK — ' + leaks.join(', ')); process.exit(1); }
if (deckLeaks.length) failDeckGuard(deckLeaks);
console.log('[build] ROM + deck guard: dist/ + every package payload scanned, clean ✓');

// --- 7. provenance + build number ------------------------------------------
function repoState(dir) {
  try {
    const commit = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    const dirty = execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf-8' }).trim() !== '';
    return { available: true, commit, abbrev: commit.slice(0, 8), dirty };
  } catch {
    return { available: false };
  }
}
const upstream = JSON.parse(fs.readFileSync(path.join(APP, 'upstream.json'), 'utf-8'));
const gucos2 = repoState(APP);

const publicInfo = {
  builtAt: new Date().toISOString(),
  app: 'gucos2',
  build: bn,
  runtimeGeneration,
  gucos2: gucos2.available ? { commit: gucos2.commit, abbrev: gucos2.abbrev, dirty: gucos2.dirty } : { available: false },
  upstream,               // the c-compiler commit os/guc mirrors (see PROVENANCE.md)
  imgSha256,
  image: IMG_HASHED,
  packages: 'cli',
  bytes,
  node: process.version,
};
fs.writeFileSync(path.join(DIST, 'build-info.json'), JSON.stringify(publicInfo, null, 2) + '\n');

console.log(`[build] provenance: gucos2 ${gucos2.available ? gucos2.abbrev + (gucos2.dirty ? '-dirty' : '') : 'n/a'}, upstream c-compiler ${upstream.commit.slice(0, 8)}, img ${imgSha256.slice(0, 12)}…`);
console.log(`[build] dist/ ready — build ${bn}, ${(bytes / (1 << 20)).toFixed(1)} MiB, ROM-clean + deck-clean ✓`);
