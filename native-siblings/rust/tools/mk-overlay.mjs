#!/usr/bin/env node
// tools/mk-overlay.mjs — publish the `rust-apps` overlay@1 manifest
// (c-compiler todos/0416: the native-sibling packaging seam).
//
// This repository is the ONE producer of Rust binaries for gucOS (RUST.md §3
// rule 4); the c-compiler repo CONSUMES the artifact this script publishes —
// `tools/mkpkg.js --rust` copies each payload out of out-image/ and verifies
// it against the sha256 recorded here (the same overlay@1 schema and the same
// verifier the clang-simplified sibling's out-image/overlay.json rides).
//
// Only SHIPPING TOOLS are published. hello-rust and alloc-rust are
// acceptance demos consumed as committed fixtures by the c-compiler kernel
// suite (test_rust_e2e.js), not user-installable tools — publishing them here
// would force a package or an explicit exemption for each (mkpkg's drift
// gate demands every published /usr/bin payload be reachable through gucman).
//
//   ./build.sh                      # produce out/*.wasm first
//   node tools/mk-overlay.mjs      # publish out-image/overlay.json
//
// out-image/ is a BUILT artifact (gitignored), re-published after any build
// whose bytes should ship. Layout mirrors clang-simplified's:
//   out-image/<app>/<app>.wasm     the payload bytes
//   out-image/overlay.json         the overlay@1 manifest (atomic rename)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_IMAGE = path.join(ROOT, 'out-image');

// The shipping tool set: out/<name>.wasm -> /usr/bin/<name>.
const APPS = ['wc-rust'];

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8' }).trim();
  } catch (e) { return ''; }
}

const files = {};
for (const app of APPS) {
  const src = path.join(ROOT, 'out', `${app}.wasm`);
  if (!fs.existsSync(src)) {
    console.error(`mk-overlay: no ${src}`);
    console.error('  the overlay publishes built artifacts; build them first:');
    console.error(`    cd ${ROOT} && ./build.sh`);
    process.exit(1);
  }
  const bytes = fs.readFileSync(src);
  const dir = path.join(OUT_IMAGE, app);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${app}.wasm`), bytes);
  files[`/usr/bin/${app}`] = {
    bin: `${app}/${app}.wasm`,
    mode: '0755',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  };
}

const commit = git(['rev-parse', 'HEAD']);
const manifest = {
  schema: 'overlay@1',
  id: 'rust-apps',
  provenance: {
    producer: 'gucos-rust',
    toolchain: 'rustc/wasm32-unknown-unknown + clang-simplified libc objects',
    builtAtUtc: new Date().toISOString(),
    artifactRoot: '.',
    repo: {
      commit,
      commitShort: commit.slice(0, 7),
      dirty: git(['status', '--porcelain']) !== '',
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    },
  },
  dirs: ['/usr/bin'],
  files,
};

const dest = path.join(OUT_IMAGE, 'overlay.json');
const tmp = dest + '.tmp-' + process.pid;
fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n');
fs.renameSync(tmp, dest);
console.log(`overlay.json: ${Object.keys(files).length} file(s) published at ${dest}`);
