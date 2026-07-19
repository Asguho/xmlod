import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { resolveCardinality } from "../src/schema-inspector.ts";

// This suite exercises the inspector directly, including the defensive
// branches for values that are not well-formed Zod 4 schemas. Fabricating
// such values requires casts; they are confined to this test file.
const asSchema = (value: unknown): z.ZodType => value as z.ZodType;

Deno.test("classifies primitive schemas as singletons", () => {
  for (
    const schema of [
      z.string(),
      z.coerce.number(),
      z.boolean(),
      z.bigint(),
      z.date(),
      z.literal("x"),
      z.enum(["a", "b"]),
      z.templateLiteral(["a", z.string()]),
    ]
  ) {
    assertEquals(resolveCardinality(schema).kind, "singleton");
  }
});

Deno.test("classifies arrays with their element schema", () => {
  const result = resolveCardinality(z.array(z.string()));
  assert(result.kind === "array");
  assertEquals(resolveCardinality(result.element).kind, "singleton");
});

Deno.test("classifies objects with their shape", () => {
  const result = resolveCardinality(z.object({ a: z.string() }));
  assert(result.kind === "object");
  assertEquals(Object.keys(result.shape), ["a"]);
});

Deno.test("classifies strict and loose objects as objects", () => {
  assertEquals(
    resolveCardinality(z.strictObject({ a: z.string() })).kind,
    "object",
  );
  assertEquals(
    resolveCardinality(z.looseObject({ a: z.string() })).kind,
    "object",
  );
});

Deno.test("looks through every supported wrapper", () => {
  const array = z.array(z.string());
  for (
    const wrapped of [
      array.optional(),
      array.nullable(),
      array.default([]),
      array.prefault([]),
      array.catch([]),
      array.readonly(),
      array.optional().nonoptional(),
      z.lazy(() => array),
      array.refine(() => true),
    ]
  ) {
    assertEquals(resolveCardinality(wrapped).kind, "array");
  }
});

Deno.test("classifies pipes by their input side", () => {
  assertEquals(
    resolveCardinality(z.string().pipe(z.coerce.number())).kind,
    "singleton",
  );
  assertEquals(
    resolveCardinality(z.array(z.string()).transform((a) => a.length)).kind,
    "array",
  );
});

Deno.test("classifies ambiguous structural schemas as opaque", () => {
  for (
    const schema of [
      z.union([z.string(), z.number()]),
      z.discriminatedUnion("t", [z.object({ t: z.literal("a") })]),
      z.intersection(z.object({}), z.object({})),
      z.tuple([z.string()]),
      z.record(z.string(), z.string()),
      z.map(z.string(), z.string()),
      z.set(z.string()),
      z.any(),
      z.unknown(),
      z.never(),
      z.transform((v) => v),
    ]
  ) {
    assertEquals(resolveCardinality(schema).kind, "opaque");
  }
});

Deno.test("treats values that are not Zod schemas as opaque", () => {
  assertEquals(resolveCardinality(asSchema(undefined)).kind, "opaque");
  assertEquals(resolveCardinality(asSchema(null)).kind, "opaque");
  assertEquals(resolveCardinality(asSchema(42)).kind, "opaque");
  assertEquals(resolveCardinality(asSchema({})).kind, "opaque");
  assertEquals(resolveCardinality(asSchema({ _zod: {} })).kind, "opaque");
  assertEquals(
    resolveCardinality(asSchema({ _zod: { def: "x" } })).kind,
    "opaque",
  );
  assertEquals(
    resolveCardinality(asSchema({ _zod: { def: { type: 42 } } })).kind,
    "opaque",
  );
});

Deno.test("treats malformed defs for known types as opaque", () => {
  assertEquals(
    resolveCardinality(
      asSchema({ _zod: { def: { type: "lazy", getter: "x" } } }),
    )
      .kind,
    "opaque",
  );
  assertEquals(
    resolveCardinality(
      asSchema({ _zod: { def: { type: "array", element: 1 } } }),
    )
      .kind,
    "opaque",
  );
  assertEquals(
    resolveCardinality(
      asSchema({ _zod: { def: { type: "object", shape: null } } }),
    )
      .kind,
    "opaque",
  );
});

Deno.test("guards against self-referential lazy schemas", () => {
  // deno-lint-ignore prefer-const
  let cyclic: z.ZodType;
  cyclic = z.lazy(() => cyclic);
  assertEquals(resolveCardinality(cyclic).kind, "opaque");
});

Deno.test("resolves deeply stacked wrappers", () => {
  const schema = z.array(z.string()).readonly().optional().nullable()
    .default(null).catch(null);
  assertEquals(resolveCardinality(schema).kind, "array");
});
