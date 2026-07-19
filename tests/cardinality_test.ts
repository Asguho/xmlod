import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertThrows,
} from "@std/assert";
import { z } from "zod";
import {
  normalizeXml,
  parseXml,
  safeParseXml,
  XmlCardinalityError,
} from "../src/mod.ts";
import {
  NESTED_CHAPTERS_XML,
  SINGLE_BOOK_XML,
  TWO_BOOKS_XML,
  TWO_OWNERS_XML,
} from "./fixtures/catalog.ts";

const bookSchema = z.object({
  "@_id": z.coerce.number(),
  title: z.string(),
});

Deno.test("normalizes a single XML element into a one-element array", () => {
  const schema = z.object({
    catalog: z.object({ book: z.array(bookSchema) }),
  });
  const result = parseXml(SINGLE_BOOK_XML, schema);
  assertEquals(result.catalog.book, [{ "@_id": 1, title: "Dune" }]);
});

Deno.test("preserves multiple XML elements as an array", () => {
  const schema = z.object({
    catalog: z.object({ book: z.array(bookSchema) }),
  });
  const result = parseXml(TWO_BOOKS_XML, schema);
  assertEquals(result.catalog.book, [
    { "@_id": 1, title: "Dune" },
    { "@_id": 2, title: "Neuromancer" },
  ]);
});

Deno.test("unwraps a parser-generated one-item array for a singleton schema", () => {
  // isArray forces fast-xml-parser to emit arrays even for single elements,
  // simulating parsers that always produce arrays.
  const schema = z.object({
    catalog: z.object({ owner: z.object({ name: z.string() }) }),
  });
  const result = parseXml(
    "<catalog><owner><name>Ada</name></owner></catalog>",
    schema,
    { parser: { isArray: (name) => name === "owner" } },
  );
  assertEquals(result.catalog.owner, { name: "Ada" });
});

Deno.test("unwraps a one-item array for a primitive singleton schema", () => {
  const schema = z.object({ a: z.object({ b: z.string() }) });
  const normalized = normalizeXml({ a: { b: ["x"] } }, schema);
  assertEquals(normalized, { a: { b: "x" } });
});

Deno.test("rejects repeated XML elements for a singleton object schema", () => {
  const schema = z.object({
    catalog: z.object({ owner: z.object({ name: z.string() }) }),
  });
  const error = assertThrows(
    () => parseXml(TWO_OWNERS_XML, schema),
    XmlCardinalityError,
  );
  assertEquals(error.path, ["catalog", "owner"]);
  assertEquals(error.expected, "singleton");
  assertEquals(error.receivedCount, 2);
});

Deno.test("rejects repeated XML elements for a primitive singleton schema", () => {
  const schema = z.object({ list: z.object({ item: z.string() }) });
  const error = assertThrows(
    () => parseXml("<list><item>a</item><item>b</item></list>", schema),
    XmlCardinalityError,
  );
  assertEquals(error.path, ["list", "item"]);
  assertEquals(error.receivedCount, 2);
});

Deno.test("rejects an empty array for a singleton schema", () => {
  const schema = z.object({ a: z.string() });
  const error = assertThrows(
    () => normalizeXml({ a: [] }, schema),
    XmlCardinalityError,
  );
  assertEquals(error.receivedCount, 0);
  assertEquals(error.path, ["a"]);
});

Deno.test("normalizes nested arrays independently at each level", () => {
  const schema = z.object({
    library: z.object({
      book: z.array(z.object({
        title: z.string(),
        chapter: z.array(z.object({ heading: z.string() })),
      })),
    }),
  });
  const result = parseXml(NESTED_CHAPTERS_XML, schema);
  assertEquals(result.library.book[0].chapter, [{ heading: "One" }]);
  assertEquals(result.library.book[1].chapter, [
    { heading: "Uno" },
    { heading: "Dos" },
  ]);
});

Deno.test("reports paths containing object keys and array indexes", () => {
  const schema = z.object({
    library: z.object({
      book: z.array(z.object({
        title: z.string(),
        author: z.object({ name: z.string() }),
      })),
    }),
  });
  const xml = `
    <library>
      <book><title>A</title><author><name>X</name></author></book>
      <book>
        <title>B</title>
        <author><name>Y</name></author>
        <author><name>Z</name></author>
      </book>
    </library>
  `;
  const error = assertThrows(() => parseXml(xml, schema), XmlCardinalityError);
  assertEquals(error.path, ["library", "book", 1, "author"]);
  assert(error.message.includes("library.book[1].author"));
});

Deno.test("does not mutate the input document", () => {
  const deepFreeze = <T>(value: T): T => {
    if (typeof value === "object" && value !== null) {
      for (const nested of Object.values(value)) {
        deepFreeze(nested);
      }
      Object.freeze(value);
    }
    return value;
  };
  const input = deepFreeze({
    catalog: {
      book: { title: "Dune", tag: ["a", "b"] },
      meta: { note: "keep" },
    },
  });
  const schema = z.object({
    catalog: z.object({
      book: z.array(z.object({
        title: z.string(),
        tag: z.array(z.string()),
      })),
    }),
  });
  const before = JSON.stringify(input);
  const normalized = normalizeXml(input, schema);
  assertEquals(JSON.stringify(input), before);
  assertEquals(normalized, {
    catalog: {
      book: [{ title: "Dune", tag: ["a", "b"] }],
      meta: { note: "keep" },
    },
  });
  assert(normalized !== (input as unknown));
});

Deno.test("passes union schemas through without cardinality guessing", () => {
  // Ambiguous schema: the raw parser value reaches Zod unchanged, so a
  // repeated element surfaces as a Zod validation error, never as a silent
  // guess.
  const schema = z.object({
    a: z.object({ b: z.union([z.string(), z.number()]) }),
  });
  assertEquals(parseXml("<a><b>x</b></a>", schema), { a: { b: "x" } });

  const repeated = safeParseXml("<a><b>x</b><b>y</b></a>", schema);
  assert(!repeated.success);
});

Deno.test("passes a matching union of array and singleton through as-is", () => {
  const schema = z.object({
    a: z.object({ b: z.union([z.array(z.string()), z.string()]) }),
  });
  // One element parses to a bare string; the union accepts the raw value.
  assertEquals(parseXml("<a><b>x</b></a>", schema), { a: { b: "x" } });
  // Two elements parse to an array; the union accepts the raw array.
  assertEquals(parseXml("<a><b>x</b><b>y</b></a>", schema), {
    a: { b: ["x", "y"] },
  });
});

Deno.test("passes record schemas through without normalizing values", () => {
  const schema = z.object({
    a: z.object({ b: z.record(z.string(), z.string()) }),
  });
  assertEquals(parseXml("<a><b><k>v</k></b></a>", schema), {
    a: { b: { k: "v" } },
  });
});

Deno.test("passes tuple schemas through without normalizing", () => {
  const schema = z.object({
    a: z.object({ b: z.tuple([z.string(), z.string()]) }),
  });
  assertEquals(parseXml("<a><b>x</b><b>y</b></a>", schema), {
    a: { b: ["x", "y"] },
  });
});

Deno.test("passes discriminated unions through to Zod unchanged", () => {
  const schema = z.object({
    msg: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("hello"), to: z.string() }),
      z.object({ kind: z.literal("bye") }),
    ]),
  });
  const result = parseXml(
    "<msg><kind>hello</kind><to>Ada</to></msg>",
    schema,
  );
  assertEquals(result, { msg: { kind: "hello", to: "Ada" } });
});

Deno.test("normalizes fields nested inside opaque-free branches only", () => {
  // Fields below an ambiguous schema are not normalized: the array schema
  // inside the union does not wrap the singleton, so validation fails.
  const schema = z.object({
    a: z.object({
      b: z.union([
        z.object({ c: z.array(z.string()) }),
        z.literal("off"),
      ]),
    }),
  });
  const single = safeParseXml("<a><b><c>x</c></b></a>", schema);
  assert(!single.success);
  assertInstanceOf(single.error, Error);
});

Deno.test("normalizes array elements recursively using the element schema", () => {
  const schema = z.object({
    list: z.object({
      entry: z.array(z.object({
        value: z.array(z.string()),
      })),
    }),
  });
  const result = parseXml(
    "<list><entry><value>a</value></entry></list>",
    schema,
  );
  assertEquals(result, { list: { entry: [{ value: ["a"] }] } });
});
