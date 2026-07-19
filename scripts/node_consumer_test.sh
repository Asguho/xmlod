#!/usr/bin/env bash
set -euo pipefail

# Installs the npm tarball produced by `deno pack` into a throwaway Node
# project, then verifies:
#
#   1. the package installs from the .tgz,
#   2. `parseXml` is importable via ESM and behaves correctly at runtime,
#   3. TypeScript can consume the generated declaration files.
#
# Usage: scripts/node_consumer_test.sh [path/to/xmlod.tgz]
# Defaults to dist/xmlod.tgz. Nothing is written inside the repository.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARBALL="${1:-$ROOT/dist/xmlod.tgz}"

if [[ ! -f "$TARBALL" ]]; then
  echo "error: tarball not found at $TARBALL — run 'deno task pack' first" >&2
  exit 1
fi
TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"

PKG_NAME="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).name' "$ROOT/deno.json")"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
cd "$WORKDIR"

echo "==> consumer project: $WORKDIR"
echo "==> package under test: $PKG_NAME ($TARBALL)"

cat > package.json <<'JSON'
{
  "name": "xmlod-consumer-test",
  "private": true,
  "type": "module"
}
JSON

echo "==> npm install"
npm install --no-audit --no-fund --loglevel=error "$TARBALL" "zod@^4.4.3" "typescript@latest" > /dev/null

cat > main.mjs <<'MJS'
import assert from "node:assert/strict";
import { z } from "zod";
import {
  parseXml,
  safeParseXml,
  XmlCardinalityError,
} from "__PKG__";

const schema = z.object({
  catalog: z.object({
    book: z.array(z.object({
      "@_id": z.coerce.number(),
      title: z.string(),
    })),
  }),
});

const one = parseXml(
  '<catalog><book id="1"><title>Dune</title></book></catalog>',
  schema,
);
assert.deepEqual(one, {
  catalog: { book: [{ "@_id": 1, title: "Dune" }] },
});

const two = parseXml(
  '<catalog><book id="1"><title>A</title></book><book id="2"><title>B</title></book></catalog>',
  schema,
);
assert.equal(two.catalog.book.length, 2);

const singleton = z.object({
  catalog: z.object({ owner: z.object({ name: z.string() }) }),
});
const failed = safeParseXml(
  "<catalog><owner><name>A</name></owner><owner><name>B</name></owner></catalog>",
  singleton,
);
assert.equal(failed.success, false);
assert.ok(failed.error instanceof XmlCardinalityError);
assert.deepEqual(failed.error.path, ["catalog", "owner"]);
assert.equal(failed.error.receivedCount, 2);

console.log("==> runtime consumption OK");
MJS

cat > main.ts <<'TS'
import { z } from "zod";
import {
  createXmlParser,
  parseXml,
  safeParseXml,
  type XmlodError,
  type XmlSafeParseResult,
} from "__PKG__";

const schema = z.object({
  catalog: z.object({
    book: z.array(z.object({ title: z.string() })),
  }),
});

// The inferred return type must be z.output<typeof schema>.
const result = parseXml(
  "<catalog><book><title>Dune</title></book></catalog>",
  schema,
);
const books: Array<{ title: string }> = result.catalog.book;
const title: string = books[0].title;

const safe: XmlSafeParseResult<z.output<typeof schema>> = safeParseXml(
  "<x/>",
  schema,
);
if (!safe.success) {
  const err: XmlodError = safe.error;
  console.error(err.name);
}

const parser = createXmlParser({ parser: { attributeNamePrefix: "@" } });
const fromParser = parser.parse(
  "<catalog><book><title>T</title></book></catalog>",
  schema,
);
console.log(title, fromParser.catalog.book.length);
TS

# Substitute the real package name into the consumer sources.
sed -i.bak "s|__PKG__|$PKG_NAME|g" main.mjs main.ts && rm -f main.mjs.bak main.ts.bak

cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "strict": true,
    "target": "es2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "noEmit": true,
    "skipLibCheck": false
  },
  "include": ["main.ts"]
}
JSON

echo "==> node main.mjs"
node main.mjs

echo "==> tsc --noEmit (declaration file consumption)"
./node_modules/.bin/tsc -p tsconfig.json

echo "==> Node consumer test passed"
