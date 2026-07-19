import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertThrows,
} from "@std/assert";
import { z } from "zod";
import {
  formatPath,
  parseXml,
  safeParseXml,
  XmlCardinalityError,
  XmlodError,
  XmlSchemaError,
  XmlSyntaxError,
} from "../src/mod.ts";
import { INVALID_XML, TWO_OWNERS_XML } from "./fixtures/catalog.ts";

Deno.test("throws XmlSyntaxError for malformed XML", () => {
  const error = assertThrows(
    () => parseXml(INVALID_XML, z.object({})),
    XmlSyntaxError,
  );
  assertInstanceOf(error, XmlodError);
  assertInstanceOf(error.cause, Error);
  assert(error.message.startsWith("Invalid XML:"));
});

Deno.test("throws XmlSyntaxError for non-XML input", () => {
  assertThrows(() => parseXml("hello", z.object({})), XmlSyntaxError);
  assertThrows(() => parseXml("", z.object({})), XmlSyntaxError);
});

Deno.test("wraps Zod validation failures in XmlSchemaError", () => {
  const schema = z.object({ a: z.object({ b: z.coerce.number() }) });
  const error = assertThrows(
    () => parseXml("<a><b>not-a-number</b></a>", schema),
    XmlSchemaError,
  );
  assertInstanceOf(error, XmlodError);
  assertInstanceOf(error.cause, z.ZodError);
  assert(error.message.includes("did not match the provided schema"));
});

Deno.test("matches the documented cardinality error message", () => {
  const schema = z.object({
    catalog: z.object({ owner: z.object({ name: z.string() }) }),
  });
  const error = assertThrows(
    () => parseXml(TWO_OWNERS_XML, schema),
    XmlCardinalityError,
  );
  assertEquals(
    error.message,
    "Expected one XML element at catalog.owner, but found 2. " +
      "Use z.array(...) if repetition is allowed.",
  );
});

Deno.test("XmlCardinalityError exposes path, expected, and receivedCount", () => {
  const error = new XmlCardinalityError({
    path: ["catalog", "book", 3, "author"],
    expected: "singleton",
    receivedCount: 2,
  });
  assertEquals(error.path, ["catalog", "book", 3, "author"]);
  assertEquals(error.expected, "singleton");
  assertEquals(error.receivedCount, 2);
  assert(error.message.includes("catalog.book[3].author"));
});

Deno.test("XmlCardinalityError formats the array-expected variant", () => {
  const error = new XmlCardinalityError({
    path: ["items"],
    expected: "array",
    receivedCount: 1,
  });
  assertEquals(
    error.message,
    "Expected repeated XML elements at items, but found 1.",
  );
});

Deno.test("XmlCardinalityError copies its path defensively", () => {
  const path = ["a"];
  const error = new XmlCardinalityError({
    path,
    expected: "singleton",
    receivedCount: 2,
  });
  path.push("mutated");
  assertEquals(error.path, ["a"]);
});

Deno.test("error classes carry distinguishing names", () => {
  assertEquals(new XmlodError("x").name, "XmlodError");
  assertEquals(new XmlSyntaxError("x").name, "XmlSyntaxError");
  assertEquals(new XmlSchemaError("x").name, "XmlSchemaError");
  assertEquals(
    new XmlCardinalityError({
      path: [],
      expected: "singleton",
      receivedCount: 2,
    })
      .name,
    "XmlCardinalityError",
  );
});

Deno.test("formatPath renders keys, indexes, and the root", () => {
  assertEquals(formatPath([]), "(root)");
  assertEquals(formatPath(["catalog", "owner"]), "catalog.owner");
  assertEquals(
    formatPath(["catalog", "book", 1, "title"]),
    "catalog.book[1].title",
  );
  assertEquals(formatPath(["a", 0, 1, "b"]), "a[0][1].b");
});

Deno.test("cardinality error at the document root mentions (root)", () => {
  const error = new XmlCardinalityError({
    path: [],
    expected: "singleton",
    receivedCount: 3,
  });
  assert(error.message.includes("(root)"));
});

Deno.test("safeParseXml surfaces each error variant", () => {
  const objectSchema = z.object({ a: z.object({ b: z.string() }) });

  const syntax = safeParseXml(INVALID_XML, objectSchema);
  assert(!syntax.success);
  assertInstanceOf(syntax.error, XmlSyntaxError);

  const cardinality = safeParseXml("<a><b>1</b><b>2</b></a>", objectSchema);
  assert(!cardinality.success);
  assertInstanceOf(cardinality.error, XmlCardinalityError);

  const schemaError = safeParseXml("<a><c>1</c></a>", objectSchema);
  assert(!schemaError.success);
  assertInstanceOf(schemaError.error, XmlSchemaError);
});

Deno.test("XmlSchemaError cause contains structured Zod issues", () => {
  const schema = z.object({ a: z.object({ b: z.coerce.number() }) });
  const result = safeParseXml("<a><b>nope</b></a>", schema);
  assert(!result.success);
  const cause = result.error.cause;
  assertInstanceOf(cause, z.ZodError);
  assertEquals(cause.issues[0]?.path, ["a", "b"]);
});
