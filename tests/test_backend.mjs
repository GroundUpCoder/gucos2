// test_backend.mjs — start the built backend against the built dist and
// assert the serving contract: health, redirect, COOP/COEP on every path,
// the two cache tiers, honest 404s, and the PWA endpoints.
// Requires backend/dist and frontend/dist (the runner builds both first).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const DIST = path.join(APP, 'frontend', 'dist');
const PORT = 8917;
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ok  ${name}`); }
  else { failures++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const builtPaths = await import(path.join(APP, 'backend', 'dist', 'paths.js'));
check('compiled backend resolves this checkout as its repository root', builtPaths.REPO_DIR === APP,
  `resolved ${builtPaths.REPO_DIR}, expected ${APP}`);
check('default dist belongs to this checkout', builtPaths.FRONTEND_DIST_DIR === DIST,
  `resolved ${builtPaths.FRONTEND_DIST_DIR}, expected ${DIST}`);

const serverEnv = { ...process.env, GUCOS2_PORT: String(PORT) };
delete serverEnv.GUCOS2_DIST;
const srv = spawn(process.execPath, [path.join(APP, 'backend', 'dist', 'bin', 'server.js')], {
  env: serverEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvLog = '';
srv.stdout.on('data', (d) => { srvLog += d; });
srv.stderr.on('data', (d) => { srvLog += d; });

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

try {
  check('server came up', await waitUp(), srvLog.slice(0, 400));

  const health = await fetch(`${BASE}/api/health`);
  check('health is 200 JSON {status:ok}', health.status === 200
    && (await health.json()).status === 'ok');
  check('health has COOP/COEP too',
    health.headers.get('cross-origin-opener-policy') === 'same-origin'
    && health.headers.get('cross-origin-embedder-policy') === 'require-corp');
  const csp = health.headers.get('content-security-policy') ?? '';
  check('CSP permits required providers/workers without unsafe-inline scripts',
    csp.includes("script-src 'self' 'wasm-unsafe-eval'")
    && csp.includes("worker-src 'self' blob:")
    && csp.includes('https://api.deepseek.com')
    && csp.includes('https://api.elevenlabs.io')
    && !/script-src[^;]*'unsafe-inline'/.test(csp), csp);

  const root = await fetch(`${BASE}/`);
  check('/ serves the React shell', root.status === 200
    && (await root.text()).includes('rel="manifest"'));

  const route = await fetch(`${BASE}/files/root`);
  check('React navigation route has SPA fallback', route.status === 200 && (await route.text()).includes('rel="manifest"'));
  check('React route has COOP', route.headers.get('cross-origin-opener-policy') === 'same-origin');
  check('React route has COEP', route.headers.get('cross-origin-embedder-policy') === 'require-corp');
  check('React route revalidates', route.headers.get('cache-control') === 'no-cache');

  const hostJs = await fetch(`${BASE}/host.js`);
  check('host.js has COOP/COEP too',
    hostJs.headers.get('cross-origin-opener-policy') === 'same-origin'
    && hostJs.headers.get('cross-origin-embedder-policy') === 'require-corp');
  check('host.js revalidates', hostJs.headers.get('cache-control') === 'no-cache');

  const imageJson = JSON.parse(fs.readFileSync(path.join(DIST, 'os', 'image.json'), 'utf-8'));
  const hashed = await fetch(`${BASE}${imageJson.image}`, { method: 'HEAD' });
  check('hashed image is immutable',
    hashed.headers.get('cache-control') === 'public, max-age=31536000, immutable');
  const fixed = await fetch(`${BASE}/os/os-system.img`, { method: 'HEAD' });
  check('fixed-name image revalidates', fixed.headers.get('cache-control') === 'no-cache');
  const info=JSON.parse(fs.readFileSync(path.join(DIST,'build-info.json'),'utf8'));
  const generated=await fetch(`${BASE}/runtime/${info.runtimeGeneration}/os/kernel-worker.js`,{method:'HEAD'});
  check('pinned runtime generation is immutable',generated.headers.get('cache-control')==='public, max-age=31536000, immutable');

  const pool = fs.readdirSync(path.join(DIST, 'packages', 'pool'))[0];
  const poolRes = await fetch(`${BASE}/packages/pool/${pool}`, { method: 'HEAD' });
  check('package pool is immutable',
    poolRes.headers.get('cache-control') === 'public, max-age=31536000, immutable');
  const idxRes = await fetch(`${BASE}/packages/index.json`, { method: 'HEAD' });
  check('package index revalidates', idxRes.headers.get('cache-control') === 'no-cache');

  const missing = await fetch(`${BASE}/os/definitely-missing.js`);
  check('missing files 404 honestly (no SPA fallback)', missing.status === 404);

  const sw = await fetch(`${BASE}/sw.js`);
  check('sw.js served, revalidating', sw.status === 200
    && sw.headers.get('cache-control') === 'no-cache');
  const wm = await fetch(`${BASE}/manifest.webmanifest`);
  check('manifest.webmanifest served', wm.status === 200);
} finally {
  srv.kill('SIGTERM');
}

if (failures) { console.error(`test_backend: ${failures} failure(s)`); process.exit(1); }
console.log('test_backend: all checks passed');
