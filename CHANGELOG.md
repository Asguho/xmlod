# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-10

Alignment pass against the Zod 4 source (audited at zod 4.4.3): the `_zod.def`
introspection approach is the one Zod documents for ecosystem libraries and
stays; the gaps found in its execution are fixed.

### Added

- Tuples are now normalized: a single XML element is wrapped into a one-element
  array, items are normalized positionally, and extra items are normalized
  against the rest schema.
- Records are now normalized: every property value is normalized against the
  record's value schema, so `z.record(..., z.array(...))` wraps single
  occurrences like any array field.
- `z.success(...)` and `z.promise(...)` wrappers are looked through, since both
  validate their inner schema's input.
- A union whose branches are all singletons is classified as a singleton, so
  repetition raises a descriptive `XmlCardinalityError` instead of an opaque Zod
  failure.
- An intersection of two objects with disjoint shapes is normalized as one
  object with the merged shape (attribute group + element group pattern).

### Changed

- A cardinality mismatch under a `.catch()` wrapper no longer throws; the raw
  value is passed through so Zod applies the declared fallback, matching what
  plain Zod would do.
- `z.lazy(...)` schemas resolve through Zod's cached `_zod.innerType` instead of
  calling the getter on every visit, eliminating per-node schema reconstruction
  on recursive documents.
- The inspector's def typing now uses the `$ZodTypes` union from `zod/v4/core`
  (the documented pattern for ecosystem libraries) instead of a hand-rolled
  interface; `normalizeXml` and `resolveCardinality` accept any `$ZodType`,
  including Zod Mini schemas.
- The npm tarball declares `zod` as a `peerDependency` instead of a runtime
  dependency, so consumers always share a single zod instance with Xmlod.

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
