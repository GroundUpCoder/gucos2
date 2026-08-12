// sw.js — gucOS PWA service worker (gucos2 fork).
//
// The cache discipline mirrors the origin's cache model exactly (see
// scripts/build-dist.mjs and the Caddyfile block): content-addressed assets
// (the hashed system image, /packages/pool/*) are cache-first — their bytes
// can never change under their name. EVERYTHING else is network-first with
// the cache as an offline fallback only, so the image/version invalidation
// model is preserved: image.json, packages/index.json, and the runtime JS
// (the ABI the baked image links against) all revalidate — a connected
// client always sees the freshly deployed bytes. COOP/COEP survive the
// cache because cached Response objects keep their original headers.
const CACHE = 'gucos-__RUNTIME_GENERATION__';
const IMMUTABLE = [/^\/packages\/pool\//, /^\/os\/os-system\.[0-9a-f]{16}\.img$/, /^\/runtime\/[0-9a-f]{16}\//];

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil((async () => {
  const names = await caches.keys();
  await Promise.all(names.filter(name => name.startsWith('gucos-') && name !== CACHE).map(name => caches.delete(name)));
  await self.clients.claim();
})()); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  const immutable = IMMUTABLE.some((re) => re.test(url.pathname));
  e.respondWith(immutable ? cacheFirst(req) : networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}
