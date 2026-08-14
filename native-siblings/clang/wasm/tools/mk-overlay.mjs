#!/usr/bin/env node
// mk-overlay.mjs — the overlay@1 PUBLISHER (todos/0051).
//
// Turns this repo's private input manifest (wasm/image/manifest.json) into a
// verifiable, provenance-stamped **overlay@1** artifact under out-image/ that
// the sibling c-compiler bake (tools/mkimage.js, todos/0118) can OPTIONALLY
// apply behind its own opt-in flag. This side only PRODUCES — it never touches
// c-compiler, and c-compiler's bake never triggers this repo's ~30-min
// out/llvm build (design decision #1: prebuilt bytes + a JSON manifest,
// the consumer just reads JSON, verifies hashes, and plants bytes).
//
//   node wasm/tools/mk-overlay.mjs                       # -> out-image/
//   node wasm/tools/mk-overlay.mjs --out=DIR [--manifest=PATH] [--quiet]
//
// Emits out-image/overlay.json per the FROZEN overlay@1 contract (see
// todos/0051 — the single cross-repo interface; if it must change, bump to
// overlay@2 and update both tasks together):
//   { schema:"overlay@1", id, provenance{repo,compiler,libc,...}, dirs[], files{} }
// Every `bin` file entry carries a lowercase-hex sha256 + byte size the consumer
// re-verifies before planting. The .wasm PAYLOADS are byte-reproducible (same
// inputs -> same hashes; wasm-ld bakes the output basename, so we build straight
// to the final name); only overlay.json's builtAtUtc/provenance vary per run.
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));      // wasm/tools
const ROOT = path.resolve(HERE, '..', '..');                   // repo root
const CC2WASM = path.join(ROOT, 'cc2wasm');
const CC_ROOT = process.env.CC_ROOT || path.join(os.homedir(), 'git', 'c-compiler');

let outDir = path.join(ROOT, 'out-image');
let manifestPath = path.join(ROOT, 'wasm', 'image', 'manifest.json');
let quiet = false;
let reuse = false;
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--out=')) outDir = path.resolve(a.slice(6));
  else if (a.startsWith('--manifest=')) manifestPath = path.resolve(a.slice(11));
  else if (a === '--quiet') quiet = true;
  else if (a === '--reuse') reuse = true;
  else { process.stderr.write(`mk-overlay: unknown option ${a}\n`); process.exit(2); }
}
const log = quiet ? () => {} : (m) => process.stderr.write('[mk-overlay] ' + m + '\n');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Expand ~ and $CC_ROOT/${CC_ROOT} in a manifest path.
function expand(p) {
  if (p.startsWith('~')) p = os.homedir() + p.slice(1);
  return p.replace(/\$\{CC_ROOT\}|\$CC_ROOT/g, CC_ROOT);
}

// Best-effort git query in a repo dir; returns trimmed stdout or null.
function git(dir, args) {
  try {
    const r = cp.spawnSync('git', ['-C', dir, ...args], { encoding: 'utf-8' });
    if (r.status !== 0) return null;
    return (r.stdout || '').trim();
  } catch { return null; }
}

// Read a small JSON marker; null if absent/unparseable (keeps old build trees
// working — the fields below fall back to unknown/best-effort).
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function provenance() {
  const commit = git(ROOT, ['rev-parse', 'HEAD']);
  const dirty = (git(ROOT, ['status', '--porcelain']) || '') !== '';
  // build.sh stamps simple1/out/BUILD_INFO.json at the end of a
  // successful build; extract-libc.js stamps wasm/libc/_provenance.json at
  // vendoring time (todos/0052). Read the real commits instead of guessing;
  // absent markers fall back gracefully so older trees still publish.
  const buildInfo = readJson(path.join(ROOT, 'simple1', 'out', 'BUILD_INFO.json'));
  const libcProv = readJson(path.join(ROOT, 'wasm', 'libc', '_provenance.json'));
  return {
    producer: 'clang-simplified',
    toolchain: 'cc2wasm',
    builtAtUtc: new Date().toISOString(),
    artifactRoot: '.',
    repo: {
      commit: commit || 'unknown',
      commitShort: git(ROOT, ['rev-parse', '--short', 'HEAD']) || 'unknown',
      dirty,
      branch: git(ROOT, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown',
    },
    // Which commit produced the simple1/out/llvm ELF, per its BUILD_INFO.json. The
    // ELF is a gitignored build output, so absent the marker (an older build
    // tree) this stays honestly "unknown"/false — the frozen contract allows it.
    compiler: {
      elf: 'simple1/out/llvm',
      builtFromCommit: (buildInfo && buildInfo.commit) || 'unknown',
      dirty: !!(buildInfo && buildInfo.dirty),
    },
    // The c-compiler commit wasm/libc was actually extracted from, per its
    // _provenance.json marker; falls back to the tree's current HEAD (0051's
    // best-effort) when the marker is absent.
    libc: {
      vendoredFromRepo: 'c-compiler',
      vendoredFromCommit: (libcProv && libcProv.vendoredFromCommit)
        || git(CC_ROOT, ['rev-parse', 'HEAD']) || 'unknown',
    },
  };
}

// mode per the frozen default: 0755 under /usr/bin, else 0644.
const modeFor = (dest) => (dest.startsWith('/usr/bin/') ? '0755' : '0644');

// The *-clang naming convention (todos/0065): whenever we ship a cc2wasm (clang)
// build of a program gucOS ALSO builds with its own compiler.js — i.e. a project
// compiled from a gucOS vendor tree ($CC_ROOT/vendor/<name>, its "stock twin") —
// the clang build MUST be named <name>-clang and install to a FRESH
// /usr/bin/<name>-clang path, never `override`ing the stock build, so both
// toolchains' builds coexist and can be A/B'd (doom-clang set the precedent).
// Enforced here so every future vendor variant inherits the rule automatically;
// purely in-repo demos (no vendor base) are exempt. Throws on any violation.
function enforceClangConvention(proj, base) {
  const vendorRoot = path.join(CC_ROOT, 'vendor') + path.sep;
  if (!(path.resolve(base) + path.sep).startsWith(vendorRoot)) return; // in-repo demo: exempt
  const installBase = path.posix.basename(proj.install || '');
  const errs = [];
  if (!proj.name.endsWith('-clang')) errs.push(`name "${proj.name}" must end with "-clang"`);
  if (!(proj.install || '').startsWith('/usr/bin/')) errs.push(`install "${proj.install}" must be under /usr/bin/`);
  if (!installBase.endsWith('-clang')) errs.push(`install basename "${installBase}" must end with "-clang" (fresh path, never the stock /usr/bin/${proj.name.replace(/-clang$/, '')})`);
  if (proj.override) errs.push('must not set override:true (a -clang variant is a fresh path, never a shadow of the stock build)');
  if (errs.length) throw new Error(`project ${proj.name}: violates the -clang naming convention (todos/0065):\n    - ${errs.join('\n    - ')}`);
}

function resolveSources(proj, base) {
  if (proj.binJson) {
    const bj = JSON.parse(fs.readFileSync(path.join(base, proj.binJson), 'utf-8'));
    return (bj.sources || []).map((s) => path.join(base, s));
  }
  if (Array.isArray(proj.sources)) return proj.sources.map((s) => path.join(base, s));
  throw new Error(`project ${proj.name}: needs "binJson" or "sources"`);
}

function main() {
  if (!fs.existsSync(CC2WASM)) {
    process.stderr.write('mk-overlay: no ./cc2wasm — run ./build.sh first (this tool never auto-builds the compiler)\n');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  // --reuse keeps the existing tree so present payloads are skipped (the
  // manifest below is rebuilt either way and only references files this run
  // declares); the default wipes for a from-scratch publish.
  if (!reuse) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const files = {};
  const dirSet = new Set();
  const noteDir = (dest) => { const d = path.posix.dirname(dest); if (d && d !== '/') dirSet.add(d); };

  for (const proj of manifest.projects) {
    const base = proj.base ? expand(proj.base) : ROOT;
    // The source tree's checked-out commit (best-effort) for build.sourcePin —
    // for the vendored DOOM this is the c-compiler commit; for in-repo demos,
    // this repo's HEAD.
    const srcCommit = git(base, ['rev-parse', 'HEAD']) || 'unknown';
    enforceClangConvention(proj, base);   // vendor variants must be <name>-clang
    const projOut = path.join(outDir, proj.name);
    fs.mkdirSync(projOut, { recursive: true });

    // 1. Compile the project to its .wasm (cwd = base so relative -I resolve).
    const srcs = resolveSources(proj, base);
    for (const s of srcs) if (!fs.existsSync(s)) throw new Error(`project ${proj.name}: missing source ${s}`);
    const wasmOut = path.join(projOut, proj.out);
    const flags = proj.cc2wasmFlags || [];
    // --reuse: skip the compile when the payload already exists (iteration
    // aid — a full ladder publish is many minutes of cc2wasm). The manifest
    // is still built from the file's REAL bytes below, so a reused publish
    // is honest about what it ships; the default (and the overlay-test
    // harness) always rebuilds.
    if (reuse && fs.existsSync(wasmOut)) {
      log(`reusing ${proj.name} (${path.basename(wasmOut)} present; --reuse)`);
    } else {
    log(`building ${proj.name} (${srcs.length} TU${srcs.length === 1 ? '' : 's'})${flags.length ? ' ' + flags.join(' ') : ''}`);
    const r = cp.spawnSync(CC2WASM, [...flags, ...srcs, '-o', wasmOut], { cwd: base, encoding: 'utf-8' });
    if (r.status !== 0) {
      const errs = (r.stderr || '').split('\n').filter((l) => /error/i.test(l)).slice(0, 12).join('\n');
      throw new Error(`cc2wasm failed for ${proj.name}:\n${errs || r.stderr || r.error}`);
    }
    }
    const wasmBytes = fs.readFileSync(wasmOut);
    const rel = (abs) => path.relative(outDir, abs).split(path.sep).join('/');
    files[proj.install] = {
      bin: rel(wasmOut),
      mode: modeFor(proj.install),
      sha256: sha256(wasmBytes),
      size: wasmBytes.length,
      build: {
        project: proj.name,
        cc2wasmFlags: flags,
        sourcePin: {
          repo: (proj.sourcePin && proj.sourcePin.repo) || 'clang-simplified (in-repo demo)',
          commit: (proj.sourcePin && proj.sourcePin.commit) || srcCommit,
        },
      },
      // The frozen contract forbids targeting a path the base image already owns
      // unless the entry declares override:true. All shipped projects install to
      // fresh paths (the cc2wasm DOOM is /usr/bin/doom-clang, not the stock
      // /usr/bin/doom), so override stays opt-in for the rare deliberate shadow.
      ...(proj.override ? { override: true } : {}),
    };
    noteDir(proj.install);

    // 2. Copy declared data assets (planted verbatim; not compiled).
    for (const a of (proj.assets || [])) {
      const from = path.isAbsolute(expand(a.from)) ? expand(a.from) : path.join(base, expand(a.from));
      if (!fs.existsSync(from)) throw new Error(`project ${proj.name}: missing asset ${from}`);
      const dstAbs = path.join(projOut, path.basename(a.install));
      const bytes = fs.readFileSync(from);
      fs.writeFileSync(dstAbs, bytes);
      files[a.install] = {
        bin: rel(dstAbs),
        mode: modeFor(a.install),
        sha256: sha256(bytes),
        size: bytes.length,
        asset: true,
      };
      noteDir(a.install);
      log(`  asset ${path.basename(a.install)} (${(bytes.length / (1 << 20)).toFixed(1)} MiB)`);
    }

    // 3. Register a Start-menu entry the gucOS way: /usr/share/menu/<Category>/<name>
    // is a SYMLINK to the binary (the base image's convention — os/wm.c labels the
    // entry by filename and activate() spawns straight through the symlink). gucOS
    // has NO freedesktop .desktop parser, so the entry name carries no extension and
    // the menu.name display string is unused (label = filename). Uses the overlay@1
    // `link` entry type.
    if (proj.menu) {
      const dest = `/usr/share/menu/${proj.menu.category}/${path.basename(proj.install)}`;
      files[dest] = { link: proj.install };
      noteDir(dest);
    }
  }

  const overlay = {
    schema: 'overlay@1',
    id: manifest.id,
    provenance: provenance(),
    dirs: [...dirSet].sort(),
    files,
  };
  fs.writeFileSync(path.join(outDir, 'overlay.json'), JSON.stringify(overlay, null, 2) + '\n');

  const nBin = Object.values(files).filter((f) => f.bin).length;
  const totMiB = Object.values(files).reduce((n, f) => n + (f.size || 0), 0) / (1 << 20);
  const p = overlay.provenance.repo;
  log(`published overlay "${overlay.id}" -> ${path.relative(ROOT, outDir)}/ : `
    + `${Object.keys(files).length} files (${nBin} payloads, ${totMiB.toFixed(1)} MiB), `
    + `repo ${p.commitShort}${p.dirty ? ' (dirty)' : ''}`);
}

try { main(); } catch (e) {
  process.stderr.write('mk-overlay failed: ' + (e && e.message || e) + '\n');
  process.exit(1);
}
