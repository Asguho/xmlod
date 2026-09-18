# Xmlod

[![JSR](https://jsr.io/badges/@asguho/xmlod)](https://jsr.io/@asguho/xmlod)
[![npm](https://img.shields.io/npm/v/@asguho/xmlod?logo=npm&color=cb3837)](https://www.npmjs.com/package/@asguho/xmlod)

> Schema-first XML parsing with Zod-aware cardinality.

Xmlod parses XML into fully typed, validated data by letting your Zod schema —
not the shape of any particular document — decide whether repeated XML elements
are arrays or singletons.

## The problem

XML cannot express "this element repeats" in the document itself, so
object-mapping XML parsers guess from what they see:

```xml
<catalog>
  <book><title>Dune</title></book>
</catalog>
```

parses to `{ catalog: { book: { title: "Dune" } } }`, while

```xml
<catalog>
  <book><title>Dune</title></book>
  <book><title>Neuromancer</title></book>
</catalog>
```

parses to `{ catalog: { book: [ ... ] } }`. Your code gets an object one day and
an array the next.

Xmlod makes the **Zod schema the source of truth**: where the schema declares
`z.array(...)`, you always get an array (a single element is wrapped); where the
schema expects a singleton, repeated elements are rejected with a descriptive
error instead of being silently mangled.

## Basic usage

```ts
import { z } from "zod";
import { parseXml } from "@asguho/xmlod";

const schema = z.object({
  catalog: z.object({
    book: z.array(
      z.object({
        "@_id": z.coerce.number(),
        title: z.string(),
      }),
    ),
    owner: z.object({
      name: z.string(),
    }),
  }),
});

const result = parseXml(xml, schema);
// result is typed as z.output<typeof schema>
```

The schema describes the **whole document**, including the root element name as
the top-level object key.

## Array normalization

```ts
const schema = z.object({
  catalog: z.object({
    book: z.array(z.object({ title: z.string() })),
  }),
});

parseXml("<catalog><book><title>Dune</title></book></catalog>", schema);
// -> { catalog: { book: [{ title: "Dune" }] } }
//    One <book> still becomes an array, because the schema says so.
```

## Singleton cardinality errors

Where the schema expects exactly one element, repetition is an error — never a
silent guess and never a silently dropped element:

```ts
const schema = z.object({
  catalog: z.object({
    owner: z.object({ name: z.string() }),
  }),
});

parseXml(
  `<catalog>
     <owner><name>Ada</name></owner>
     <owner><name>Grace</name></owner>
   </catalog>`,
  schema,
);
// throws XmlCardinalityError:
//   Expected one XML element at catalog.owner, but found 2.
//   Use z.array(...) if repetition is allowed.
```

`XmlCardinalityError` exposes structured details:

```ts
error.path; // ["catalog", "owner"]  (numeric indexes for array positions)
error.expected; // "singleton"
error.receivedCount; // 2
```

## Attributes

Attributes are preserved and prefixed with `@_` by default:

```ts
const schema = z.object({
  note: z.object({
    "@_lang": z.string(),
    "#text": z.string(), // text content of an element that also has attributes
  }),
});

parseXml('<note lang="en">Remember</note>', schema);
// -> { note: { "@_lang": "en", "#text": "Remember" } }
```

## Coercion

Xmlod disables the XML parser's own primitive coercion, so every value reaches
Zod as a string and **Zod is the single source of truth for types**:

```ts
const schema = z.object({
  data: z.object({
    count: z.coerce.number(), // "42"   -> 42
    active: z.stringbool(), // "true" -> true
    plain: z.string(), // "007"  stays "007"
  }),
});

parseXml(
  "<data><count>42</count><active>true</active><plain>007</plain></data>",
  schema,
);
// -> { data: { count: 42, active: true, plain: "007" } }
```

Prefer `z.stringbool()` over `z.coerce.boolean()` for XML booleans:
`z.coerce.boolean()` turns every non-empty string — including `"false"` — into
`true`.

## `safeParseXml()`

The non-throwing variant returns a discriminated result:

```ts
import { safeParseXml } from "@asguho/xmlod";

const result = safeParseXml(xml, schema);
if (result.success) {
  result.data; // z.output<typeof schema>
} else {
  result.error; // XmlodError (syntax, cardinality, or schema failure)
}
```

## Configured parser

Create a reusable parser when you want fixed options applied to every call:

```ts
import { createXmlParser } from "@asguho/xmlod";

const parser = createXmlParser({
  parser: {
    attributeNamePrefix: "@",
  },
});

const result = parser.parse(xml, schema);
const safeResult = parser.safeParse(xml, schema);
```

The `parser` option accepts any
[`fast-xml-parser` option](https://github.com/NaturalIntelligence/fast-xml-parser/blob/master/docs/v4,%20v5/2.XMLparseOptions.md),
merged over Xmlod's defaults:

```ts
{
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
}
```

## Supported Zod schemas

Cardinality normalization understands:

- **Objects** — each field is normalized recursively against its field schema.
  Unknown keys are passed through untouched (relevant for `z.looseObject`).
- **Arrays** — a single XML element becomes a one-element array; every element
  is normalized against the element schema.
- **Tuples** — a single XML element becomes a one-element array; items are
  normalized positionally, and items beyond the declared positions against the
  rest schema (if any).
- **Records** — every property value is normalized against the record's value
  schema, so `z.record(z.string(), z.array(...))` wraps single occurrences like
  any array field.
- **Primitives** — strings, numbers, booleans, bigints, dates, literals, enums,
  and template literals are singletons: a one-element array is unwrapped, and
  any other repetition is an `XmlCardinalityError`.
- **Coercion** — `z.coerce.*` and `z.stringbool()` work as usual; Xmlod never
  coerces values itself.
- **Wrappers** — `optional`, `nullable`, `default`, `prefault`, `catch`,
  `readonly`, `nonoptional`, `success`, `promise`, and `lazy` (including
  recursive schemas) are looked through when determining cardinality. Missing,
  defaulted, and invalid values are then handled by Zod as normal. A cardinality
  mismatch under a `.catch()` wrapper does not throw: the raw value is passed
  through so Zod applies the declared fallback.
- **Refinements** — `.refine()` / `.superRefine()` keep the underlying schema's
  cardinality and run after normalization.
- **Transforms and pipes** — `.transform()` and `.pipe()` are classified by
  their **input** side, because that is what Zod validates against the document
  first. `z.array(...).transform((a) => a.length)` therefore still receives a
  normalized array. This is exact, not a guess.
- **Unions of singletons** — a union whose branches are all singletons (e.g.
  `z.union([z.string(), z.number()])`) is a singleton: repetition is a
  descriptive `XmlCardinalityError` instead of an opaque Zod failure.
- **Intersections of disjoint objects** — `z.object(...).and(z.object(...))`
  with non-overlapping keys — a common way to combine attribute and element
  groups — is normalized as one object with the merged shape.

### Ambiguous schemas are passed through

For schemas whose array-vs-singleton expectation cannot be determined without
guessing, Xmlod **passes the raw parser value to Zod unchanged** (it does not
throw an unsupported-schema error):

- `z.union(...)` with mixed-cardinality branches, and
  `z.discriminatedUnion(...)`
- `z.intersection(...)` / `.and(...)` unless both sides are objects with
  disjoint keys
- `z.map(...)`, `z.set(...)`
- `z.any()`, `z.unknown()`, standalone `z.transform(...)`, `z.preprocess(...)`,
  and anything Xmlod does not recognize

Inside such a schema no normalization happens either, so a repeated element
surfaces as a regular Zod validation error rather than a silent guess. If you
need normalization there, restructure the schema so the array/singleton decision
sits outside the ambiguous construct.

### Advanced: normalization without parsing

If you already have XML-parser output — or want to plug in a different XML
parser — `normalizeXml` applies only the cardinality normalization, and
`resolveCardinality` exposes how Xmlod classifies a schema:

```ts
import { normalizeXml, resolveCardinality } from "@asguho/xmlod";

normalizeXml({ catalog: { book: { title: "Dune" } } }, schema);
// -> { catalog: { book: [{ title: "Dune" }] } }

resolveCardinality(z.array(z.string()));
// -> { kind: "array", element: <ZodString> }
```

## Known limitations

- **Empty elements parse as `""`, not `{}`.** `<list></list>` is an empty string
  to the XML parser, so a schema expecting an object with optional fields will
  report "expected object, received string" for a fully empty parent element.
- **The XML declaration appears as a `?xml` key.** Plain `z.object(...)` strips
  unknown keys so this is invisible, but `z.strictObject(...)` at the root will
  reject it; pass `{ parser: { ignoreDeclaration: true } }` if you need a strict
  root object.
- **Values under a catchall are not normalized.** `z.looseObject` /
  `.catchall(...)` keys outside the declared shape are passed through as-is.
- **Document order across different element names is not preserved.** This is
  inherent to object-mapping XML parsing; mixed content (interleaved text and
  elements) is collapsed by the underlying parser.
- **XML namespaces are not treated specially.** `<ns:tag>` is just a key named
  `"ns:tag"`.

## Error handling

All errors thrown by Xmlod extend `XmlodError`:

| Error                 | Meaning                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| `XmlSyntaxError`      | The input is not well-formed XML. Parser error kept as `cause`.                  |
| `XmlCardinalityError` | Element repetition contradicts the schema (`path`, `expected`, `receivedCount`). |
| `XmlSchemaError`      | The normalized document failed Zod validation.                                   |

Xmlod **never throws a bare `ZodError`**: validation failures are always wrapped
in `XmlSchemaError`, with the original `ZodError` preserved as `error.cause` for
structured issue inspection:

```ts
import { z } from "zod";
import { parseXml, XmlSchemaError } from "@asguho/xmlod";

try {
  parseXml(xml, schema);
} catch (error) {
  if (error instanceof XmlSchemaError && error.cause instanceof z.ZodError) {
    console.error(error.cause.issues);
  }
}
```

`safeParseXml()` returns these same errors as `{ success: false, error }`
instead of throwing. Exceptions that do not originate from Xmlod (for example, a
`.transform()` callback that throws) are re-thrown as-is.

## Installation

Xmlod is published to both registries:

- JSR — <https://jsr.io/@asguho/xmlod>
- npm — <https://www.npmjs.com/package/@asguho/xmlod>

```sh
npm install @asguho/xmlod zod   # Node.js (npm)
deno add jsr:@asguho/xmlod npm:zod   # Deno (JSR)
```

Zod v4 is a peer of your application: you write the schemas, so you depend on
`zod` directly. The npm package declares `zod` as a `peerDependency`, so your
application and Xmlod always share a single zod instance.

## Deno usage

The library is written as native TypeScript for Deno:

```ts
import { parseXml } from "./src/mod.ts"; // in this repository
```

or from [JSR](https://jsr.io/@asguho/xmlod):

```ts
import { parseXml } from "jsr:@asguho/xmlod";
```

## Node.js usage

Install the npm package (built with `deno pack`) and import via ESM:

```ts
import { z } from "zod";
import { parseXml } from "@asguho/xmlod";
```

The package ships generated `.d.ts` declarations; TypeScript consumers get the
same `z.output<typeof schema>` inference as Deno consumers. The package is
ESM-only.

## Development

```sh
deno task check          # typecheck
deno task test           # run the test suite
deno task test:coverage  # tests + coverage report
deno task fmt:check      # formatting check
deno task lint           # lint
deno task verify         # all of the above
deno task pack:dry       # preview the npm package contents
deno task pack           # build dist/xmlod.tgz
deno task test:node      # install the tarball into a temp Node project and test it
```

## Publishing

Xmlod is packaged for npm with `deno pack` (which produces an npm-compatible
tarball — it does **not** publish to JSR). The tarball contains the compiled
modules, generated `.d.ts` declarations, `README.md`, and `LICENSE`; the
changelog lives in the repository (and in the JSR package). The release process:

```sh
# 0. Make sure the git tree is clean (`deno pack` refuses on a dirty tree).
npm whoami                # confirm you are authenticated

deno task verify
deno pack --dry-run
deno task pack            # deno pack + move zod to peerDependencies
tar -tzf dist/xmlod.tgz   # inspect what will be published
./scripts/node_consumer_test.sh dist/xmlod.tgz

npm publish ./dist/xmlod.tgz --access public
```

After publishing, verify from a clean directory:

```sh
mkdir /tmp/xmlod-check && cd /tmp/xmlod-check
npm init -y && npm install @asguho/xmlod zod
node -e 'import("@asguho/xmlod").then(m => console.log(typeof m.parseXml))'
```

A manually triggered GitHub Actions workflow (`.github/workflows/release.yml`)
automates the same steps behind a typed confirmation phrase and a protected
environment; ordinary pushes and pull requests never publish.

### JSR

JSR publication is a separate channel from the npm tarball:

```sh
deno publish --dry-run
deno publish
```

## Versioning

Xmlod follows [Semantic Versioning](https://semver.org/). While the version is
below 1.0.0, minor releases may contain breaking changes; patch releases will
not. The library inspects Zod's internal schema representation in exactly one
module (`src/schema-inspector.ts`); if a Zod release changes its internals, the
fix lands there and ships as a patch release. Anything Xmlod cannot recognize
degrades to pass-through behavior rather than throwing.

## License

[MIT](./LICENSE)
