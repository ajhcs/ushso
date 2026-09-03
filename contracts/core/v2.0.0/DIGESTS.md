# Core v2 digest contract

USHSO uses two deliberately different SHA-256 values. They are never interchangeable.

## Exact file-byte SHA-256

`file_sha256` is the lowercase hexadecimal SHA-256 of every byte stored at the named path. Whitespace, line endings, a trailing newline, byte-order marks, and object-key order all affect it. This digest verifies transport and repository provenance.

## Semantic content fingerprint

`content_fingerprint` is `sha256:` followed by the lowercase SHA-256 of the UTF-8 bytes produced by `ushso-canonical-json-v1`:

1. Parse one complete JSON value. A JSONL file is parsed as an array in line order.
2. Emit `null`, booleans, and safe integers in their shortest JSON form. Floating-point values, negative zero, non-finite numbers, and integers outside JavaScript's safe range are rejected.
3. Preserve strings byte-for-byte at the Unicode scalar-value level. No Unicode normalization is performed because source-native identifier case and spelling are evidence. Lone surrogate code units are rejected.
4. Sort every object's keys by unsigned UTF-8 byte order.
5. Preserve array order.
6. Emit no insignificant whitespace and no trailing newline.

For a truth revision, `canonical_content_fingerprint` applies that algorithm after removing only the root `canonical_content_fingerprint` member. Every other field, including history and evidence references, participates.

Two JSON files can therefore have different `file_sha256` values and the same `content_fingerprint`. Conversely, reordering an array changes the content fingerprint even if its members are otherwise identical. The executable implementation is in `tools/common.mjs`; the package validator recomputes both digest classes.
