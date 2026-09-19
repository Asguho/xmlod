/**
 * Error hierarchy for Schema XML.
 *
 * All errors thrown by Schema XML extend {@linkcode SchemaXmlError}, so a single
 * `instanceof SchemaXmlError` check catches every failure mode of the library.
 *
 * @module
 */

/**
 * A path into the parsed XML document: object keys for elements and
 * attributes, numeric indexes for positions within repeated elements.
 */
export type XmlPath = ReadonlyArray<string | number>;

/**
 * Formats an {@linkcode XmlPath} as a human-readable string, e.g.
 * `["catalog", "book", 1, "title"]` becomes `catalog.book[1].title`.
 * An empty path is rendered as `(root)`.
 */
export function formatPath(path: XmlPath): string {
  if (path.length === 0) {
    return "(root)";
  }
  let formatted = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      formatted += `[${segment}]`;
    } else {
      formatted += formatted === "" ? segment : `.${segment}`;
    }
  }
  return formatted;
}

/**
 * Base class for all errors thrown by Schema XML.
 */
export class SchemaXmlError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SchemaXmlError";
  }
}

/**
 * Thrown when the input string is not well-formed XML.
 *
 * The underlying parser error is preserved as {@linkcode Error.cause}.
 */
export class XmlSyntaxError extends SchemaXmlError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "XmlSyntaxError";
  }
}

/**
 * Details describing a cardinality mismatch between the XML document and the
 * Zod schema.
 */
export interface XmlCardinalityErrorDetails {
  /** Path to the offending value within the parsed document. */
  readonly path: XmlPath;
  /** The cardinality the schema expects at {@linkcode path}. */
  readonly expected: "singleton" | "array";
  /** How many XML elements were actually found at {@linkcode path}. */
  readonly receivedCount: number;
}

function cardinalityMessage(details: XmlCardinalityErrorDetails): string {
  const at = formatPath(details.path);
  if (details.expected === "singleton") {
    return `Expected one XML element at ${at}, but found ` +
      `${details.receivedCount}. Use z.array(...) if repetition is allowed.`;
  }
  return `Expected repeated XML elements at ${at}, but found ` +
    `${details.receivedCount}.`;
}

/**
 * Thrown when the number of repeated XML elements contradicts the cardinality
 * declared by the Zod schema — for example, two sibling elements with the
 * same name where the schema expects a singleton.
 */
export class XmlCardinalityError extends SchemaXmlError {
  /** Path to the offending value within the parsed document. */
  readonly path: Array<string | number>;
  /** The cardinality the schema expects at {@linkcode path}. */
  readonly expected: "singleton" | "array";
  /** How many XML elements were actually found at {@linkcode path}. */
  readonly receivedCount: number;

  constructor(details: XmlCardinalityErrorDetails, options?: ErrorOptions) {
    super(cardinalityMessage(details), options);
    this.name = "XmlCardinalityError";
    this.path = [...details.path];
    this.expected = details.expected;
    this.receivedCount = details.receivedCount;
  }
}

/**
 * Thrown when the normalized document fails Zod validation.
 *
 * The original `ZodError` is preserved as {@linkcode Error.cause}.
 */
export class XmlSchemaError extends SchemaXmlError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "XmlSchemaError";
  }
}
