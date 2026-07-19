/**
 * The parsing entry points of Xmlod: {@linkcode parseXml},
 * {@linkcode safeParseXml}, and {@linkcode createXmlParser}.
 *
 * @module
 */

import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { XmlodError, XmlSchemaError, XmlSyntaxError } from "./errors.ts";
import { normalizeXml } from "./normalize.ts";
import type {
  ParseXmlOptions,
  XmlParserOptions,
  XmlSafeParseResult,
} from "./types.ts";

/**
 * The default configuration Xmlod passes to `fast-xml-parser`.
 *
 * Attributes are kept (prefixed with `@_`), values are trimmed, and the
 * parser's own primitive coercion is disabled so that Zod handles all value
 * coercion and validation.
 */
export const DEFAULT_PARSER_OPTIONS: Readonly<XmlParserOptions> = Object
  .freeze({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
  });

function parseXmlDocument(xml: string, overrides?: XmlParserOptions): unknown {
  const parser = new XMLParser({ ...DEFAULT_PARSER_OPTIONS, ...overrides });
  try {
    // The second argument enables well-formedness validation; without it,
    // fast-xml-parser silently accepts malformed input.
    return parser.parse(xml, true);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new XmlSyntaxError(`Invalid XML:${detail}`, { cause: error });
  }
}

/**
 * Parses an XML string and validates it against a Zod schema.
 *
 * The schema is the source of truth for cardinality: where it declares
 * `z.array(...)`, a single XML element is normalized into a one-element
 * array; where it declares a singleton, repeated XML elements are rejected
 * with {@linkcode XmlCardinalityError}.
 *
 * @param xml The XML document as a string.
 * @param schema The Zod schema describing the full document, including the
 * root element name as a top-level object key.
 * @param options Optional overrides for the underlying XML parser.
 * @returns The validated document, typed as `z.output` of the schema.
 *
 * @throws {XmlSyntaxError} when `xml` is not well-formed.
 * @throws {XmlCardinalityError} when element repetition contradicts the
 * schema's declared cardinality.
 * @throws {XmlSchemaError} when the normalized document fails Zod
 * validation; the original `ZodError` is available as `error.cause`.
 *
 * @example
 * ```ts
 * const schema = z.object({
 *   catalog: z.object({
 *     book: z.array(z.object({ title: z.string() })),
 *   }),
 * });
 * const result = parseXml(
 *   "<catalog><book><title>Dune</title></book></catalog>",
 *   schema,
 * );
 * // result.catalog.book is always an array, even with one <book>.
 * ```
 */
export function parseXml<S extends z.ZodType>(
  xml: string,
  schema: S,
  options?: ParseXmlOptions,
): z.output<S> {
  const document = parseXmlDocument(xml, options?.parser);
  const normalized = normalizeXml(document, schema);
  const result = schema.safeParse(normalized);
  if (!result.success) {
    throw new XmlSchemaError(
      `XML did not match the provided schema.\n${
        z.prettifyError(result.error)
      }`,
      { cause: result.error },
    );
  }
  return result.data;
}

/**
 * Like {@linkcode parseXml}, but returns a discriminated result instead of
 * throwing.
 *
 * Every failure mode of the library — syntax, cardinality, and schema
 * validation — is returned as `{ success: false, error }` where `error` is
 * an {@linkcode XmlodError} subclass. Errors that do not originate from
 * Xmlod (e.g. a throwing custom refinement) are re-thrown.
 */
export function safeParseXml<S extends z.ZodType>(
  xml: string,
  schema: S,
  options?: ParseXmlOptions,
): XmlSafeParseResult<z.output<S>> {
  try {
    return { success: true, data: parseXml(xml, schema, options) };
  } catch (error) {
    if (error instanceof XmlodError) {
      return { success: false, error };
    }
    throw error;
  }
}

/**
 * A reusable XML parser with a fixed configuration, created by
 * {@linkcode createXmlParser}.
 */
export interface XmlodParser {
  /** Parses and validates like {@linkcode parseXml}, using the configured options. */
  parse<S extends z.ZodType>(xml: string, schema: S): z.output<S>;
  /** Parses and validates like {@linkcode safeParseXml}, using the configured options. */
  safeParse<S extends z.ZodType>(
    xml: string,
    schema: S,
  ): XmlSafeParseResult<z.output<S>>;
}

/**
 * Creates a reusable parser with the given options applied to every call.
 *
 * @example
 * ```ts
 * const parser = createXmlParser({ parser: { attributeNamePrefix: "@" } });
 * const result = parser.parse(xml, schema);
 * const safeResult = parser.safeParse(xml, schema);
 * ```
 */
export function createXmlParser(options: ParseXmlOptions = {}): XmlodParser {
  return {
    parse<S extends z.ZodType>(xml: string, schema: S): z.output<S> {
      return parseXml(xml, schema, options);
    },
    safeParse<S extends z.ZodType>(
      xml: string,
      schema: S,
    ): XmlSafeParseResult<z.output<S>> {
      return safeParseXml(xml, schema, options);
    },
  };
}
