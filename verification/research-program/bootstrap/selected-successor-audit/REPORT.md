# PR085 selected successor input audit

Audit timestamp: `2026-09-11T03:46:23.940169Z`. Review head: `9c8cba903d296238e145d331512f2a63583278bf` (tree `3b1378e7c9981f92f501edead1e4501f244b4703`). PR085 final component checked: `4f90157108a92ce9541c340d5536eac31f24a1d8` (tree `ba468220ab24bb560d2f8fb6bac83aa94ee61070`). No repository, network, provider, approval, or runtime writes were performed.

## Selection coverage

`discoverVerificationSuites()` source is `scripts/run-contract-suites.mjs`, SHA256 `9cc9efb8f29bf6a9ba93fe619e7fd1d0e519fce5cb0f37bf8747f199611cb647`, and the retained discovery artifact is `/mnt/d/tmp/plumbob/ushso-research-program-20260910/selected-successor-input-audit/discovered-suites.json` (SHA256 `a3dbf741b8fd400001971b2f7fc81ea6c7a5a1cb892718739c9139ab69ea540d`). It reports and this audit replays **20 definitions / 20 selected suites**.

| Alias | Version | Audit class | Successor/current-evidence disposition |
| --- | --- | --- | --- |
| `feedback` | `1.0.0` | `feedback/baseline` | No successor approval/current-evidence route; source-copy validator. |
| `evaluator-bridge` | `1.0.0` | `evaluator/bridge` | Bridge receipt and algorithm/corpus pins; no generic successor approval helper. |
| `evaluator-v2` | `2.1.0` | `evaluator/metric` | Metric evaluator package; no generic successor approval helper. |
| `external-authorization` | `1.1.0` | `authorization/register` | Versioned authorization register; AUTH-10 is historical and expired as of audit date. |
| `program-verification` | `1.0.0` | `program/ledger` | Aggregate implementation ledger; includes two stale raw file pins recorded below. |
| `ci-verification` | `1.4.0` | `strict-successor/current-adapter` | CI v1.4 draft/validator has direct current-input transition and pending approval semantics. |
| `wp0` | `1.4.0` | `strict-successor/historical-approval` | Historical v1.4 approval is subject-bound; current 9c lock and runner drift from approved evidence. |
| `wp10a` | `1.0.0` | `freeze/governance` | Technical freeze/owner packet; no generic successor approval helper. |
| `wp11` | `1.3.0` | `strict-successor/historical-approval` | Historical v1.3 approval is subject-bound; current 9c lock drift and stale subject remain. |
| `wp12` | `1.1.0` | `activation/package-tests` | Activation package tests only; no strict successor approval/current-evidence helper. |
| `wp13` | `1.0.0` | `candidate-validation` | Protected local candidate with pending artifact seal; no strict successor approval helper. |
| `wp14` | `1.1.0` | `strict-successor/direct-local-fixture` | Direct attestation verifier; local fixture scope and release/production false. |
| `wp2` | `1.0.0` | `aggregate-contract-verification` | Ten package pins and receipts; read-only aggregate validation, no generic successor helper. |
| `wp3` | `1.0.0` | `foundation/local-infra` | Database/control-plane foundation fixtures and receipts; no generic successor helper. |
| `wp4` | `1.0.0` | `control-plane/local-fixtures` | Scheduler/workflow fixtures and receipts; no generic successor helper. |
| `wp5` | `1.0.0` | `connector/evidence-ledger` | Connector evidence ledger and semantic mapping digest; no generic successor helper. |
| `wp6` | `1.0.0` | `normalization/local-verification` | Normalization/legacy import verification; no generic successor helper. |
| `wp7` | `1.0.0` | `identity/local-verification` | Identity/family/access verification; no generic successor helper. |
| `wp8` | `1.2.0` | `governed-metric-successor` | Approved scoped development metric successor; release and production remain false. |
| `wp9` | `1.0.0` | `coverage/local-verification` | Coverage accounting and implementation manifest; no generic successor helper. |

The strict successor/current-evidence paths selected by this source are WP0 v1.4, WP11 v1.3, CI v1.4 and WP14 v1.1. WP8 v1.2 is a governed development metric successor with scoped approval but no generic strict successor-support subject route. WP12 and WP13 are activation/candidate packages and have no strict successor approval helper. External authorization v1.1 is a register delta, not a successor approval.

## Exact findings

Package descriptors: `20` checked, `0` mismatches. Bridge, WP2 and WP9 manifests, feedback source copies, WP7 manifest byte binding and WP2's ten package references were checked; see `selected-pin-audit.json` for every row.

| Package/path | Historical or reviewed pin | 9c actual | Finding |
| --- | --- | --- | --- |
| WP0 `package-lock.json` | 134190 / `af2070ae111bc67c397b07e33b44c1fbd15bba31b63210990068943998e1bc28` | 134511 / `37e4a9ec1fba9ab254aa7a596e1a0e3f73919cf5358717dc6e06e0478be6b20c` | Approved v1.4 technical evidence pin differs. |
| WP0 `scripts/run-contract-suites.mjs` | 23034 / `acfa8900758bbba0f72e0c1bb0374b6f1b55e6b40d4a8b254218b60e5c41b596` | 26687 / `9cc9efb8f29bf6a9ba93fe619e7fd1d0e519fce5cb0f37bf8747f199611cb647` | Approved v1.4 technical evidence pin differs; current runner is the 9c route. |
| WP11 `package-lock.json` | 134190 / `af2070ae111bc67c397b07e33b44c1fbd15bba31b63210990068943998e1bc28` | 134511 / `37e4a9ec1fba9ab254aa7a596e1a0e3f73919cf5358717dc6e06e0478be6b20c` | Approved v1.3 technical evidence pin differs; historical approval remains subject-bound. |
| CI v1.4 `package.json` | Reviewed PR003 current 3666 / `b6c3469c7b10ecb90114199c18c3ebb293d801b8c8a3521cb25ded2fdba8d05e` | 9c historical 3555 / `25874c7d9464210794bd7a1467b117ef5fc71808fdf5e34726ea65181744561c` | 9c does not satisfy current transition; d1c supplies exact reviewed pair. |
| CI v1.4 `tests/contract-package-inventory.test.mjs` | Reviewed PR003 current 7842 / `5ab3deb8457c1a66fc313011bb0d96039c90f5ae35e1e08a9d34c9ab24d6c24b` | 9c historical 7809 / `2bdf766d6c69875160330d8bdf44fbd8d21bbfec43a9b7671c9d233e3ddc4bfa` | Atomic reviewed pair is required. |
| Program ledger WP5 evidence raw file | declared `79c65318902cf8e6c9bcd208e0947b24131a9577581d31ae966a00775aa631b8` | actual `74fd2fd92ddcbd85841e7b81c4ad6ae08c420bdfd9d37feda93059dba0bab2e5` | Stale cross-package raw file SHA field. |
| Program ledger WP11 evidence raw file | declared `2046f965174fabe3e4db2258a092e03605e3b325d91ed42678dcc4f8e5215fcc` | actual `0e75b70dc65c3b05a324d34cbe55bb90d6a7f5b7f90bc810a0770a3a44dabf60` | Stale cross-package raw file SHA field; canonical `receipt_sha256` is a separate digest algorithm. |

WP14 direct local-fixture attestation pins all passed against the f264 authorized source and 9c successor copies, including the three historical receipt files. Its policy explicitly disallows release/deployment/provider/production actions. WP8 metric contract and predecessor receipt pins passed; release gate, release-ready and production eligibility remain false. AUTH-10's parent hash passed, but its `2026-09-04T16:00:00Z` expiry is elapsed on the audit date and must remain historical.

## Prospective composition

Measured PR003 final component: `d1c42eab33e1c21edf805036464f2b64667a489a` (tree `d765aa66a6bc360a3c03a86eaf54b6366ccb2be1`), with root package `b6c3469c…`, lock `af2070ae…`, runner `acfa8900…`, and inventory test `5ab3deb8…`. The requested `0b28…` object was not present in either checked local object store; the supplied equivalence to d1c is recorded in `composition-inputs.json` without treating it as an independently dereferenced object.

PR004 component `323dfe54c88322369f417c7fde22597b9ab57d75` (tree `abfa7c2fd860e35c01ee11902696b015d02f6981`) contributes the exact normalization/coverage paths listed in `composition-inputs.json`; root package remains historical `25874c7d…`, and its lock remains `af2070ae…`. PR003 and PR004 are sibling components from merge-base e5c, so final integration must reconcile their root package/lock/runner/inventory and retain PR085's CI v1.4 package/route.

Safe bounded follow-up is limited to read-only technical checks after composition: verify the exact root input pair/runner/inventory, run direct package validators for WP14/WP8/WP12/WP13 as appropriate, and preserve current pending/stale outcomes. Do not invoke issue/approval receipt writers, repin historical evidence, bypass stale subjects, or infer release qualification. The broad release gate remains a separate controller-owned check.

## Evidence and limits

Artifacts: `/mnt/d/tmp/plumbob/ushso-research-program-20260910/selected-successor-input-audit/composition-inputs.json` (31238 bytes, SHA256 `38d29f8647f8563d7ecbe71a8350f5f60a2240472594f0a1176beb35895872ef`); `/mnt/d/tmp/plumbob/ushso-research-program-20260910/selected-successor-input-audit/selected-pin-audit.json` (63109 bytes, SHA256 `aad7c7d6b969d94f54d93eaf5226be7d16774f4a46c4570d356aceda46cad3b1`). Existing WP11 diagnosis retained at `/mnt/d/tmp/plumbob/ushso-research-program-20260910/pr085-wp11-diagnosis/receipt.json` (SHA256 `8cf7713fe03a601e7e2135a390a57eace872c1deb01b7c48ffb2eea221ae91d7`).

This is a static Git-byte/source audit. It does not claim package execution, hosted/runtime identity, provider qualification, scientific validity, current authorization, approval, or release readiness.
