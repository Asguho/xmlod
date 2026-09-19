import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import { z } from "zod";
import {
  createXmlParser,
  parseXml,
  safeParseXml,
  XmlSchemaError,
} from "../src/mod.ts";
import { SINGLE_BOOK_XML, TWO_BOOKS_XML } from "./fixtures/catalog.ts";

const catalogSchema = z.object({
  catalog: z.object({
    book: z.array(z.object({
      "@_id": z.coerce.number(),
      title: z.string(),
    })),
    owner: z.object({ name: z.string() }),
  }),
});

Deno.test("parses a document and returns the schema output type", () => {
  const result = parseXml(SINGLE_BOOK_XML, catalogSchema);
  // Compile-time assertion: the inferred type is z.output of the schema.
  const typed: {
    catalog: {
      book: Array<{ "@_id": number; title: string }>;
      owner: { name: string };
    };
  } = result;
  assertEquals(typed, {
    catalog: {
      book: [{ "@_id": 1, title: "Dune" }],
      owner: { name: "Ada" },
    },
  });
});

Deno.test("parses attributes with the default @_ prefix", () => {
  const result = parseXml(TWO_BOOKS_XML, catalogSchema);
  assertEquals(result.catalog.book.map((b) => b["@_id"]), [1, 2]);
});

Deno.test("parses text content alongside attributes via #text", () => {
  const schema = z.object({
    note: z.object({
      "@_lang": z.string(),
      "#text": z.string(),
    }),
  });
  const result = parseXml('<note lang="en">Remember</note>', schema);
  assertEquals(result, { note: { "@_lang": "en", "#text": "Remember" } });
});

Deno.test("leaves primitive coercion to Zod", () => {
  const schema = z.object({
    data: z.object({
      count: z.coerce.number(),
      active: z.stringbool(),
      plain: z.string(),
    }),
  });
  const result = parseXml(
    "<data><count>42</count><active>true</active><plain>007</plain></data>",
    schema,
  );
  assertEquals(result, {
    data: { count: 42, active: true, plain: "007" },
  });
});

Deno.test("parses empty XML elements as empty strings", () => {
  const schema = z.object({
    a: z.object({
      b: z.literal(""),
      c: z.string(),
    }),
  });
  const result = parseXml("<a><b/><c></c></a>", schema);
  assertEquals(result, { a: { b: "", c: "" } });
});

Deno.test("lets Zod handle missing elements via optional and default", () => {
  const schema = z.object({
    config: z.object({
      host: z.string(),
      port: z.coerce.number().default(8080),
      label: z.string().optional(),
    }),
  });
  const result = parseXml("<config><host>example.com</host></config>", schema);
  assertEquals(result, { config: { host: "example.com", port: 8080 } });
});

Deno.test("reports missing required elements as a schema error", () => {
  const schema = z.object({
    config: z.object({ host: z.string() }),
  });
  const result = safeParseXml("<config><other>x</other></config>", schema);
  assert(!result.success);
  assertInstanceOf(result.error, XmlSchemaError);
});

Deno.test("ignores the XML declaration for non-strict schemas", () => {
  const schema = z.object({ a: z.string() });
  const result = parseXml(
    '<?xml version="1.0" encoding="UTF-8"?><a>x</a>',
    schema,
  );
  assertEquals(result, { a: "x" });
});

Deno.test("accepts parser option overrides", () => {
  const schema = z.object({
    item: z.object({ "@id": z.string(), "#text": z.string() }),
  });
  const result = parseXml('<item id="7">x</item>', schema, {
    parser: { attributeNamePrefix: "@" },
  });
  assertEquals(result, { item: { "@id": "7", "#text": "x" } });
});

Deno.test("parser option overrides can enable native number parsing", () => {
  const schema = z.object({ n: z.number() });
  const result = parseXml("<n>42</n>", schema, {
    parser: { parseTagValue: true },
  });
  assertEquals(result, { n: 42 });
});

Deno.test("safeParseXml returns success with data", () => {
  const result = safeParseXml(SINGLE_BOOK_XML, catalogSchema);
  assert(result.success);
  assertEquals(result.data.catalog.owner.name, "Ada");
  assertEquals(result.error, undefined);
});

Deno.test("safeParseXml returns failure with an SchemaXmlError", () => {
  const result = safeParseXml("<a><b>1</b></a>", z.object({ a: z.number() }));
  assert(!result.success);
  assertInstanceOf(result.error, XmlSchemaError);
  assertEquals(result.data, undefined);
});

Deno.test("safeParseXml re-throws errors that are not Schema XML errors", () => {
  const boom = z.object({
    a: z.string().transform(() => {
      throw new Error("boom");
    }),
  });
  let thrown: unknown;
  try {
    safeParseXml("<a>x</a>", boom);
  } catch (error) {
    thrown = error;
  }
  assertInstanceOf(thrown, Error);
  assertEquals(thrown.message, "boom");
});

Deno.test("createXmlParser applies its configuration to parse and safeParse", () => {
  const parser = createXmlParser({ parser: { attributeNamePrefix: "@" } });
  const schema = z.object({ item: z.object({ "@id": z.coerce.number() }) });

  const parsed = parser.parse('<item id="3"/>', schema);
  assertEquals(parsed, { item: { "@id": 3 } });

  const safe = parser.safeParse('<item id="3"/>', schema);
  assert(safe.success);
  assertEquals(safe.data, { item: { "@id": 3 } });

  const failed = parser.safeParse("<item>oops</item>", schema);
  assert(!failed.success);
});

Deno.test("createXmlParser without options uses the defaults", () => {
  const parser = createXmlParser();
  const schema = z.object({ item: z.object({ "@_id": z.string() }) });
  assertEquals(parser.parse('<item id="9"/>', schema), {
    item: { "@_id": "9" },
  });
});
