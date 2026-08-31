import { buildCandidateSnapshot, RELEASE_GATE_PLAN_FINGERPRINT } from "./candidate-snapshot.mjs";
import { buildImplementationManifest } from "./package-integrity.mjs";
import { loadAuthorizationRegister, runFixtureRehearsal } from "./rehearsal.mjs";
import { withCanonicalDigest } from "./common.mjs";

export function buildVerificationReceipt() {
  const candidate = buildCandidateSnapshot();
  const rehearsal = runFixtureRehearsal();
  const implementation = buildImplementationManifest();
  const register = loadAuthorizationRegister();
  const authorizationIds = ["AUTH-03", "AUTH-05", "AUTH-06", "AUTH-07", "AUTH-08", "AUTH-09", "AUTH-11"];

  return withCanonicalDigest({
    schema_version: "ushso-wp14-verification-receipt.v1.0.0",
    work_package: "WP14",
    recorded_at: "2026-08-30T00:00:00.000Z",
    technical_foundation_status: "PASS_LOCAL_ZERO_TRAFFIC_FOUNDATION",
    work_package_acceptance_status: "BLOCKED_EXTERNAL_AND_PREDECESSOR_GATES",
    evidence_class: "fixture_only_local_zero_traffic",
    exact_candidate: {
      candidate_digest_sha256: candidate.candidate_digest_sha256,
      candidate_content_manifest_sha256: candidate.candidate_content_manifest_sha256,
      git_head_commit: candidate.git.head_commit,
      git_head_tree_oid: candidate.git.head_tree_oid,
      exact_candidate_tree_sealed: false,
      production_eligibility: false,
    },
    deterministic_seals: {
      candidate_envelope_sha256: candidate.candidate_digest_sha256,
      zero_traffic_rehearsal_sha256: rehearsal.receipt_sha256,
      implementation_manifest_sha256: implementation.manifest_sha256,
      release_gate_plan_fingerprint_sha256: `sha256:${RELEASE_GATE_PLAN_FINGERPRINT}`,
      wp13_seo_artifact_seal_sha256: "sha256:c823baab000811e3b7ba39d3f110b9be25203fb017d30266ca9a84ddb0d1dcd9",
    },
    release_gate: {
      authority: "local-exact-tree",
      policy_source: "detected",
      plan_fingerprint_sha256: `sha256:${RELEASE_GATE_PLAN_FINGERPRINT}`,
      exact_candidate_run_performed: false,
      status: "PLAN_ONLY_SHARED_DIRTY_TREE_NOT_A_RELEASE_CANDIDATE",
    },
    fixture_rehearsal: {
      shadow_parity_case_count: rehearsal.shadow_parity.case_count,
      shadow_parity_pass: rehearsal.shadow_parity.passed,
      connector_refresh_cycles: rehearsal.rehearsals.connector_refresh_cycle_count,
      rebuild_promote_rollback_cycles: rehearsal.rehearsals.rebuild_promote_rollback_cycle_count,
      fixture_cycles_count_toward_production_soak: false,
      generation_pointer_rollback_rehearsed: rehearsal.rehearsals.generation_pointer_rollback_rehearsed,
      worker_and_asset_rollback_rehearsed: rehearsal.rehearsals.worker_and_asset_rollback_rehearsed,
      static_fallback_rehearsed: rehearsal.rehearsals.static_fallback_rehearsed,
      pointer_changes_non_noop: rehearsal.rehearsals.pointer_changes_non_noop,
      n_minus_one_rollback_bundle_pass: rehearsal.n_minus_one.rollback_bundle_verification.ok,
      cross_version_asset_404_count: rehearsal.n_minus_one.cross_version_asset_matrix.asset_404_count,
      failure_injection_cases: rehearsal.failure_injection.case_count,
      failure_injection_pass: rehearsal.failure_injection.passed,
      final_public_traffic_percent: rehearsal.rehearsals.final_public_traffic_percent,
      final_public_backend: rehearsal.rehearsals.final_public_backend,
      runtime_jsonl_active: rehearsal.rehearsals.runtime_jsonl_active,
    },
    verification: [
      {
        command: "npm test --prefix verification/wp14/v1.0.0",
        status: "PASS",
        result: "All discovered WP14 Node tests passed; see the separately captured command receipt for the exact count.",
      },
      {
        command: "npm run verify --prefix verification/wp14/v1.0.0",
        status: "PASS",
        result: "44 deterministic package, boundary, gate, receipt, rehearsal, and no-action checks passed; 0 failed",
      },
      {
        command: "npm run validate --prefix verification/wp14/v1.0.0",
        status: "PASS",
        result: "validate aliases the non-mutating deterministic verifier",
      },
    ],
    authorization_status: Object.fromEntries(authorizationIds.map((id) => {
      const entry = register.entries.find((item) => item.id === id);
      return [id, { environment: entry.environment, status: entry.status, authorized: entry.authorized }];
    })),
    production_status: {
      deployment_performed: false,
      provider_mutation_performed: false,
      source_or_public_requests_made: 0,
      production_like_load_executed: false,
      live_shadow_executed: false,
      live_internal_canary_executed: false,
      public_cutover_executed: false,
      rollback_window_started: false,
      production_soak_started: false,
      production_soak_elapsed: false,
      qualifying_live_connector_cycles: 0,
      qualifying_live_rebuild_cycles: 0,
      managed_recovery_executed: false,
      runtime_jsonl_retired: false,
    },
    runtime_boundary: {
      worker_entry_modified_by_wp14: false,
      runtime_jsonl_modified_by_wp14: false,
      runtime_jsonl_active: true,
      pins: "verification/wp14/v1.0.0/receipts/runtime-boundary-pins.json",
    },
    residual_gates: [
      "Integrate a stable clean candidate and run the exact-candidate release gate once.",
      "Compose and review an authoritative transactional durable-store implementation; the checked-in transition tool intentionally uses only an ephemeral fixture adapter and rejects production state.",
      "Complete WP8 retrieval/final-holdout and production-like search/query-plan gates.",
      "Complete AUTH-12 planner governance, WP10B compiler, and planner release evaluation.",
      "Complete AUTH-15 coverage wording approval and relevant identity/toolkit/SEO public gates.",
      "Obtain AUTH-03 and AUTH-11 before managed staging or zero-traffic production foundation apply.",
      "Obtain AUTH-05 and perform measured isolated recovery drills.",
      "Obtain AUTH-06 before Access-protected internal canary traffic.",
      "Obtain AUTH-07 before gradual public promotion and preserve the exact N-1 rollback bundle.",
      "Obtain AUTH-08, reach 100 percent, then operate at least 30 days plus two qualifying live cycles of each required type.",
      "Obtain AUTH-09 only after the full soak receipt, then review a separate runtime JSONL removal while retaining fixtures/evaluation/audit/DR copies.",
    ],
    rollback: {
      current: "No runtime rollback is needed because WP14 made no runtime or external change.",
      bad_generation: "Atomically restore the retained exact N-1 publication pointer; do not revert canonical storage.",
      bad_worker: "Restore the prior Worker and matching asset bundle; do not claim PostgreSQL or R2 rollback.",
      database_path: "Activate the pinned immutable database-independent static artifact for every public surface.",
      migrations: "Keep additive schema; never use a destructive down migration as operational rollback.",
    },
  }, "receipt_sha256");
}
