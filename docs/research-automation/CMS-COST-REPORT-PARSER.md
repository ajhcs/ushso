# Cost-report painted-grid parser proposal

This parser extension is review-only. It recognizes exactly `Variable Name`,
`Cost Report Worksheet Element`, and `Definition` in three adjacent, explicitly
painted publisher columns. The middle column is retained as a worksheet reference,
not reclassified as a variable label or measurement unit. Literal variable-cell
names may contain spaces; they are not normalized into guessed payload identifiers.

Continuation pages must immediately follow a qualified page, retain exactly the
same four column edges, have complete painted full-width row boundaries, and
contain no outside-grid prose or replacement header. A page failure clears
continuation state. Missing/ambiguous geometry, multiline visitor spans, zero-position
text, invalid worksheet references, and duplicate identities remain typed issues.
Every candidate row additionally requires all four vertical borders to cover its
open cell interior continuously; a union of disconnected divider segments cannot
establish ownership across a gap. The top painted horizontal border's own fill
thickness is excluded from the open interior. Text on or within a painted row or
column border is retained in a typed isolation outcome, never silently omitted.
No blank variable-name cell is assigned a name from another column. PBJ and QIES
identity decisions are unchanged. Labels/units remain null, release applicability
unresolved, and schema promotion false.

Retained public PDFs, replayed with qualified pypdf 6.18.0, produce 201 HHA rows
and 117 hospital rows. The existing corpus contains 17 hospital rows and no HHA
rows from these documents. A reviewed replacement would therefore change the CMS
review package from 37 records / 6,118 entries to 38 / 6,419—not append duplicate
hospital records. This package is separate until root integration and does not
alter canonical metadata or establish scientific approval. Full source/resource/
distribution bindings are verified by the existing derived-package adapter.

Sixteen of the 17 old hospital names match exactly. The remaining old name,
`FTE ‐ Employees on Payroll`, contains a nonbreaking space; reconstructed publisher
word spans yield `FTE ‐ Employees on Payroll` with a regular space. Both source
representations remain retained. This identity/spacing difference must appear in
the proposed replacement review; do not silently treat it as approved identity
normalization or append both as independent scientific variables.

Eleven named tests use bounded, hash-bound first-two-page public geometry fixtures
and adversarial mutations: spaced literal names, worksheet separation, changed
continuation columns, missing painted borders, malformed/multiline peer isolation,
duplicate identities, malformed document collections, and unrelated continuation
headings, interior divider gaps, and row/column boundary text. Fixtures retain source PDF/geometry hashes and publisher URLs. Parser
success means all recognized rows were extracted under this grammar, not that a
publisher definition is scientifically sufficient or a source release is applicable.
