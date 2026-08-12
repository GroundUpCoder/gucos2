#!/usr/bin/env bash
# sync-upstream.sh — (re-)import the gucOS source subset into os/guc/ from a
# c-compiler checkout at an EXPLICIT commit, and update os/upstream.json.
#
# This script IS the import-set definition: what a fresh import puts in
# os/guc/ is exactly what this script copies, nothing else (PROVENANCE.md
# explains the why of each inclusion/exclusion).
#
# ⚠️ os/guc/ is NO LONGER a byte-identical mirror. The fork carries deliberate
# patches inside guc/ (kernel session seam, kernel-worker rewrite, headless
# boot.js, os-common appendFileDurable, --manifest flags, desktop-file
# deletions — the full list lives in PROVENANCE.md, "Fork delta inside guc/").
# A wholesale re-import would silently destroy them. So this script now
# GUARDS: before touching anything it rebuilds what a clean import at the
# CURRENT pin (os/upstream.json) would produce, diffs that against the live
# guc/ tree, and refuses to proceed if they differ. The refusal output is the
# authoritative fork-delta list. To bump the pin, follow the "Bumping the
# upstream pin" procedure in PROVENANCE.md (capture the delta, import,
# re-apply, run the gate) — do not weaken this guard to make a sync pass.
#
#   scripts/sync-upstream.sh <c-compiler-repo> <commit-sha>
#   e.g. scripts/sync-upstream.sh ~/git/c-compiler 2344fa80d62ad0be6c8184c59c2aeb00ac74142e
#
# Uses throwaway DETACHED worktrees of the source repo (read-only with
# respect to its main tree), so a dirty or busy c-compiler checkout can
# neither pollute the import nor be disturbed by it.
set -euo pipefail

SRC="${1:?usage: sync-upstream.sh <c-compiler-repo> <commit-sha>}"
SHA="${2:?usage: sync-upstream.sh <c-compiler-repo> <commit-sha>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(dirname "$HERE")"
GUC="$APP/guc"

FULL_SHA="$(git -C "$SRC" rev-parse "$SHA")"
TMP="$(mktemp -d)"
WORKTREES=()
cleanup() {
  local w
  for w in "${WORKTREES[@]:-}"; do
    [ -n "$w" ] && git -C "$SRC" worktree remove --force "$w" 2>/dev/null || true
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

add_worktree() { # <sha> <dest> — detached worktree of $SRC
  git -C "$SRC" worktree add --detach "$2" "$1" >/dev/null
  WORKTREES+=("$2")
}

# import_into <src-worktree> <dest-dir> — the import-set definition. Run for
# the real import AND for the guard's clean-reference build; keep them one
# code path so the guard can never drift from the import.
import_into() {
  local FROM="$1" DEST="$2"
  mkdir -p "$DEST/tools" "$DEST/packages" "$DEST/tests/lib" "$DEST/tests/blockfs"
  (
    cd "$FROM"

    # Root runtime + dev server + repo metadata (the runtime allowlist's
    # ROOT_JS plus what the headless/dev loop needs).
    cp LICENSE compiler.js host.js kernel.js libc-ext.js serve.js .gitignore .gitattributes "$DEST/"

    # The whole os/ tree — gucOS itself (C sources, workers, page, manifest).
    rsync -a os/ "$DEST/os/"

    # Bake + package tooling (mkimage/mkpkg resolve everything else themselves).
    cp tools/mkimage.js tools/mkpkg.js "$DEST/tools/"

    # Package definitions — ALL of them; mkpkg skips `requires`-gated
    # (clang/rust sibling) definitions by construction, so the fork builds
    # the BASE index.
    cp packages/*.json "$DEST/packages/"

    # Harness libs the imported entry points require (tree-guard, heavy-lock,
    # image-fixture, png, …) + the independent fsck the fork's tests run
    # against the baked image.
    rsync -a tests/lib/ "$DEST/tests/lib/"
    cp tests/blockfs/fsck.js tests/blockfs/fsck_v4.js "$DEST/tests/blockfs/"

    # Vendor closure for the minimal image + the base packages. Excluded (see
    # PROVENANCE.md): cpython (clang-gated package only), csmith-corpus/
    # libc-test (compiler-test corpora), tcc/quickjs/tinyemu/codemirror/disw
    # (referenced by no image entry, package, or runtime file — measured,
    # with positive-control greps, at import time).
    rsync -a vendor/ "$DEST/vendor/" \
      --exclude '/cpython' --exclude '/csmith-corpus' --exclude '/libc-test' \
      --exclude '/tcc' --exclude '/quickjs' --exclude '/tinyemu' \
      --exclude '/codemirror' --exclude '/disw'
  )
}

# ---------------------------------------------------------------------------
# Guard: refuse while the live guc/ differs from a clean import at the pin.
#
# FAIL CLOSED. The only state that may skip the guard is a nonexistent guc/
# (a first import — nothing to destroy). If guc/ exists, an unreadable or
# unresolvable pin is MORE dangerous than a mismatched one: it means we
# cannot even compute what we are about to delete. So every parse/resolve
# failure refuses loudly here, before any destructive step; nothing on this
# path may swallow an error.
# ---------------------------------------------------------------------------
refuse() { echo "sync-upstream: REFUSING — $*" >&2; exit 1; }
if [ -d "$GUC" ]; then
  [ -f "$APP/upstream.json" ] \
    || refuse "os/guc/ exists but $APP/upstream.json is missing; cannot determine the pin, so cannot prove a re-import is safe. Restore upstream.json (git) first."
  # Real JSON parsing (not a regex): tolerant of whitespace/formatting, strict
  # about the field existing and being a non-empty string.
  PIN_RAW="$(node -e '
    const j = require(process.argv[1]);
    if (typeof j.commit !== "string" || j.commit === "") process.exit(3);
    process.stdout.write(j.commit);
  ' "$APP/upstream.json")" \
    || refuse "$APP/upstream.json is unparseable or has no \"commit\" string; fix the file before syncing."
  # rev-parse both validates and normalizes (abbreviated or uppercase pins
  # resolve to the full SHA; garbage refuses).
  PIN="$(git -C "$SRC" rev-parse --verify --quiet "$PIN_RAW^{commit}")" \
    || refuse "pin '$PIN_RAW' (from upstream.json) does not resolve to a commit in $SRC; wrong source repo, or the pin predates a rewrite. Resolve that before syncing."
  add_worktree "$PIN" "$TMP/pin"
  import_into "$TMP/pin" "$TMP/clean"

  # Compare git-TRACKED files only: guc/ also holds ignored build outputs
  # (guc/dist/, guc/build/, …) that no import produces and no sync may judge.
  # --show-prefix, not string-stripping against --show-toplevel: the latter
  # returns the physical path and breaks under a symlinked checkout (macOS
  # /var -> /private/var), which would garble the delta paths.
  GUC_REL="$(cd "$APP" && git rev-parse --show-prefix)guc"
  git -C "$APP" ls-files --full-name -- ":/$GUC_REL" | sed "s|^$GUC_REL/||" | LC_ALL=C sort > "$TMP/live.list"
  # -type l too: git ls-files reports tracked symlinks, so the clean list
  # must as well, or an upstream symlink would surface as a phantom
  # FORK-ONLY row (none exist today; this keeps the lists same-shaped).
  (cd "$TMP/clean" && find . \( -type f -o -type l \) | sed 's|^\./||' | LC_ALL=C sort) > "$TMP/clean.list"

  : > "$TMP/delta"
  LC_ALL=C comm -23 "$TMP/live.list" "$TMP/clean.list" | sed 's/^/FORK-ONLY (no clean import produces it): /' >> "$TMP/delta"
  LC_ALL=C comm -13 "$TMP/live.list" "$TMP/clean.list" | sed 's/^/FORK-DELETED (a clean import restores it): /' >> "$TMP/delta"
  while IFS= read -r f; do
    if ! cmp -s "$GUC/$f" "$TMP/clean/$f"; then
      # Repo .gitattributes normalization turns upstream CRLF into LF at
      # checkout (vendor/jq decNumber); that is not a fork patch.
      if diff -q --strip-trailing-cr "$GUC/$f" "$TMP/clean/$f" >/dev/null 2>&1; then
        continue
      fi
      echo "FORK-PATCHED: $f" >> "$TMP/delta"
    fi
  done < <(LC_ALL=C comm -12 "$TMP/live.list" "$TMP/clean.list")

  if [ -s "$TMP/delta" ]; then
    echo "sync-upstream: REFUSING — os/guc/ has diverged from a clean import at the pin ($PIN)." >&2
    echo "A wholesale re-import would destroy the fork delta below. Port selectively instead" >&2
    echo "(PROVENANCE.md, \"Bumping the upstream pin\"), and keep PROVENANCE.md's fork-delta" >&2
    echo "list in step with what this guard reports." >&2
    echo >&2
    sed 's/^/  /' "$TMP/delta" >&2
    echo >&2
    echo "To capture the delta before a pin bump:" >&2
    echo "  git -C \"$SRC\" worktree add --detach /tmp/pin $PIN" >&2
    echo "  # re-run this script's import_into by hand, or diff file-by-file from the list above" >&2
    exit 1
  fi
  echo "sync-upstream: guard passed — live guc/ matches a clean import at $PIN"
fi

# ---------------------------------------------------------------------------
# The import proper.
# ---------------------------------------------------------------------------
add_worktree "$FULL_SHA" "$TMP/src"
rm -rf "$GUC"
import_into "$TMP/src" "$GUC"

# Contraband backstop: the source tree gitignores ROMs, but never trust a
# copy path — refuse the sync if any ROM landed.
if find "$GUC" \( -iname '*.gb' -o -iname '*.gbc' \) | grep -q .; then
  echo "sync-upstream: ROM files found in the import — refusing" >&2
  exit 1
fi

cat > "$APP/upstream.json" <<EOF
{
  "upstream": "c-compiler",
  "commit": "$FULL_SHA",
  "importedAt": "$(date -u +%Y-%m-%d)",
  "note": "os/guc/ began as a byte-identical subset of the c-compiler tree at this commit, then diverged deliberately. See PROVENANCE.md for the import set, exclusions, and the fork delta; scripts/sync-upstream.sh re-imports (with a divergence guard) and updates this file."
}
EOF

echo "sync-upstream: os/guc/ now mirrors c-compiler @ $FULL_SHA"
echo "  next: re-apply the fork delta (PROVENANCE.md), run the suite (node tests/run.mjs),"
echo "  and commit guc/ + upstream.json together."
