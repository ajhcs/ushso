# PR-007 R4 independent review

Disposition: component corrections pass independent review; actual combined gate and hosted CI remain required before integration acceptance.

Reviewed HEAD fa624903123dac858650730ee71bf7f8cb3c34ef, tree f546c3e79c04c214f9c5b51134eb75f01e21a4c1. Root read back a clean producer worktree and reviewed the complete R3-to-R4 implementation/test diff. Provider cleanup is normal/inactive_empty/unlocked; actual interface model grok-4.

All eight root commands passed on the exact final head: original14 controller cases, six refined core/Unicode cases, six relationship cases, 23 release-binding tests, 20 identity package tests, package validation, producer verifier and handoff validation. The three controller scripts total26 cases with zero failures or probe errors. The source worktree stayed clean and HEAD stayed unchanged. Receipt: pr007-controller-review/fa624903/receipt.json under /mnt/d/tmp/plumbob/ushso-research-program-20260910.

R007-9 now uses the actual frozen fingerprintTruthRevision function and returns a typed non-projection for stale or unrepresentable supplied bodies. It reports supplied/actual hashes without changing the envelope. Positive fixtures now recompute fingerprints after changing release/entity IDs; prior v2 fixture evidence remains intact with the refinement explained.

R007-10 checks nested asset/source ownership, the release list and each supplied distribution release reference before constructing context. Foreign nested source/release cases pass alongside the independent negative cases. Valid one-to-many, rolling, unresolved and null-binding controls remain usable with their existing uncertainty. Previous schema/ownership, date, source-linkage, pin and Unicode regressions remain corrected.

The existing identity package seal validates with31 files and digest1a86d04aa363dbaa34a93db0f3895a4e99a0469f437783eba0ea37fbf1be3d97. Frozen contracts and PR002 evaluation artifacts are unchanged in the correction diff. Automatic rule state remains disabled_candidate_only. The handoff's pending final head is transport provenance; this external review binds the actual committed head and does not treat pending transport as scientific acceptance.

Original logical base15b351a92af729f9ba07359fd210123fdfd76bb3, PR004 dependency463f092f71c0ed1ef2aa5baa29b186e5697d04ce and all prior commits/results remain retained. No additional implementation changes are requested from this review. Source captures and synthetic probes do not establish payload access, scientific fitness, join compatibility or a successful researcher task. Root must still compose this head with the other current components, run the applicable gate and inspect actual hosted CI. No R01–R16 acceptance, current-subject approval or deployment is claimed.
