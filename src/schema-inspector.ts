/**
 * The single module that inspects Zod schemas to determine their structural
 * cardinality.
 *
 * Zod does not expose a public API for walking a schema's structure, so this
 * module reads the internal `_zod.def` representation (stable within Zod 4,
 * also surfaced publicly as `schema.def`). Every unavoidable cast and every
 * assumption about Zod internals lives here so the rest of the library can
 * stay agnostic to Zod's internal representation.
 *
 * @module
 */

import type { ZodType } from "zod";

/** The shape of a Zod object schema: field name to field schema. */
export type SchemaShape = Readonly<Record<string, ZodType>>;

/**
 * The structural cardinality of a Zod schema, after looking through wrapper
 * schemas such as `optional`, `nullable`, `default`, and `lazy`.
 *
 * - `array`: the schema expects an array; `element` validates each item.
 * - `object`: the schema expects a single object with the given `shape`.
 * - `singleton`: the schema expects a single primitive-like value
 *   (string, number, boolean, literal, enum, ...).
 * - `opaque`: the schema's cardinality is ambiguous (union, intersection,
 *   tuple, record, map, set, ...) or unrecognized; Xmlod passes the raw
 *   value through to Zod unchanged.
 */
export type SchemaCardinality =
  | { readonly kind: "array"; readonly element: ZodType }
  | { readonly kind: "object"; readonly shape: SchemaShape }
  | { readonly kind: "singleton" }
  | { readonly kind: "opaque" };

/**
 * The subset of Zod's internal def object that the inspector reads. All
 * properties are optional because the def is only structurally probed.
 */
interface InternalDef {
  readonly type?: unknown;
  readonly innerType?: unknown;
  readonly getter?: unknown;
  readonly in?: unknown;
  readonly element?: unknown;
  readonly shape?: unknown;
}

function internalDefOf(schema: unknown): InternalDef | undefined {
  if (typeof schema !== "object" || schema === null) {
    return undefined;
  }
  const internals = (schema as { _zod?: { def?: unknown } })._zod;
  const def = internals?.def;
  if (typeof def !== "object" || def === null) {
    return undefined;
  }
  return def as InternalDef;
}

/**
 * Wrapper schema types that Xmlod looks through when determining
 * cardinality. Each stores its wrapped schema in `def.innerType`.
 */
const INNER_TYPE_WRAPPERS: ReadonlySet<string> = new Set([
  "optional",
  "nullable",
  "default",
  "prefault",
  "catch",
  "readonly",
  "nonoptional",
]);

/**
 * Schema types whose values are single primitive-like values. Repeated XML
 * elements are a cardinality error for these.
 */
const SINGLETON_TYPES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "boolean",
  "bigint",
  "date",
  "literal",
  "enum",
  "template_literal",
  "nan",
  "null",
  "undefined",
  "void",
  "symbol",
  "file",
]);

const OPAQUE: SchemaCardinality = { kind: "opaque" };
const SINGLETON: SchemaCardinality = { kind: "singleton" };

/**
 * Determines the structural cardinality of `schema`.
 *
 * Looks through wrapper schemas (`optional`, `nullable`, `default`,
 * `prefault`, `catch`, `readonly`, `nonoptional`, `lazy`) and classifies
 * pipes (including `.transform()` chains) by their input side, because the
 * input side is what Zod validates against the raw document first.
 *
 * Anything whose cardinality cannot be determined without guessing —
 * unions, discriminated unions, intersections, tuples, records, maps, sets,
 * `z.any()`, `z.unknown()`, standalone transforms, and unrecognized schema
 * types — is reported as `opaque`.
 */
export function resolveCardinality(schema: ZodType): SchemaCardinality {
  let current: unknown = schema;
  // Guards against pathological self-referential wrappers such as
  // `const s: ZodType = z.lazy(() => s)`.
  const seen = new Set<unknown>();
  while (!seen.has(current)) {
    seen.add(current);
    const def = internalDefOf(current);
    if (def === undefined || typeof def.type !== "string") {
      return OPAQUE;
    }
    if (INNER_TYPE_WRAPPERS.has(def.type)) {
      current = def.innerType;
      continue;
    }
    if (def.type === "lazy") {
      if (typeof def.getter !== "function") {
        return OPAQUE;
      }
      current = (def.getter as () => unknown)();
      continue;
    }
    if (def.type === "pipe") {
      current = def.in;
      continue;
    }
    if (def.type === "array") {
      const element = internalDefOf(def.element) !== undefined
        ? def.element as ZodType
        : undefined;
      return element === undefined ? OPAQUE : { kind: "array", element };
    }
    if (def.type === "object") {
      const shape = def.shape;
      if (typeof shape !== "object" || shape === null) {
        return OPAQUE;
      }
      return { kind: "object", shape: shape as SchemaShape };
    }
    if (SINGLETON_TYPES.has(def.type)) {
      return SINGLETON;
    }
    return OPAQUE;
  }
  return OPAQUE;
}
