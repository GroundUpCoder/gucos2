# gucOS2

gucOS2 is a browser-native, headless gucOS environment with a React interface
for files, editing, terminals, processes, graphical programs, and local AI
chat. The operating system, compiler, filesystem, packages, and applications
run in the browser.

The repository contains a provenance-pinned subset of
[GroundUpCoder/c-compiler](https://github.com/GroundUpCoder/c-compiler). See
[`PROVENANCE.md`](PROVENANCE.md) for the pin and intentional fork delta.

## Build

Requirements: Node.js 22 and pnpm.

```sh
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend build
```

The deployable static site is written to `frontend/dist`.

## Local development

```sh
./dev.sh
```

The local server supplies the cross-origin-isolation headers required by
SharedArrayBuffer. Vite alone is not a complete development server because it
does not assemble the sealed image and package repository.

## Tests

```sh
pnpm --dir frontend install --frozen-lockfile
pnpm --dir backend install --frozen-lockfile
node tests/run.mjs
node scripts/audit-public.mjs
```

The complete gate includes browser and real kernel-boot tests and runs its
heavy members serially.

## Deployment

Cloudflare Pages builds `frontend/dist`. The checked-in `_headers`,
`_redirects`, and `404.html` files preserve cross-origin isolation, immutable
content-addressed assets, SPA navigation, and honest 404s for missing runtime
assets.
