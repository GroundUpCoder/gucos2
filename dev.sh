#!/usr/bin/env bash
# Local dev for gucos2.
#
#   ./dev.sh        backend (tsx watch) on :8016 serving frontend/dist
#                   (builds the dist first if it is missing)
#   ./dev.sh guc    upstream-style OS dev loop: guc/serve.js on :8080 with
#                   COOP/COEP, serving the guc tree directly — the fast
#                   iteration path for OS-side work (no dist assembly)
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"

if [[ "${1:-}" == "guc" ]]; then
  cd "$REPO/guc"
  exec node serve.js
fi

if [[ ! -d "$REPO/frontend/dist" ]]; then
  echo "frontend/dist missing — building it first (bake + packages, a few minutes cold)…"
  (cd "$REPO/frontend" && node ../scripts/build-dist.mjs)
fi

cd "$REPO/backend"
pnpm install --prod=false
export GUCOS2_PORT="${GUCOS2_PORT:-8016}"
exec pnpm run dev
