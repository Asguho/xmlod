# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-19

### Added

- Initial release.
- `parseXml()` — schema-first XML parsing where the Zod schema decides whether
  repeated elements are arrays or singletons.
- `safeParseXml()` — non-throwing variant returning a discriminated result.
- `createXmlParser()` — reusable parser with a fixed configuration.
- `normalizeXml()` and `resolveCardinality()` — the cardinality normalization
  and schema classification primitives, exported for advanced use.
- Error hierarchy: `XmlodError`, `XmlSyntaxError`, `XmlCardinalityError` (with
  `path`, `expected`, and `receivedCount`), and `XmlSchemaError` (wrapping the
  underlying `ZodError` as `cause`).
- Cardinality normalization that looks through `optional`, `nullable`,
  `default`, `prefault`, `catch`, `readonly`, `nonoptional`, and `lazy`
  wrappers, and classifies pipes (including `.transform()`) by their input side.
- Conservative pass-through for ambiguous structural schemas (unions,
  discriminated unions, intersections, tuples, records, maps, sets).
