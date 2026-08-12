#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pnpm_version="10.11.1"

cd "$repo_dir"
npm exec --yes "pnpm@${pnpm_version}" -- --dir frontend install --frozen-lockfile
npm exec --yes "pnpm@${pnpm_version}" -- --dir frontend build
