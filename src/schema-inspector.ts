/**
 * The single module that inspects Zod schemas to determine their structural
 * cardinality.
 *
 * Zod does not expose a traversal API, but it documents reading
 * `schema._zod.def` and discriminating on `def.type` as the supported
 * pattern for ecosystem libraries — Zod's own JSON Schema converter works
 * the same way. The def is typed with the `$ZodTypes` union from
 * `zod/v4/core`, the permanent core package shared by Zod and Zod Mini, so
 * the compiler flags any drift in Zod's def shapes. Every assumption about
 * Zod internals lives here so the rest of the library can stay agnostic to
 * Zod's internal representation.
 *
 * @module
 */

import type { $ZodType, $ZodTypes } from "zod/v4/core";

/** The shape of a Zod object schema: field name to field schema. */
export type SchemaShape = Readonly<Record<string, $ZodType>>;

/**
 * The structural cardinality of a Zod schema, after looking through wrapper
 * schemas such as `optional`, `nullable`, `default`, and `lazy`.
 *
 * - `array`: the schema expects an array; `element` validates each item.
 * - `tuple`: the schema expects a fixed-position array; `items` validate
 *   positionally and `rest` validates any items beyond them.
 * - `object`: the schema expects a single object with the given `shape`.
 * - `record`: the schema expects a single object; `valueType` validates
 *   every property value.
 * - `singleton`: the schema expects a single primitive-like value
 *   (string, number, boolean, literal, enum, ...).
 * - `opaque`: the schema's cardinality is ambiguous (mixed union, map, set,
 *   ...) or unrecognized; Xmlod passes the raw value through to Zod
 *   unchanged.
 */
export type SchemaCardinality =
  | { readonly kind: "array"; readonly element: $ZodType }
  | {
    readonly kind: "tuple";
    readonly items: ReadonlyArray<$ZodType>;
    readonly rest: $ZodType | undefined;
  }
  | { readonly kind: "object"; readonly shape: SchemaShape }
  | { readonly kind: "record"; readonly valueType: $ZodType }
  | { readonly kind: "singleton" }
  | { readonly kind: "opaque" };

/**
 * The full result of inspecting a schema: its cardinality plus whether a
 * `.catch()` wrapper was crossed on the way to it. When a catch was crossed,
 * a cardinality mismatch must not throw — the raw value is passed through so
 * Zod fails validation and applies the declared fallback instead.
 */
export interface SchemaInspection {
  readonly cardinality: SchemaCardinality;
  readonly crossedCatch: boolean;
}

/**
 * The subset of Zod's internals object that the inspector probes before
 * trusting the typed def. Values from outside Zod (or fabricated in tests)
 * may not be well-formed, so everything is optional and `unknown`.
 */
interface InternalsProbe {
  readonly def?: unknown;
  readonly innerType?: unknown;
}

/** The internal def union Zod documents for ecosystem libraries. */
type ZodDef = $ZodTypes["_zod"]["def"];

function internalsOf(value: unknown): InternalsProbe | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const internals = (value as { _zod?: unknown })._zod;
  if (typeof internals !== "object" || internals === null) {
    return undefined;
  }
  return internals as InternalsProbe;
}

function defOf(internals: InternalsProbe): ZodDef | undefined {
  const def = internals.def;
  if (typeof def !== "object" || def === null) {
    return undefined;
  }
  if (typeof (def as { type?: unknown }).type !== "string") {
    return undefined;
  }
  return def as ZodDef;
}

function isSchema(value: unknown): value is $ZodType {
  const internals = internalsOf(value);
  return internals !== undefined && typeof internals.def === "object" &&
    internals.def !== null;
}

const OPAQUE: SchemaCardinality = { kind: "opaque" };
const SINGLETON: SchemaCardinality = { kind: "singleton" };

/**
 * Upper bound on wrapper unwrapping. The `seen` set catches self-referential
 * wrappers by identity; this bound additionally stops generator chains like
 * `const make = () => z.lazy(() => make())` that yield a fresh schema at
 * every step, which identity tracking cannot catch.
 */
const MAX_WRAPPER_DEPTH = 256;

/**
 * Determines the structural cardinality of `schema`.
 *
 * Looks through wrapper schemas (`optional`, `nullable`, `default`,
 * `prefault`, `catch`, `readonly`, `nonoptional`, `success`, `promise`,
 * `lazy`) and classifies pipes (including `.transform()` chains, codecs,
 * and `z.stringbool()`) by their input side, because the input side is what
 * Zod validates against the raw document first.
 *
 * A union whose branches are all singletons is itself a singleton, and an
 * intersection of two objects with disjoint shapes is an object. Anything
 * else whose cardinality cannot be determined without guessing — mixed
 * unions, maps, sets, `z.any()`, `z.unknown()`, standalone transforms, and
 * unrecognized schema types — is reported as `opaque`.
 */
export function resolveCardinality(schema: $ZodType): SchemaCardinality {
  return inspect(schema, new Set()).cardinality;
}

/**
 * Like {@linkcode resolveCardinality}, but also reports whether a `.catch()`
 * wrapper was crossed, which normalization uses to defer cardinality
 * mismatches to Zod's declared fallback.
 */
export function inspectCardinality(schema: $ZodType): SchemaInspection {
  return inspect(schema, new Set());
}

function inspect(schema: unknown, seen: Set<unknown>): SchemaInspection {
  let crossedCatch = false;
  let current: unknown = schema;
  for (let depth = 0; depth < MAX_WRAPPER_DEPTH; depth++) {
    // Guards against pathological self-referential wrappers such as
    // `const s: ZodType = z.lazy(() => s)`.
    if (seen.has(current)) {
      break;
    }
    seen.add(current);
    const internals = internalsOf(current);
    if (internals === undefined) {
      break;
    }
    const def = defOf(internals);
    if (def === undefined) {
      break;
    }
    switch (def.type) {
      case "catch":
        crossedCatch = true;
        current = def.innerType;
        continue;
      case "optional":
      case "nullable":
      case "default":
      case "prefault":
      case "readonly":
      case "nonoptional":
      case "success":
      case "promise":
        // All of these validate their inner schema's input, which is what
        // the raw document must satisfy.
        current = def.innerType;
        continue;
      case "lazy":
        // Zod caches the constructed inner schema on `_zod.innerType`;
        // calling `def.getter()` directly would rebuild the inner schema on
        // every visit and defeat the identity-based cycle guard above.
        if (internals.innerType !== undefined) {
          current = internals.innerType;
          continue;
        }
        if (typeof def.getter !== "function") {
          return { cardinality: OPAQUE, crossedCatch };
        }
        current = def.getter();
        continue;
      case "pipe":
        // Covers `.transform()` chains, codecs, and `z.stringbool()`. For
        // `z.preprocess(...)` the input side is a bare transform, which
        // resolves to opaque below — the raw input shape is unknowable.
        current = def.in;
        continue;
      case "array":
        return {
          cardinality: isSchema(def.element)
            ? { kind: "array", element: def.element }
            : OPAQUE,
          crossedCatch,
        };
      case "tuple": {
        const items: unknown = def.items;
        if (!Array.isArray(items) || !items.every(isSchema)) {
          return { cardinality: OPAQUE, crossedCatch };
        }
        return {
          cardinality: {
            kind: "tuple",
            items,
            rest: isSchema(def.rest) ? def.rest : undefined,
          },
          crossedCatch,
        };
      }
      case "object": {
        const shape: unknown = def.shape;
        return {
          cardinality: typeof shape === "object" && shape !== null
            ? { kind: "object", shape: shape as SchemaShape }
            : OPAQUE,
          crossedCatch,
        };
      }
      case "record":
        return {
          cardinality: isSchema(def.valueType)
            ? { kind: "record", valueType: def.valueType }
            : OPAQUE,
          crossedCatch,
        };
      case "union": {
        // Discriminated unions share `type: "union"`, so they take this
        // branch too. A union of singletons rejects arrays in every branch,
        // so it can be classified as a singleton; any other mix would
        // require guessing, and stays opaque. Each branch is inspected with
        // a copy of `seen` so sibling branches cannot mask each other's
        // schemas while ancestor cycles are still detected.
        const options: unknown = def.options;
        if (!Array.isArray(options) || options.length === 0) {
          return { cardinality: OPAQUE, crossedCatch };
        }
        for (const option of options) {
          const branch = inspect(option, new Set(seen));
          crossedCatch = crossedCatch || branch.crossedCatch;
          if (branch.cardinality.kind !== "singleton") {
            return { cardinality: OPAQUE, crossedCatch };
          }
        }
        return { cardinality: SINGLETON, crossedCatch };
      }
      case "intersection": {
        // An intersection of two objects — a common way to combine XML
        // attribute and element groups — normalizes as one object with the
        // merged shape. Overlapping keys would require reconciling two
        // schemas for the same value, so they stay opaque.
        const left = inspect(def.left, new Set(seen));
        const right = inspect(def.right, new Set(seen));
        crossedCatch = crossedCatch || left.crossedCatch ||
          right.crossedCatch;
        if (
          left.cardinality.kind !== "object" ||
          right.cardinality.kind !== "object"
        ) {
          return { cardinality: OPAQUE, crossedCatch };
        }
        const leftShape = left.cardinality.shape;
        const rightShape = right.cardinality.shape;
        for (const key of Object.keys(rightShape)) {
          if (Object.hasOwn(leftShape, key)) {
            return { cardinality: OPAQUE, crossedCatch };
          }
        }
        return {
          cardinality: {
            kind: "object",
            shape: { ...leftShape, ...rightShape },
          },
          crossedCatch,
        };
      }
      case "string":
      case "number":
      case "boolean":
      case "bigint":
      case "date":
      case "literal":
      case "enum":
      case "template_literal":
      case "nan":
      case "null":
      case "undefined":
      case "void":
      case "symbol":
      case "file":
        return { cardinality: SINGLETON, crossedCatch };
      default:
        // any, unknown, never, map, set, standalone transforms, custom
        // schemas, and def types from future Zod versions.
        return { cardinality: OPAQUE, crossedCatch };
    }
  }
  return { cardinality: OPAQUE, crossedCatch };
}
