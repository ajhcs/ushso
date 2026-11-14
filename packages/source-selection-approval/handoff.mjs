import {
  canonical,
  sha256,
  validateLedger,
  projectLedger,
} from "../source-selection/index.mjs";
import {
  digest,
  readiness,
  importReviewRecords,
  validateGenerationApproval,
} from "./index.mjs";
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
export function buildProductionHandoff({
  packet,
  baseLedger,
  records,
  ledger,
  bundle,
  rightsPolicy,
  restoreReceipt,
  retainedManifest,
  approval,
  target,
  now = new Date().toISOString(),
}) {
  const report = readiness(packet, baseLedger, records, { now });
  if (report.status !== "ready_for_generation_review")
    fail("human_readiness_blocked");
  const imported = importReviewRecords(packet, baseLedger, records, { now });
  validateLedger(ledger);
  if (digest(imported) !== digest(ledger)) fail("reviewed_ledger_mismatch");
  const expected = {
    generation_id: digest(bundle.data_manifest),
    ledger_revision: digest(ledger),
    bundle_hash: digest(bundle),
    rights_policy_hash: digest(rightsPolicy),
    target,
  };
  const m = bundle.data_manifest;
  if (
    m.accepted_ledger_revision !== expected.ledger_revision ||
    m.accepted_ledger_sha256 !== expected.ledger_revision ||
    m.rights_policy_sha256 !== expected.rights_policy_hash ||
    m.evidence_manifest_sha256 !== digest(ledger.captures) ||
    !Array.isArray(rightsPolicy.revoked_rights) ||
    canonical(
      projectLedger(ledger, expected.generation_id, {
        revokedRights: rightsPolicy.revoked_rights,
      }),
    ) !== canonical(bundle.views)
  )
    fail("generation_artifact_mismatch");
  if (
    bundle.rights_expire_at &&
    Date.parse(bundle.rights_expire_at) <= Date.parse(now)
  )
    fail("generation_rights_expired");
  const publication = restoreReceipt?.accepted_publication;
  const build = restoreReceipt?.health?.build;
  if (
    build?.state !== "identified" ||
    build.identity?.schema_version !== "ushso.runtime-build-identity.v1" ||
    build.identity.source_dirty !== false ||
    !/^[a-f0-9]{40}$/.test(build.identity.source_revision ?? "") ||
    !/^[a-f0-9]{64}$/.test(build.identity.build_id ?? "")
  )
    fail("clean_identified_restore_required");
  if (
    !restoreReceipt ||
    restoreReceipt.schema_version !== "ushso.local-restore-rehearsal.v1" ||
    restoreReceipt.status !== "PASS" ||
    restoreReceipt.inventory_after_smoke_verified !== true ||
    restoreReceipt.inventory_sha256 !== retainedManifest?.inventory_sha256 ||
    publication?.status !== "available" ||
    publication.generation_id !== expected.generation_id ||
    publication.bundle_hash !== expected.bundle_hash ||
    publication.revision !== expected.ledger_revision ||
    publication.rights_hash !== expected.rights_policy_hash ||
    digest(publication.bundle) !== expected.bundle_hash
  )
    fail("restore_receipt_mismatch");
  for (const c of ledger.captures.filter(
    (c) =>
      c.retention_mode === "bytes" &&
      !rightsPolicy.revoked_rights.includes(c.rights_id),
  ))
    if (
      !retainedManifest.files.some(
        (e) =>
          e.path === `evidence/captures/${c.artifact_ref}` &&
          e.sha256 === c.sha256,
      )
    )
      fail("restore_capture_inventory_mismatch");
  if (records.release_reviews.restore.receipt_sha256 !== digest(restoreReceipt))
    fail("restore_receipt_attestation_mismatch");
  if (approval.inventory_sha256 !== retainedManifest.inventory_sha256)
    fail("approved_application_inventory_mismatch");
  const appointment = records.operating_roles?.find(
    (r) =>
      r.person === approval?.approver &&
      r.role === approval?.role &&
      r.capabilities?.includes("release_authorization"),
  );
  if (
    !appointment ||
    appointment.accepted !== true ||
    appointment.evidence_class !== "actual_human" ||
    appointment.packet_digest !== digest(packet) ||
    !appointment.attestation_ref ||
    !appointment.capacity ||
    !appointment.contact_private_ref ||
    !Number.isFinite(Date.parse(appointment.accepted_at))
  )
    fail("release_authorizer_not_appointed");
  const completed = [
    ...records.claim_decisions,
    ...records.rights_decisions,
    ...records.release_reviews.independent_challenges,
    records.release_reviews.retrieval,
    records.release_reviews.usability,
    records.release_reviews.restore,
    records.release_reviews.operations,
  ];
  if (
    !Number.isFinite(Date.parse(approval.issued_at)) ||
    Date.parse(approval.issued_at) < Date.parse(appointment.accepted_at) ||
    completed.some(
      (r) =>
        !Number.isFinite(Date.parse(r.reviewed_at)) ||
        Date.parse(approval.issued_at) < Date.parse(r.reviewed_at),
    )
  )
    fail("release_approval_precedes_evidence");
  validateGenerationApproval(approval, expected, { now });
  return {
    schema_version: "ushso.production-handoff.v1",
    status: "approved_handoff",
    ...expected,
    packet_digest: digest(packet),
    records_digest: digest(records),
    restore_receipt_sha256: digest(restoreReceipt),
    approval_sha256: digest(approval),
    inventory_sha256: retainedManifest.inventory_sha256,
    expires_at: approval.expires_at,
    prepared_at: now,
    executed: false,
  };
}
