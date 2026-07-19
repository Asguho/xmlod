/**
 * # Xmlod
 *
 * Schema-first XML parsing with Zod-aware cardinality.
 *
 * XML cannot express "this element repeats" in the document itself, so XML
 * parsers guess: one `<book>` becomes an object, two become an array. Xmlod
 * makes the Zod schema the source of truth — where the schema says
 * `z.array(...)`, you always get an array; where it expects a singleton,
 * repeated elements are rejected with a descriptive error.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { parseXml } from "@your-scope/xmlod";
 *
 * const schema = z.object({
 *   catalog: z.object({
 *     book: z.array(z.object({
 *       "@_id": z.coerce.number(),
 *       title: z.string(),
 *     })),
 *   }),
 * });
 *
 * const result = parseXml(xml, schema);
 * // result.catalog.book is always an array.
 * ```
 *
 * @module
 */

export {
  createXmlParser,
  DEFAULT_PARSER_OPTIONS,
  parseXml,
  safeParseXml,
} from "./parse.ts";
export type { XmlodParser } from "./parse.ts";
export {
  formatPath,
  XmlCardinalityError,
  XmlodError,
  XmlSchemaError,
  XmlSyntaxError,
} from "./errors.ts";
export type { XmlCardinalityErrorDetails, XmlPath } from "./errors.ts";
export type {
  ParseXmlOptions,
  XmlParserOptions,
  XmlSafeParseResult,
} from "./types.ts";
