/**
 * The canonical Schema XML example: a catalog whose `<book>` element repeats and
 * whose `<owner>` element must not.
 *
 * Run with:
 *
 * ```sh
 * deno run examples/catalog.ts
 * ```
 *
 * @module
 */

import { z } from "zod";
import { parseXml, safeParseXml } from "../src/mod.ts";

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

// One <book>: most XML parsers would produce a bare object here. The schema
// says z.array(...), so Schema XML normalizes it into a one-element array.
const oneBook = `
<catalog>
  <book id="1"><title>Dune</title></book>
  <owner><name>Ada</name></owner>
</catalog>
`;

const result = parseXml(oneBook, schema);
console.log("book is always an array:", result.catalog.book);
// -> [ { "@_id": 1, title: "Dune" } ]

// Repeated <owner>: the schema declares a singleton, so Schema XML rejects the
// document instead of silently discarding an owner.
const twoOwners = `
<catalog>
  <book id="1"><title>Dune</title></book>
  <owner><name>Ada</name></owner>
  <owner><name>Grace</name></owner>
</catalog>
`;

const failed = safeParseXml(twoOwners, schema);
if (!failed.success) {
  console.log("cardinality error:", failed.error.message);
  // -> Expected one XML element at catalog.owner, but found 2.
  //    Use z.array(...) if repetition is allowed.
}
