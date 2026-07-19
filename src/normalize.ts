/**
 * Structural normalization of parsed XML documents against a Zod schema.
 *
 * XML parsers cannot know whether `<book>` is a repeatable element: one
 * occurrence parses to a plain object, two parse to an array. This module
 * reshapes that unstable output so the Zod schema — the source of truth for
 * cardinality — always receives the shape it declares.
 *
 * Normalization is purely structural. It never coerces, validates, or drops
 * values; Zod handles missing, optional, defaulted, and invalid values after
 * normalization. The input document is never mutated.
 *
 * @module
 */

import type { z } from "zod";
import { XmlCardinalityError } from "./errors.ts";
import type { SchemaShape } from "./schema-inspector.ts";
import { resolveCardinality } from "./schema-inspector.ts";

/**
 * Recursively normalizes `value` (the output of an XML-to-object parser)
 * against `schema`:
 *
 * - Where the schema expects an array, a singleton value is wrapped into a
 *   one-element array and every element is normalized recursively.
 * - Where the schema expects a singleton, a one-element array is unwrapped;
 *   any other array length throws {@linkcode XmlCardinalityError}.
 * - Where the schema's cardinality is ambiguous (unions, tuples, records,
 *   maps, sets, ...), the value is passed through untouched.
 *
 * Returns a new value; `value` is never mutated.
 *
 * @throws {XmlCardinalityError} when element repetition contradicts the
 * schema's declared cardinality.
 */
export function normalizeXml(value: unknown, schema: z.ZodType): unknown {
  return normalizeValue(value, schema, []);
}

function normalizeValue(
  value: unknown,
  schema: z.ZodType,
  path: Array<string | number>,
): unknown {
  const cardinality = resolveCardinality(schema);
  switch (cardinality.kind) {
    case "opaque":
      return value;
    case "array":
      return normalizeArray(value, cardinality.element, path);
    case "object":
      return normalizeObject(value, cardinality.shape, path);
    case "singleton":
      return unwrapSingleton(value, path);
  }
}

function normalizeArray(
  value: unknown,
  element: z.ZodType,
  path: Array<string | number>,
): unknown {
  if (value === undefined || value === null) {
    // A missing or explicitly null value is not a cardinality question;
    // Zod decides via optional / nullable / default wrappers.
    return value;
  }
  const items = Array.isArray(value) ? value : [value];
  return items.map((item, index) =>
    normalizeValue(item, element, [...path, index])
  );
}

function normalizeObject(
  value: unknown,
  shape: SchemaShape,
  path: Array<string | number>,
): unknown {
  const unwrapped = unwrapSingleton(value, path);
  if (!isPlainObject(unwrapped)) {
    // Not an object (e.g. "" for an empty XML element); Zod reports it.
    return unwrapped;
  }
  // Copy the object so the parser output is never mutated. Keys that are not
  // in the schema shape are preserved untouched for loose/catchall objects.
  const result: Record<string, unknown> = { ...unwrapped };
  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (Object.hasOwn(unwrapped, key)) {
      result[key] = normalizeValue(unwrapped[key], fieldSchema, [...path, key]);
    }
  }
  return result;
}

function unwrapSingleton(
  value: unknown,
  path: Array<string | number>,
): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  if (value.length === 1) {
    return value[0];
  }
  throw new XmlCardinalityError({
    path,
    expected: "singleton",
    receivedCount: value.length,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
