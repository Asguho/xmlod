import { assert, assertEquals, assertThrows } from "@std/assert";
import { z } from "zod";
import { normalizeXml, parseXml, XmlCardinalityError } from "../src/mod.ts";
import { RECURSIVE_SECTIONS_XML } from "./fixtures/catalog.ts";

Deno.test("normalizes optional arrays when present", () => {
  const schema = z.object({
    list: z.object({ item: z.array(z.string()).optional() }),
  });
  assertEquals(parseXml("<list><item>a</item></list>", schema), {
    list: { item: ["a"] },
  });
  assertEquals(parseXml("<list><item>a</item><item>b</item></list>", schema), {
    list: { item: ["a", "b"] },
  });
});

Deno.test("leaves optional arrays absent when the element is missing", () => {
  const schema = z.object({
    list: z.object({ other: z.string(), item: z.array(z.string()).optional() }),
  });
  assertEquals(parseXml("<list><other>x</other></list>", schema), {
    list: { other: "x" },
  });
});

Deno.test("normalizes nullable arrays and passes null through", () => {
  const schema = z.object({ item: z.array(z.string()).nullable() });
  assertEquals(normalizeXml({ item: "a" }, schema), { item: ["a"] });
  assertEquals(normalizeXml({ item: null }, schema), { item: null });
  assert(schema.parse(normalizeXml({ item: null }, schema)).item === null);
});

Deno.test("applies array defaults when the element is missing", () => {
  const schema = z.object({
    list: z.object({
      name: z.string(),
      item: z.array(z.string()).default([]),
    }),
  });
  assertEquals(parseXml("<list><name>empty</name></list>", schema), {
    list: { name: "empty", item: [] },
  });
  assertEquals(parseXml("<list><name>n</name><item>a</item></list>", schema), {
    list: { name: "n", item: ["a"] },
  });
});

Deno.test("normalizes prefaulted arrays", () => {
  const schema = z.object({
    list: z.object({
      name: z.string(),
      item: z.array(z.string()).prefault(["fallback"]),
    }),
  });
  assertEquals(parseXml("<list><name>n</name><item>a</item></list>", schema), {
    list: { name: "n", item: ["a"] },
  });
  assertEquals(parseXml("<list><name>n</name></list>", schema), {
    list: { name: "n", item: ["fallback"] },
  });
});

Deno.test("normalizes arrays wrapped in catch and falls back on invalid data", () => {
  const schema = z.object({
    list: z.object({ n: z.array(z.coerce.number()).catch([-1]) }),
  });
  assertEquals(parseXml("<list><n>1</n></list>", schema), {
    list: { n: [1] },
  });
  assertEquals(parseXml("<list><n>oops</n></list>", schema), {
    list: { n: [-1] },
  });
});

Deno.test("lets z.catch supply its fallback on a cardinality mismatch", () => {
  // Normalization must not pre-empt a declared fallback: the raw repeated
  // value is passed through so Zod fails validation and applies the catch.
  const schema = z.object({
    root: z.object({ a: z.string().catch("fallback") }),
  });
  assertEquals(parseXml("<root><a>x</a><a>y</a></root>", schema), {
    root: { a: "fallback" },
  });
  assertEquals(parseXml("<root><a>x</a></root>", schema), {
    root: { a: "x" },
  });
});

Deno.test("lets an outer z.catch swallow a nested cardinality mismatch", () => {
  const schema = z.object({
    root: z.object({ a: z.string() }).catch({ a: "fallback" }),
  });
  assertEquals(parseXml("<root><a>x</a><a>y</a></root>", schema), {
    root: { a: "fallback" },
  });
});

Deno.test("normalizes success-wrapped schemas against their input side", () => {
  const schema = z.object({
    item: z.success(z.array(z.string())),
  });
  // z.success validates the inner schema's input, so a single element is
  // still wrapped into a one-element array before Zod runs.
  assertEquals(normalizeXml({ item: "a" }, schema), { item: ["a"] });
  assertEquals(schema.parse(normalizeXml({ item: "a" }, schema)), {
    item: true,
  });
});

Deno.test("normalizes readonly arrays", () => {
  const schema = z.object({
    list: z.object({ item: z.array(z.string()).readonly() }),
  });
  const result = parseXml("<list><item>a</item></list>", schema);
  assertEquals([...result.list.item], ["a"]);
  assert(Object.isFrozen(result.list.item));
});

Deno.test("normalizes nonoptional-wrapped arrays", () => {
  const schema = z.object({
    list: z.object({ item: z.array(z.string()).optional().nonoptional() }),
  });
  assertEquals(parseXml("<list><item>a</item></list>", schema), {
    list: { item: ["a"] },
  });
});

Deno.test("looks through stacked wrappers", () => {
  const schema = z.object({
    list: z.object({
      name: z.string(),
      item: z.array(z.string()).readonly().optional().nullable().default(null),
    }),
  });
  assertEquals(parseXml("<list><name>n</name><item>a</item></list>", schema), {
    list: { name: "n", item: ["a"] },
  });
  assertEquals(parseXml("<list><name>n</name></list>", schema), {
    list: { name: "n", item: null },
  });
});

Deno.test("normalizes arrays nested inside optional objects", () => {
  const schema = z.object({
    catalog: z.object({
      shelf: z.object({ book: z.array(z.string()) }).optional(),
    }),
  });
  assertEquals(
    parseXml("<catalog><shelf><book>a</book></shelf></catalog>", schema),
    {
      catalog: { shelf: { book: ["a"] } },
    },
  );
  assertEquals(
    parseXml(
      "<catalog><other>x</other></catalog>",
      z.object({
        catalog: z.object({
          other: z.string(),
          shelf: z.object({ book: z.array(z.string()) }).optional(),
        }),
      }),
    ),
    { catalog: { other: "x" } },
  );
});

Deno.test("normalizes lazy recursive schemas", () => {
  interface Section {
    title: string;
    section?: Section[];
  }
  const sectionSchema: z.ZodType<Section> = z.lazy(() =>
    z.object({
      title: z.string(),
      section: z.array(sectionSchema).optional(),
    })
  );
  const schema = z.object({
    doc: z.object({ section: z.array(sectionSchema) }),
  });
  const result = parseXml(RECURSIVE_SECTIONS_XML, schema);
  assertEquals(result, {
    doc: {
      section: [{
        title: "Top",
        section: [{
          title: "Nested",
          section: [{ title: "Deep" }],
        }],
      }],
    },
  });
});

Deno.test("enforces singleton cardinality through lazy recursion", () => {
  interface Node {
    name: string;
    child?: Node;
  }
  const nodeSchema: z.ZodType<Node> = z.lazy(() =>
    z.object({ name: z.string(), child: nodeSchema.optional() })
  );
  const schema = z.object({ root: nodeSchema });
  const error = assertThrows(
    () =>
      parseXml(
        "<root><name>a</name><child><name>b</name></child><child><name>c</name></child></root>",
        schema,
      ),
    XmlCardinalityError,
  );
  assertEquals(error.path, ["root", "child"]);
});

Deno.test("normalizes refined arrays before Zod runs the refinement", () => {
  const schema = z.object({
    list: z.object({
      item: z.array(z.string()).refine((items) => items.length >= 1),
    }),
  });
  assertEquals(parseXml("<list><item>a</item></list>", schema), {
    list: { item: ["a"] },
  });
});

Deno.test("normalizes transformed arrays before the transform runs", () => {
  const schema = z.object({
    list: z.object({
      item: z.array(z.string()).transform((items) => items.length),
    }),
  });
  assertEquals(parseXml("<list><item>a</item></list>", schema), {
    list: { item: 1 },
  });
  assertEquals(parseXml("<list><item>a</item><item>b</item></list>", schema), {
    list: { item: 2 },
  });
});

Deno.test("classifies pipes by their input side", () => {
  const schema = z.object({
    n: z.string().pipe(z.coerce.number()),
  });
  assertEquals(parseXml("<n>42</n>", schema), { n: 42 });
  assertThrows(
    () => normalizeXml({ n: ["1", "2"] }, schema),
    XmlCardinalityError,
  );
});

Deno.test("treats z.preprocess conservatively as opaque", () => {
  // z.preprocess pipes a transform into the target schema; its input side is
  // a free-form transform, so the raw value is passed through untouched.
  const schema = z.object({
    n: z.preprocess((v) => (Array.isArray(v) ? v : [v]), z.array(z.string())),
  });
  assertEquals(parseXml("<n>x</n>", schema), { n: ["x"] });
});
