import express from 'express';
import pathlib from 'path';
import { FRONTEND_DIST_DIR } from '../paths.js';

function getPort(): number {
  const envPort = process.env.GUCOS2_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed) && parsed >= 8000 && parsed <= 8999) {
      return parsed;
    }
  }
  return 8016;
}

const appPort = getPort();

// Content-addressed assets — safe to cache forever. Everything else must
// revalidate: the runtime JS is the ABI the baked image links against, and a
// stale host.js against a fresh image.json is a LinkError, not a degrade
// (the comguc cache model; see os/guc provenance).
function isImmutable(urlPath: string): boolean {
  return (
    /^\/packages\/pool\//.test(urlPath) ||
    /^\/os\/os-system\.[0-9a-f]{16}\.img$/.test(urlPath) ||
    /^\/runtime\/[0-9a-f]{16}\//.test(urlPath)
  );
}

// gucOS boots a SharedArrayBuffer kernel protocol: the document (and every
// same-origin subresource) must be served cross-origin isolated, or
// crossOriginIsolated is false and the OS cannot boot. Caddy sets the same
// headers in prod; the backend sets them too so a single-origin local run
// (`pnpm start`, the tests) is faithful to the deployed behaviour.
function setOsHeaders(res: express.Response, urlPath: string): void {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https://api.deepseek.com https://api.elevenlabs.io; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  res.setHeader(
    'Cache-Control',
    isImmutable(urlPath) ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
}

(async () => {
  console.log('gucos2 starting...');

  const app = express();

  app.use((req, res, next) => {
    setOsHeaders(res, req.path);
    next();
  });

  // Local health check for the development and acceptance-test server.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Static assets first. Runtime paths are exact and may never fall through
  // to React's shell; navigation routes receive index.html below.
  app.use(
    express.static(FRONTEND_DIST_DIR, {
      index: 'index.html',
      redirect: true,
      setHeaders: (res, filePath) => {
        const rel = pathlib.relative(FRONTEND_DIST_DIR, filePath);
        setOsHeaders(res, '/' + rel.split(pathlib.sep).join('/'));
      },
    }),
  );

  app.get('*splat', (req, res, next) => {
    const runtime = /^(?:\/assets\/|\/icons\/|\/os\/|\/runtime\/|\/packages\/|\/(?:host|kernel|compiler|libc-ext)\.js$|\/(?:sw\.js|manifest\.webmanifest|build-info\.json)$)/;
    if (runtime.test(req.path)) { res.status(404).type('text/plain').send('Not found'); return; }
    res.sendFile(pathlib.join(FRONTEND_DIST_DIR, 'index.html'), (err) => { if (err) next(err); });
  });

  await new Promise<void>((resolve) => {
    app.listen(appPort, '127.0.0.1', () => resolve());
  });
  console.log(`gucos2 server on http://localhost:${appPort} (dist: ${FRONTEND_DIST_DIR})`);
})().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
