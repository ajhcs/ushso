# Machine-toolkit variable identity v1.2

This private package defines the additive `ushso.variable-identity.v1.2.0`
schema. It keeps publisher wire names separate from labels, concepts,
definitions, type and unit assertions, literal code values, missingness,
mapping state, provenance, and release/schema/field context. Unresolved and
ambiguous observations retain null identifiers and an explicit reason.

Run `npm run validate` to compile the schema with the pinned Ajv2020 validator.
Validation reads only the package's local schema and resolves no network or
external references. Run `npm test` for the package's positive and negative
boundary cases.

This is a private contract package. It does not register a route or WebMCP
operation, issue an attestation or release receipt, authorize publication, or
promote a variable. The frozen machine-toolkit v1.0 contracts and the bounded
v1.1 response-envelope successor remain unchanged predecessors.
