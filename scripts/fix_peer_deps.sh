#!/usr/bin/env bash
set -euo pipefail

# `deno pack` lists every import-map entry as a runtime dependency, but zod
# is a peer: consumers write the schemas themselves, and a second zod
# instance installed just for xmlod would make `instanceof` and schema
# checks disagree with theirs. This rewrites the tarball's package.json to
# declare zod as a peer dependency instead.
#
# Usage: scripts/fix_peer_deps.sh [path/to/xmlod.tgz]
# Defaults to dist/xmlod.tgz.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARBALL="${1:-$ROOT/dist/xmlod.tgz}"

if [[ ! -f "$TARBALL" ]]; then
  echo "error: tarball not found at $TARBALL — run 'deno task pack' first" >&2
  exit 1
fi
TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

tar -xzf "$TARBALL" -C "$WORKDIR"

deno eval --no-config '
const path = Deno.args[0];
const pkg = JSON.parse(Deno.readTextFileSync(path));
const range = pkg.dependencies?.zod;
if (typeof range !== "string") {
  console.error("error: zod not found in dependencies — nothing to move");
  Deno.exit(1);
}
delete pkg.dependencies.zod;
if (Object.keys(pkg.dependencies).length === 0) delete pkg.dependencies;
pkg.peerDependencies = { ...pkg.peerDependencies, zod: range };
Deno.writeTextFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
' "$WORKDIR/package/package.json"

tar -czf "$TARBALL" -C "$WORKDIR" package
echo "==> zod moved to peerDependencies in $(basename "$TARBALL")"
