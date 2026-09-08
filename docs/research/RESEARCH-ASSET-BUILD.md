# Building the research review assets

`npm run build` stages the catalog and the three research review packages before
building the web application. `config/research-assets.lock.json` binds the source
archive, each package manifest, every package file tree, and the catalog generation.
Builds fail if the archive is missing and cannot be fetched, or if any binding fails.

On Plumbob, use `/home/plumbob/bin/with-dev-storage npm run build`. The archive
lives in the content-addressed cache named in the lock. CI uses its own runner
scratch directory. A missing archive is downloaded from the pinned public GitHub
release URL and checked for the exact size and SHA-256 before extraction.
`USHSO_RESEARCH_ASSET_SOURCE` can select an existing copy of those same bytes.
An invalid existing archive is preserved for investigation and fails the build.

Generated assets are ignored by Git. Do not commit bulk research files, bypass
hash verification, or overwrite a historical source archive. A research update
requires a new archive and lock, regenerated Worker manifest bindings, source
review, and the complete exact-candidate release gate. The gate traverses all
136 newly qualified glyph rows and requires readable exact definitions, evidence
references, terminating pagination, and the pending-review boundary.

The packages expose publisher dictionary proposals and unresolved scientific
review material. They do not change canonical catalog facts or authorize payload
schemas, release applicability, joins, or scientific fitness. Prior extraction
failures and rejected fields remain retained evidence.

Before deployment, qualify the retained bundle against the account asset limits
and provide a shared `USHSO_CURSOR_SIGNING_KEY` through Cloudflare secrets. Never
commit that key. Deploy the retained, verified Worker and assets; do not rebuild
a different artifact after the gate.
