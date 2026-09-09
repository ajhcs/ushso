# Lossless field supplements — review only

Large publisher fields are no longer omitted merely because one field exceeds the 64 KiB page budget. The normal variable list includes a named, evidence-linked stub with `field_completeness: partial`, `full_field_available: true` and a `supplement` binding. Missing properties on this stub mean deferred content, not absent publisher information. No shortened description, enum or inferred unit replaces the original field.

The existing opt-in local review endpoint accepts `field=<supplement.field_sha256>`. Keep the same record ID and generation. Continue using its signed cursor; the cursor binds record, field, generation, package manifest and expiration. Cursors cannot switch fields or return to normal variable listing. A missing field returns typed 404; malformed selectors return 400. Scientific approval and publication remain false/pending.

Each response contains one base64 fragment, its zero-based index, byte offset and decoded byte length. Fragments encode raw bytes of the original UTF-8 JSON object, and may split a multibyte character. To reconstruct:

1. Collect fragments in contiguous index order, checking offsets and lengths.
2. Base64-decode each fragment to bytes. Do not individually UTF-8-decode fragments.
3. Concatenate bytes and verify `total_bytes`, `fragment_count` and SHA-256 against `field_sha256` from the pinned stub.
4. Only then decode the concatenated bytes with strict UTF-8 decoding and parse JSON. Verify the field name matches the requested stub.

Normal `variable_count` includes full inline fields and supplement stubs. `full_field_count` counts fields available losslessly inline or through supplements; it does not assert scientific completeness. `supplemental_field_count` counts fields requiring reassembly. `isolated_field_count` remains distinct and must not be hidden by those counts.

Storage is content-addressed: trusted package manifest → record descriptor → supplement descriptor → bounded fragments. Raw fragments are at most 32 KiB and encoded JSON files at most 64 KiB; supplement descriptors are at most 256 KiB, root manifests at most 2 MiB and API responses at most 128 KiB. The Worker never loads a whole large field. Retain the `supplements/` directory when combining or copying packages, and recompute the combined manifest pin. The cursor lifetime is non-sliding; long traversals can require restarting.

Lossless transport establishes preservation of captured publisher text, not release applicability, approved observation units, measurement units, scientific fitness or deployment authorization.
