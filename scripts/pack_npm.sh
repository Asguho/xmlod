#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p dist
# Extra arguments (e.g. --allow-dirty for local checks) go to Deno, never npm.
deno pack --output dist/schema-xml.tgz "$@"
"$ROOT/scripts/prepare_npm.sh" "$ROOT/dist/schema-xml.tgz"
