# Releasing Schema XML

The npm package is `schema-xml`. JSR keeps `@asguho/schema-xml`. Both use the
version in `deno.json`, but publication to each registry is a separate
operation. A successful npm release does not imply that the JSR version has been
published.

## Toolchain and checks

Release CI pins Deno 2.9.6, Node.js 24.18.1, and npm 11.16.0. The packed
consumer test pins TypeScript 7.0.2 and Zod 4.4.3. Update both `ci.yml` and
`release.yml` when updating the release tools; update the defaults in
`scripts/node_consumer_test.sh` when updating consumer test versions.

The weekly/manual `compatibility.yml` workflow checks newer Deno 2.x, Node 24,
TypeScript, and Zod without changing release pins. Release checks cover the
committed source dependency lockfile and the pinned consumer versions; the
consumer install also resolves transitive dependencies allowed by their ranges.

```sh
deno task verify
deno task pack:dry
deno task pack
deno task test:node
npm publish ./dist/schema-xml.tgz --dry-run --access public
```

Packing normally requires a clean git tree. While editing locally, use
`deno pack --dry-run --allow-dirty` and `deno task pack --allow-dirty` for
package verification. CI and releases do not use that override.

`deno pack` generates JavaScript, declarations, and a manifest. It does not read
an npm `package.json`. `scripts/prepare_npm.sh` then applies
`scripts/npm-metadata.json`, preserves the source version/license, moves Zod to
`peerDependencies`, and checks the manifest, exports, README, and license. The
final npm runtime dependency list must contain only `fast-xml-parser`.

The consumer test reads the package name from the final tarball, installs that
tarball, and checks behavior and declaration inference, including negative type
assertions that catch accidental `any`. Nothing is published by these checks.

## Package identity

The npm package is `schema-xml`; the JSR package is `@asguho/schema-xml`. The
canonical repository is <https://github.com/Asguho/schema-xml>.

Version 0.3.0 completes the rebrand. Consumers upgrading from 0.2.x should use
`SchemaXmlError` as the base error and `SchemaXmlParser` as the configured
parser interface. The parsing functions and specific XML error classes are
unchanged.

Before the first JSR release under this name, create `@asguho/schema-xml` at
<https://jsr.io/new> and link `Asguho/schema-xml` in its package settings.

## Configure npm trusted publishing

Configure the trusted publisher for the existing npm package in the `schema-xml`
package settings on npm:

| Setting              | Value                       |
| -------------------- | --------------------------- |
| Provider             | GitHub Actions              |
| Organization or user | `Asguho`                    |
| Repository           | `schema-xml`                |
| Workflow filename    | `release.yml`               |
| Environment          | `npm-publish`               |
| Allowed actions      | Enable direct `npm publish` |

Create the `npm-publish` GitHub environment and restrict deployment to `main`.
Configure required reviewers if desired; merely naming an environment in YAML
does not configure approval rules. The workflow independently requires `main`.
The workflow must be pushed to the repository before it can run.

`release.yml` requests `id-token: write` and runs on a GitHub-hosted runner. It
uses OIDC, not `NPM_TOKEN`. Remove an old publishing token/secret once the
trusted publisher is configured and working. The pinned npm version exceeds the
OIDC minimum of 11.5.1. The repository URL in the artifact must match this repo
for provenance.

## Subsequent npm releases

1. Update `deno.json`'s version and `CHANGELOG.md`, then commit and push to
   `main`.
2. Wait for CI to pass.
3. Dispatch **Release to npm (manual)** on `main`, enter `publish-to-npm`, and
   provide the exact version from `deno.json`.
4. The workflow verifies, builds, tests, and publishes the same tarball with
   provenance. Release runs are serialized to avoid overlapping publication.
5. Verify the registry version and its provenance, then tag the released commit
   and add GitHub release notes.

The workflow never deprecates packages or publishes to JSR automatically.

## JSR releases

Keep `deno.json`'s name set to `@asguho/schema-xml`. From the same release
commit:

```sh
deno publish --dry-run
deno publish
```

Complete JSR authentication when prompted. Check the package page afterward. If
only one registry's release succeeds, retry the missing registry using the same
commit/version; do not rebuild a different release under an existing version.

## References

- [Deno pack](https://docs.deno.com/runtime/reference/cli/pack/)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm deprecation](https://docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions/)
- [JSR scopes](https://jsr.io/docs/scopes)
