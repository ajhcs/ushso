# Qualified research PDF runtime

Research PDF processing requires Python 3.11 or newer, a task-local virtual environment, and exactly pypdf 6.18.0. Never install into system Python. On Plumbob, verify `/mnt/d` with `with-dev-storage` before creating the environment; keep it outside the repository. Example (replace the task directory with your allocated scratch path):

```sh
/home/plumbob/bin/with-dev-storage python3 -m venv /mnt/d/tmp/plumbob/ushso-research-python
/home/plumbob/bin/with-dev-storage /mnt/d/tmp/plumbob/ushso-research-python/bin/python -m pip --isolated install --index-url https://pypi.org/simple --disable-pip-version-check --no-cache-dir --only-binary=:all: --no-deps --require-hashes -r scripts/research/requirements.txt
/mnt/d/tmp/plumbob/ushso-research-python/bin/python -m pip --no-cache-dir check
export USHSO_RESEARCH_PYTHON=/mnt/d/tmp/plumbob/ushso-research-python/bin/python
```

All PDF collectors and CMS review replay require this explicit absolute executable; no PATH fallback is permitted. They pass `-I` to isolate Python imports from user site packages and `PYTHONPATH`. All three PDF entry scripts independently check the exact qualified pypdf version and apply address-space/CPU limits before parsing. These subprocess limits do not create a network or filesystem sandbox.

The pinned wheel hash is from public PyPI release metadata. No extras are needed for public, unencrypted text dictionaries; encrypted PDFs remain unavailable. Python below 3.11 requires additional dependency qualification and is outside this setup.

Do not overwrite historical extraction receipts. pypdf upgrades can change layout/geometry even when extracted dictionary rows remain identical. Re-extract into a new evidence directory, compare all parsed fields and typed outcomes, and rebind geometry hashes to exact PDF bytes before packaging proposed dictionaries. Scientific approval remains separate.

Grid and first-page layout collectors create a fresh timestamped output by default and refuse an existing output directory. Set `USHSO_RESEARCH_OUTPUT_DIR` to a new absolute task-scratch directory for reproducible naming, and use the same value with the layout binding validator. The output parent must already exist. Input captures stay separate and historical outputs are not overwritten.

Qualification performed with CPython 3.12.3 on Linux: all 137 cached public CMS dictionary PDFs reprocessed under pypdf6.18.0; 633 parsed rows unchanged, 49 unsupported PDFs have changed raw geometry, one PDF remains over the page limit. The old parser's layout formatting is not generally byte-identical. See the task's `pypdf-parity-v2.json` and `pypdf-representative.json` evidence.
