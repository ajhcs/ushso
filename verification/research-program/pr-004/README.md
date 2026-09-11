# PR-004 completeness artifact packaging

The logical completeness view is unchanged: `ushso.completeness-view.v1.0.0` compact-v1 with 3,434 records, 3,430 searchable records, four isolated records, 13,736 field cells, and 25 metrics. The current tree stores a deterministic gzip transport and a small inspectable manifest instead of the 49,808,256-byte JSON.

Do not write `completeness-view.json` into this directory. Decode in memory, or write a uniquely created `$TMPDIR` fixture that is deleted afterwards.

## Identities

| Layer | Path or snapshot | Bytes | SHA-256 |
| --- | --- | --- | --- |
| Transport | `completeness-view.json.gz` | see manifest | see manifest |
| Decoded JSON | memory only | 49808256 | `47be5a2e5bb63a0bb3effa78977abaa653882156f2057c57efe40f7aa65d8a74` |
| Original Git snapshot | `323dfe54c88322369f417c7fde22597b9ab57d75:verification/research-program/pr-004/completeness-view.json` | 49808256 | `47be5a2e5bb63a0bb3effa78977abaa653882156f2057c57efe40f7aa65d8a74` |

The committed compressor is Node `zlib.gzipSync` at level 9 with gzip header `mtime=0`, `os=3`, `xfl=2`. A controller Python `gzip.compress(..., mtime=0)` feasibility measurement of 1,958,909 bytes is not the committed packaging; both encodings decode to the same logical bytes.

## Offline consumption

Bounded Node loader and verifier (preferred):

```bash
node verification/research-program/pr-004/verify.mjs
```

```bash
node --input-type=module -e 'import { loadPackagedCompletenessView } from "./verification/research-program/pr-004/completeness-view-packaging.mjs"; const loaded = await loadPackagedCompletenessView({ root: process.cwd() }); console.log({ transport: loaded.manifest.transport, decoded_bytes: loaded.decoded.length, artifact_id: loaded.view.artifact_id });'
```

`gzip(1)` may hash the decoded payload outside the working tree:

```bash
gzip -dc verification/research-program/pr-004/completeness-view.json.gz | sha256sum
```

The packaging module is Node-specific and is not part of the browser-compatible coverage API. Consumer semantics after decoding remain the existing completeness-view schema and offline consumer.
