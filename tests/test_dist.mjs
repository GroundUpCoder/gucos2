// test_dist.mjs — assert the assembled frontend/dist is a serving gucOS
// origin: structure, image seal + fsck, package repo integrity, PWA assembly,
// provenance, and the ROM/deck cleanliness the build guards promised.
// Requires a built dist (the runner builds it first).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const GUC = path.join(APP, 'guc');
const DIST = path.join(APP, 'frontend', 'dist');
const require = createRequire(import.meta.url);

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ok  ${name}`); }
  else { failures++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// --- structure --------------------------------------------------------------
const mustExist = [
  'index.html', 'os/image.json', 'os/os-system.img',
  'host.js', 'kernel.js', 'compiler.js', 'libc-ext.js',
  'os/kernel-worker.js', 'os/process-worker.js', 'os/os-common.js',
  'vendor/xterm/xterm.js', 'vendor/xterm/xterm.css', 'vendor/xterm/xterm-addon-fit.js',
  'packages/index.json',
  'manifest.webmanifest', 'favicon.svg', 'sw.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png',
  'build-info.json', '_headers', '_redirects', '404.html',
];
for (const f of mustExist) check(`dist/${f} exists`, fs.existsSync(path.join(DIST, f)));
const pagesHeaders = fs.readFileSync(path.join(DIST, '_headers'), 'utf8');
const pagesRedirects = fs.readFileSync(path.join(DIST, '_redirects'), 'utf8');
check('Pages headers require cross-origin isolation',
  pagesHeaders.includes('Cross-Origin-Opener-Policy: same-origin') &&
  pagesHeaders.includes('Cross-Origin-Embedder-Policy: require-corp'));
check('Pages headers keep content-addressed assets immutable',
  pagesHeaders.includes('/runtime/*') && pagesHeaders.includes('/packages/pool/*') &&
  pagesHeaders.includes('max-age=31536000, immutable'));
check('Pages routing has explicit SPA routes and a real 404 boundary',
  pagesRedirects.includes('/chat/* / 200') &&
  pagesRedirects.includes('/files/* / 200') &&
  pagesRedirects.includes('/edit/* / 200') &&
  !pagesRedirects.includes('/index.html') &&
  fs.readFileSync(path.join(DIST, '404.html'), 'utf8').includes('Not found'));

// --- image.json ↔ hashed blob ----------------------------------------------
const imageJson = JSON.parse(fs.readFileSync(path.join(DIST, 'os', 'image.json'), 'utf-8'));
check('image.json names a hashed image', /^\/os\/os-system\.[0-9a-f]{16}\.img$/.test(imageJson.image || ''),
  String(imageJson.image));
const imageName=path.basename(imageJson.image||'missing');
check('hashed image exists', fs.existsSync(path.join(DIST, 'os', imageName)));
const gucManifest = JSON.parse(fs.readFileSync(path.join(GUC, 'os', 'image.json'), 'utf-8'));
check('image.json version matches guc manifest', imageJson.version === gucManifest.version,
  `${imageJson.version} vs ${gucManifest.version}`);
check('image.json is ROM-clean', !/gameboy\/roms|\/roms\//.test(JSON.stringify(imageJson)));

// --- system image: seal + independent fsck ---------------------------------
const { BLOCK_FS } = require(path.join(GUC, 'host.js'));
const { fsck } = require(path.join(GUC, 'tests', 'blockfs', 'fsck_v4.js'));
const imgBuf = fs.readFileSync(path.join(DIST, 'os', 'os-system.img'));
const store = new BLOCK_FS.MemoryByteStore(imgBuf.length);
store.setBytes(0, imgBuf);
const sealed = await BLOCK_FS.verifySeal(store);
check('os-system.img seal verifies', sealed === true, String(sealed));
const problems = fsck(store);
check('os-system.img fsck clean', problems.length === 0, problems.slice(0, 3).join('; '));
const hashedBuf = fs.readFileSync(path.join(DIST, 'os', imageName));
check('hashed twin is byte-identical', imgBuf.equals(hashedBuf));

// --- package repo -----------------------------------------------------------
const idx = JSON.parse(fs.readFileSync(path.join(DIST, 'packages', 'index.json'), 'utf-8'));
const pkgNames = Object.keys(idx.packages);
const declaredPackageSet = JSON.parse(fs.readFileSync(path.join(APP, 'package-repository-set.json'), 'utf8'));
const expectedCliPackages = [...declaredPackageSet.publishedDefinitions,
  ...(declaredPackageSet.externalDefinitionSources || []),
  ...declaredPackageSet.siblingToolchainDefinitions,
  ...declaredPackageSet.publishedSourceCompanions].sort();
check('package index is the exact CLI + development-source set',
  JSON.stringify(pkgNames.sort()) === JSON.stringify(expectedCliPackages), pkgNames.join(','));
check('package index baseVersion matches image version', idx.baseVersion === gucManifest.version,
  `${idx.baseVersion} vs ${gucManifest.version}`);
let missingPayloads = 0;
for (const [name, p] of Object.entries(idx.packages)) {
  if (!fs.existsSync(path.join(DIST, 'packages', p.payload.url))) {
    missingPayloads++;
    console.error(`    missing payload: ${name} → ${p.payload.url}`);
  }
}
check('every indexed payload is shipped', missingPayloads === 0, `${missingPayloads} missing`);
for (const native of ['cpython-clang', 'doom-clang', 'wc-rust']) {
  check(`native package ${native} is published`, pkgNames.includes(native));
}

// --- PWA assembly -----------------------------------------------------------
const indexHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8');
check('React shell carries the manifest link', indexHtml.includes('rel="manifest"'));
check('React shell carries the adaptive Ring Prompt favicon', indexHtml.includes('rel="icon"') && indexHtml.includes('/favicon.svg'));
check('React shell has a Vite module entry', /<script[^>]+type="module"/.test(indexHtml));
check('legacy hand-written os.html is absent', !fs.existsSync(path.join(DIST, 'os', 'os.html')));
const swSrc = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf-8');
check('sw.js keeps content-addressed paths cache-first only',
  swSrc.includes('/packages\\/pool\\//') && swSrc.includes('networkFirst'));
check('sw.js excludes API requests', swSrc.includes("url.pathname.startsWith('/api/')"));
for (const icon of ['icon-192.png', 'icon-512.png', 'icon-512-maskable.png']) {
  const b = fs.readFileSync(path.join(DIST, 'icons', icon));
  check(`${icon} is a real PNG`, b.length > 100 && b[0] === 0x89 && b[1] === 0x50);
}
const wm = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.webmanifest'), 'utf-8'));
check('webmanifest is installable-shaped', wm.name === 'gucOS' && wm.display === 'standalone'
  && Array.isArray(wm.icons) && wm.icons.length >= 2);
check('webmanifest uses the headless-os charcoal identity', wm.theme_color === '#18181b' && wm.background_color === '#18181b');
const favicon = fs.readFileSync(path.join(DIST, 'favicon.svg'), 'utf-8');
check('favicon is the adaptive Ring Prompt mark', favicon.includes('#2dd4bf') && favicon.includes('prefers-color-scheme: light') && favicon.includes('52.6 32'));

// --- leak guards (independent re-scan, not trusting the build's own) --------
let romLeaks = 0;
(function scan(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) scan(full);
    else if (/\.gbc?$/i.test(name)) romLeaks++;
  }
})(DIST);
check('no ROM files anywhere in dist', romLeaks === 0, String(romLeaks));
for (const forbidden of ['os/compositor.js','os/ksvc.js','os/osk.js','vendor/doom/data/doom1.wad'])
  check(`${forbidden} absent`, !fs.existsSync(path.join(DIST, forbidden)));
const runtimeText = fs.readFileSync(path.join(DIST,'os/kernel-worker.js'),'utf8');
for (const token of ["'ksvc.js'", "'compositor.js'", 'await probeGPU()', "kernel.service({ path: '/bin/wm'", 'kernel.wmServe()', 'transferControlToOffscreen'])
  check(`runtime has no active ${token}`, !runtimeText.includes(token));
const manifestText = JSON.stringify(imageJson);
for (const token of ['/usr/bin/wm','/usr/bin/term','/usr/lib/ksvc','/usr/share/fonts','/usr/share/sounds'])
  check(`image excludes ${token}`, !manifestText.includes(token));

// --- provenance -------------------------------------------------------------
const info = JSON.parse(fs.readFileSync(path.join(DIST, 'build-info.json'), 'utf-8'));
check('build-info records a runtime generation', /^[0-9a-f]{16}$/.test(info.runtimeGeneration||''));
check('generation pins kernel and process workers', fs.existsSync(path.join(DIST,'runtime',info.runtimeGeneration,'os','kernel-worker.js'))&&fs.existsSync(path.join(DIST,'runtime',info.runtimeGeneration,'os','process-worker.js')));
check('generation is embedded in React and SW', swSrc.includes(`gucos-${info.runtimeGeneration}`)&&fs.readdirSync(path.join(DIST,'assets')).some(f=>f.endsWith('.js')&&fs.readFileSync(path.join(DIST,'assets',f),'utf8').includes(info.runtimeGeneration)&&fs.readFileSync(path.join(DIST,'assets',f),'utf8').includes('kernel-worker.js')));
check('build-info records the upstream c-compiler pin',
  info.upstream && info.upstream.commit === '2344fa80d62ad0be6c8184c59c2aeb00ac74142e',
  JSON.stringify(info.upstream || null));
check('build-info records CLI package mode', info.packages === 'cli');
check('build-info image matches image.json', '/os/'+info.image === imageJson.image);

if (failures) { console.error(`test_dist: ${failures} failure(s)`); process.exit(1); }
console.log('test_dist: all checks passed');
