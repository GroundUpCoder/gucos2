# Provenance and intentional divergence

`guc/` originated as a byte-identical subset of
[GroundUpCoder/c-compiler](https://github.com/GroundUpCoder/c-compiler) at
`2344fa80d62ad0be6c8184c59c2aeb00ac74142e` (2026-08-08), as recorded in
`upstream.json`. This standalone repository begins from a curated source
snapshot and intentionally does not inherit the source monorepo's history.

The headless product intentionally diverges after that baseline. The retained
source closure is the kernel/process/BlockFS/compiler/POSIX runtime, BusyBox
shell and tools, curl/network bridge, clipboard/egress, low-level SDL/WebGPU
surface/input/audio mechanism, and the declared headless package set in
`package-repository-set.json`. The selective package restoration port from the
same pinned upstream commit adds libpng 1.6.58 source, headers, and license
under `guc/vendor/libpng` plus its package definition; the already-retained
zlib tree supplies libpng's `z` namespace. Desktop-only source and payloads
were deleted: VT2, desktop WebGPU compositor, WM activation and chrome/text service, SDL terminal,
Win32 veneer, GUI applications, games/emulators, fonts, sounds, decks and
desktop samples. `guc/kernel.js` adds the browser-facing real-PTY session seam;
`guc/os/kernel-worker.js` owns the typed tab protocol, selected-process surface
broker, and tiny non-GUI init. `guc/os/os-common.js` adds the os-side guarded
mutation seam (`fsSnapshot`/`writeFileGuarded`/`renameGuarded`) that the
kernel worker's fs-write/fs-rename RPCs route through, giving the React
surfaces kernel-atomic exclusive-create, snapshot-conditional write, and
no-replace rename (the data-loss audit fixes).

The React presentation began from selected layout and interaction patterns of
an earlier private interface. The implementation under `frontend` is now
gucOS2-owned and has no import or runtime dependency on that interface; its
filesystem, compiler, shell, process, and graphical-run services were replaced
with the gucOS kernel client rather than copied.

`scripts/build-dist.mjs` derives `build/cli-image.json` from the pinned upstream
manifest, applies explicit CLI absence filters, bakes/seals the image, builds
exactly the declared headless package repository, and rejects forbidden
content. This generated
manifest is the public ABI identity paired with the content-addressed image.

Do not run `scripts/sync-upstream.sh` as a wholesale replacement: that would
silently restore desktop dependencies and destroy the fork delta below. The
script now guards itself: it rebuilds a clean import at the current pin,
diffs it against the live `guc/`, and refuses while they differ. Upstream
changes must be selected, reviewed against the CLI closure, tested, and
recorded here. The upstream repository and its deployment remain separate.

## Fork delta inside guc/ (as of 2026-08-11)

`guc/` is no longer byte-identical to the pin. The deliberate divergence,
verified file-by-file against a detached worktree at `2344fa80`:

- `kernel.js` — purely additive session seam (+125 lines, no upstream line
  modified or deleted): `openTerminal`/`openCaptured`/`capturedTake`/
  `closeCaptured`/`closeTerminal`, the `_onProcessStart`/`_onProcessExit`/
  `_onSurfaceChange` embedder hooks, and the headless surface-input entry
  points (`surfaceKey`/`surfacePointer`/`surfaceAttach`/
  `surfacePointerLockChanged`).
- `os/kernel-worker.js` — heavily rewritten (~533 changed lines): typed tab
  protocol, selected-process surface broker, Web-Locks boot guard.
- `os/init.c` — fork-only file (tiny non-GUI init).
- `os/boot.js` — `--manifest=` flag; ksvc/WM/text-service removal;
  `initRootVolume` runs every boot as a structural repair.
- `os/os-common.js` — adds `appendFileDurable` (chat agent JSONL append);
  `initRootVolume` doc comment.
- `tools/mkpkg.js` — `--manifest=` flag (3 lines).
- `packages/libpng.json` — bundles `licenses/LICENSE.libpng` and
  `licenses/LICENSE.zlib`.
- `compiler.js` — one 4-line comment (libpng source-resolution note).
- 103 desktop files deleted from `os/` (compositor, ksvc, osk, decks,
  sounds, deskdefaults, gpubox, pollball, os.html, …).
- 4,205 desktop-payload files deleted from `vendor/` (netsurf, punes, cairo,
  freetype, mgba, doom, quake, libjpeg, magicpoint, sameboy, pixman, fonts,
  calc, notepad, gameboy, winmine, sent, giflib, snake, hello, and the
  non-source remainder of libpng) — the sync script's vendor exclusion list
  is narrower than the fork's retained set, so a wholesale import would
  restore all of these.
- 18 desktop package definitions deleted from `packages/` (cairodemo, demos,
  doom, fonts, gameboy, libjpeg, libnsbmp/gif, mgba, …).
- `vendor/jq/src/decNumber/*` — line endings only (repo `.gitattributes`
  normalizes upstream CRLF to LF at checkout); not a patch, and the sync
  guard ignores it.

Keep this list in step with what the sync guard reports: the guard's refusal
output is the measured delta; this section is the why.

## Bumping the upstream pin

1. Run `scripts/sync-upstream.sh <repo> <current-pin>` — expect the guard to
   refuse and print the measured delta. Confirm it matches this file; anything
   unexplained is an undocumented patch — stop and resolve first.
2. Capture the delta as patches: diff each FORK-PATCHED file against a
   detached worktree at the current pin; save FORK-ONLY files aside; keep the
   FORK-DELETED list.
3. Temporarily move `guc/` aside (or work in a scratch clone), run the sync
   at the new pin, then re-apply: delete the desktop set, apply the patches,
   restore fork-only files. Resolve conflicts against the upstream changes —
   the kernel seam is additive and normally rebases cleanly.
4. Run the full gate (`node tests/run.mjs` — joins the machine-wide
   heavy-test lock) and a deployed-page `crossOriginIsolated` check after
   deploy.
5. Update this section and `upstream.json`, and commit `guc/`,
   `upstream.json`, and this file together.
