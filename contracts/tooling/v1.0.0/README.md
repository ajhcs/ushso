# USHSO contract tooling v1.0.0

This immutable package is the shared validation boundary for USHSO contract packages. It is offline, performs no source fetches, and does not execute analyses. It provides strict I-JSON parsing, RFC 8785 JSON Canonicalization Scheme serialization, typed SHA-256 digest domains, an Ajv 2020-12 schema registry, deterministic package inventories, fixture execution, graph checks, evidence-pointer resolution, and public-schema resource-bound audits.

## Stable module surface

Import from `src/index.mjs` or a package export. The digest API deliberately names each domain:

- `byteSha256(value)` hashes exact bytes.
- `canonicalSha256(value)` hashes RFC 8785 canonical JSON bytes.
- `jsonlSetSha256(value)` hashes an order-independent, duplicate-free JSONL set using explicit count and byte-length framing.
- `packageContentSha256(entries)` hashes the deterministic package inventory projection.

Every digest is a typed `{digest_type, algorithm, value}` object. Callers must not collapse these domains into a generic manifest hash label.

`parseStrictJson` rejects byte-order marks, duplicate decoded keys (including escaped aliases), non-finite numbers, malformed Unicode, excessive depth/size, and trailing input. `canonicalizeJson` preserves array order and rejects values outside the I-JSON/JCS domain.

`createSchemaRegistry` requires the exact Ajv and Node pins in `contracts/dependency-pin.json`, registers only the enumerated formats, always loads the tooling meta-contracts, compiles caller-supplied Draft 2020-12 schema directories in strict mode, and rejects unknown keywords and formats. Downstream packages can use `runFixtureManifest`, `topologicalSort`, `assertEvidenceClaims`, and `assertPublicSchemaBounds` without importing package-private CLI code.

## Offline verification

From this directory:

```sh
npm run manifest
npm run receipt
npm test
npm run validate
```

The package manifest excludes itself and the validation receipt to prevent self-referential hashes. It inventories every other regular file, rejects symlinks, records exact-byte and applicable semantic digests, and seals a separate `package_content_digest`. The validation receipt binds the exact manifest bytes, the package content digest, and the canonical fixture-manifest digest.

Fixtures under `fixtures/` contain only synthetic contract metadata and adversarial inputs. No authoritative-source payloads, credentials, healthcare rows, or network requests are used.
