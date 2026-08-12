# gucOS2 development instructions

gucOS2 is a standalone, headless gucOS product deployed as a static site.

## Structure

- `guc/` is the provenance-pinned operating-system and toolchain subset.
- `frontend/` is the React/Vite interface and PWA.
- `backend/` is a local-only static development and acceptance-test server.
- `scripts/build-dist.mjs` assembles the sealed image, package repository,
  immutable runtime generation, and final `frontend/dist` output.
- `tests/run.mjs` is the complete serial gate.

## Invariants

- COOP and COEP are required on every deployed response. A deployment is not
  valid unless `crossOriginIsolated === true`.
- Content-addressed runtime, image, and package assets are immutable. Mutable
  compatibility paths revalidate.
- SPA routes may fall back to `index.html`; runtime, worker, image, and package
  misses must return honest 404 responses.
- Do not widen the ROM or deck content allowlists merely to pass a build.
- Do not wholesale-sync `guc/`. Port upstream changes selectively and update
  `PROVENANCE.md` and `upstream.json` together.
- Run heavy test members serially; they share a machine-wide lock.

## Commands

```sh
pnpm --dir frontend build
./dev.sh
node tests/run.mjs
```

Production output is `frontend/dist` for Cloudflare Pages.
