#!/usr/bin/env bash
set -euo pipefail

# Installs the npm tarball produced by `deno pack` into a throwaway Node
# project, then verifies:
#
#   1. the package installs from the .tgz,
#   2. `parseXml` is importable via ESM and behaves correctly at runtime,
#   3. TypeScript can consume the generated declaration files.
#
# Usage: scripts/node_consumer_test.sh [path/to/schema-xml.tgz]
# Defaults to dist/schema-xml.tgz. Nothing is written inside the repository.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARBALL="${1:-$ROOT/dist/schema-xml.tgz}"

if [[ ! -f "$TARBALL" ]]; then
  echo "error: tarball not found at $TARBALL — run 'deno task pack' first" >&2
  exit 1
fi
TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
cd "$WORKDIR"

# Read the final artifact: its npm name differs from the JSR name in deno.json.
tar -xzf "$TARBALL" -C "$WORKDIR"
PKG_NAME="$(node --input-type=module - <<'JS'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync("package/package.json", "utf8"));
assert.equal(pkg.name, "schema-xml");
assert.equal(typeof pkg.peerDependencies?.zod, "string");
assert.equal(pkg.dependencies?.zod, undefined);
assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["fast-xml-parser"]);
console.log(pkg.name);
JS
)"

echo "==> consumer project: $WORKDIR"
echo "==> package under test: $PKG_NAME ($TARBALL)"

cat > package.json <<'JSON'
{
  "name": "schema-xml-consumer-test",
  "private": true,
  "type": "module"
}
JSON

echo "==> npm install"
# Release checks use exact versions; the compatibility workflow overrides these.
npm install --no-audit --no-fund --loglevel=error "$TARBALL" "zod@${SCHEMA_XML_TEST_ZOD:-4.4.3}" "typescript@${SCHEMA_XML_TEST_TYPESCRIPT:-7.0.2}" > /dev/null

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
  type SchemaXmlError,
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
// These must fail directly on the inferred output, even if it regresses to any.
// @ts-expect-error A parsed title is a string, not a number.
const invalidTitle: number = result.catalog.book[0].title;
// @ts-expect-error The schema does not declare a missing field.
result.catalog.book[0].missing;

const safe: XmlSafeParseResult<z.output<typeof schema>> = safeParseXml(
  "<x/>",
  schema,
);
if (!safe.success) {
  const err: SchemaXmlError = safe.error;
  console.error(err.name);
}

const parser = createXmlParser({ parser: { attributeNamePrefix: "@" } });
const fromParser = parser.parse(
  "<catalog><book><title>T</title></book></catalog>",
  schema,
);
console.log(title, fromParser.catalog.book.length);
// @ts-expect-error Configured parsers must retain schema output inference.
const invalidConfiguredTitle: number = fromParser.catalog.book[0].title;

const inferredSafe = safeParseXml("<catalog/>", schema);
if (inferredSafe.success) {
  // @ts-expect-error Safe parsing must retain schema output inference too.
  const invalidSafeTitle: number = inferredSafe.data.catalog.book[0].title;
}
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
