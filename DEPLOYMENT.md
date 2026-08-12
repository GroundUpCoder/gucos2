# Cloudflare Pages deployment

## Project settings

Create a new Cloudflare Pages project connected to the private GitHub
repository with these exact settings:

- Project name: `gucos2`
- Production branch: `deploy`
- Framework preset: `None`
- Root directory: `/`
- Build command: `bash scripts/build-cloudflare.sh`
- Build output directory: `frontend/dist`
- Node version: selected from the repository's `.node-version` (`26.7.0` Current)
- Build environment variables: none

Do not configure a Pages Function. Production is static. The build copies
`frontend/public/_headers`, `_redirects`, and `404.html` into the output.

The repository-owned build script pins the pnpm version and owns the complete
Cloudflare build sequence. Update `pnpm_version` in
`scripts/build-cloudflare.sh` when intentionally upgrading pnpm; the dashboard
command remains unchanged.

Development lands on `main`. Promote a tested revision by merging `main` into
`deploy`; do not force-push the production branch or rewrite its deployment
history.

## Custom domain

In the Pages project, open **Custom domains**, choose **Set up a domain**, and
enter:

```text
os2.groundupcoder.com
```

Associate the hostname through the Pages workflow rather than creating a DNS
record by hand. The hostname currently resolves through the parent zone's
wildcard; Pages must create an explicit record for `os2` pointing at the new
`gucos2.pages.dev` project. Confirm the generated certificate becomes active.

## Required post-deploy verification

```sh
curl -fsSI https://os2.groundupcoder.com/
curl -fsSI https://os2.groundupcoder.com/runtime/does-not-exist/kernel.js
curl -fsSI https://os2.groundupcoder.com/chat/example
```

Acceptance criteria:

- `/` is 200.
- Every response carries `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`.
- A missing runtime asset is 404 and is not rewritten to the React shell.
- `/chat/example` is rewritten to `index.html` with status 200.
- In Chrome, `crossOriginIsolated === true`.
- The kernel reaches ready, a terminal command executes, Files and Editor can
  write, a graphical process displays, and a deep-link reload succeeds.
- A hashed runtime asset, hashed system image, and package-pool response carry
  `Cache-Control: public, max-age=31536000, immutable`.
- `index.html`, `sw.js`, `manifest.webmanifest`, and `build-info.json`
  revalidate rather than receiving an immutable policy.

## Existing deployment

Do not retire or modify the existing deployment until every acceptance check
above passes on the Pages hostname. Repository publication and retirement of
the existing service are separate approval and production-cutover gates.
