# Accepted component integration

PR-003, PR-004 and PR-085 were independently accepted and merged through [PR #18](https://github.com/ajhcs/ushso/pull/18). The accepted combined head is `463f092f71c0ed1ef2aa5baa29b186e5697d04ce`; its tree `906a465404ce2ba167041f36a8474bcdd2a0f40a` is also the tree of integration merge `548edf64c20f474d6832996ce5ac29e0ff25be0b`.

Both jobs in [GitHub CI run 34601400314](https://github.com/ajhcs/ushso/actions/runs/34601400314) checked out `18ec956a31976e737b9b217f51a20016bf155983`. Their losslessly compressed checkout logs and GitHub commit parents establish the same source tree as the passing local release gate.

`index.json` maps retained execution-host paths to portable artifacts and binds every byte with SHA-256. The complete 21,848,362-byte local gate receipt is stored losslessly as `local-gate.json.gz`; standard Python `gzip` or `gzip -dc` can read it. Its decoded hash is `9a253b65dea72873d318fbc45a6b7e7e8fd72e2e358685cf513523672c70c200`. The complete decoded receipt and both hosted job logs were scanned before publication. The only gate scan finding is the independently recomputed candidate identity, documented in the retained disposition.

The per-component integration handoffs and manifests bind the actual merged implementation. GitHub reports each component's earlier composition merge separately from the final integration merge; neither an earlier failing gate nor that earlier commit alone qualifies the final integration.

Current WP0, CI and WP11 successor approvals remain pending PR-082. All R01–R16 requirements remain unaccepted; this evidence establishes component integration, not research fitness, production deployment, participant testing or sustained operation.

The two hosted job logs also use lossless `.log.gz` transport, preserving their original trailing whitespace and decoded hashes. The initial text-copy formatting rejection is retained locally; no source check was rerun or weakened.
