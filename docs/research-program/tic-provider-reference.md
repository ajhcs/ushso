# Payer provider references

Policy version: `ushso.payer-provider-reference.v1`.

Provider-group/reference IDs are scoped to the reporting file/version. They are not NPIs and not hospital CCNs. Equal numeric reference IDs in different files cannot be joined accidentally.

A missing referenced object yields an unresolved association; no provider group is invented from a hospital name. An NPI-bearing rate does not automatically map to a hospital CCN or a complete facility roster. Reference closure has explicit count and byte limits. Source-local reference resolution never performs an implicit cross-source identity merge.

Last-good generation remains `live-2026-09-03-85b50522b420`.
