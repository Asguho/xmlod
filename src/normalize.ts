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

import type { $ZodType } from "zod/v4/core";
import { XmlCardinalityError } from "./errors.ts";
import type { SchemaCardinality, SchemaShape } from "./schema-inspector.ts";
import { inspectCardinality } from "./schema-inspector.ts";

/**
 * Recursively normalizes `value` (the output of an XML-to-object parser)
 * against `schema`:
 *
 * - Where the schema expects an array or tuple, a singleton value is wrapped
 *   into a one-element array and every element is normalized recursively
 *   (tuples position by position).
 * - Where the schema expects an object or record, its values are normalized
 *   recursively against the field schemas or the record's value schema.
 * - Where the schema expects a singleton, a one-element array is unwrapped;
 *   any other array length throws {@linkcode XmlCardinalityError} — unless
 *   the schema declares a `.catch()` fallback, in which case the raw value
 *   is passed through so Zod applies the fallback.
 * - Where the schema's cardinality is ambiguous (mixed unions, maps, sets,
 *   ...), the value is passed through untouched.
 *
 * Returns a new value; `value` is never mutated.
 *
 * @throws {XmlCardinalityError} when element repetition contradicts the
 * schema's declared cardinality.
 */
export function normalizeXml(value: unknown, schema: $ZodType): unknown {
  return normalizeValue(value, schema, []);
}

function normalizeValue(
  value: unknown,
  schema: $ZodType,
  path: Array<string | number>,
): unknown {
  const { cardinality, crossedCatch } = inspectCardinality(schema);
  if (!crossedCatch) {
    return applyCardinality(value, cardinality, path);
  }
  try {
    return applyCardinality(value, cardinality, path);
  } catch (error) {
    if (error instanceof XmlCardinalityError) {
      // A .catch() wrapper declares a fallback for invalid values. Pass the
      // raw value through so Zod fails validation and applies the fallback,
      // instead of Schema XML pre-empting it with a thrown error.
      return value;
    }
    throw error;
  }
}

function applyCardinality(
  value: unknown,
  cardinality: SchemaCardinality,
  path: Array<string | number>,
): unknown {
  switch (cardinality.kind) {
    case "opaque":
      return value;
    case "array":
      return normalizeArray(value, cardinality.element, path);
    case "tuple":
      return normalizeTuple(value, cardinality.items, cardinality.rest, path);
    case "object":
      return normalizeObject(value, cardinality.shape, path);
    case "record":
      return normalizeRecord(value, cardinality.valueType, path);
    case "singleton":
      return unwrapSingleton(value, path);
  }
}

function normalizeArray(
  value: unknown,
  element: $ZodType,
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

function normalizeTuple(
  value: unknown,
  items: ReadonlyArray<$ZodType>,
  rest: $ZodType | undefined,
  path: Array<string | number>,
): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  const entries = Array.isArray(value) ? value : [value];
  return entries.map((entry, index) => {
    const schema = index < items.length ? items[index] : rest;
    return schema === undefined
      ? entry
      : normalizeValue(entry, schema, [...path, index]);
  });
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

function normalizeRecord(
  value: unknown,
  valueType: $ZodType,
  path: Array<string | number>,
): unknown {
  const unwrapped = unwrapSingleton(value, path);
  if (!isPlainObject(unwrapped)) {
    return unwrapped;
  }
  // Spread before assigning so an own "__proto__" key stays a data property.
  const result: Record<string, unknown> = { ...unwrapped };
  for (const key of Object.keys(unwrapped)) {
    result[key] = normalizeValue(unwrapped[key], valueType, [...path, key]);
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
