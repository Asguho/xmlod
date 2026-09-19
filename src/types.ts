/**
 * Public option and result types for Schema XML.
 *
 * @module
 */

import type { X2jOptions } from "fast-xml-parser";
import type { SchemaXmlError } from "./errors.ts";

/**
 * Options forwarded to the underlying XML parser (`fast-xml-parser`'s
 * `XMLParser`). Any option given here is merged over Schema XML's defaults:
 *
 * ```ts
 * {
 *   ignoreAttributes: false,
 *   attributeNamePrefix: "@_",
 *   parseTagValue: false,
 *   parseAttributeValue: false,
 *   trimValues: true,
 * }
 * ```
 *
 * Schema XML disables the parser's primitive coercion by default so that Zod
 * (e.g. `z.coerce.number()`) remains the single source of truth for value
 * types.
 */
export type XmlParserOptions = Partial<X2jOptions>;

/**
 * Options accepted by {@linkcode parseXml}, {@linkcode safeParseXml}, and
 * {@linkcode createXmlParser}.
 */
export interface ParseXmlOptions {
  /** Overrides for the underlying XML parser configuration. */
  readonly parser?: XmlParserOptions;
}

/**
 * The result of {@linkcode safeParseXml}: either the parsed and validated
 * data, or the {@linkcode SchemaXmlError} describing why parsing failed.
 */
export type XmlSafeParseResult<T> =
  | { readonly success: true; readonly data: T; readonly error?: undefined }
  | {
    readonly success: false;
    readonly data?: undefined;
    readonly error: SchemaXmlError;
  };
