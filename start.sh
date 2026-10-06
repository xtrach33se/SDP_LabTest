#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ ! -d node_modules || ! -d server/node_modules || ! -d client/node_modules ]]; then
  echo "Installing RAT dependencies…"
  npm run setup
fi

exec npm run dev
