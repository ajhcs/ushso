import { canonicalJson, sha256 } from "../../../../packages/identity/src/common.mjs";
import { buildReviewCaseIndex } from "./adjudication-packet.mjs";

export const ADJUDICATION_SUBMISSION_SCHEMA_VERSION = "identity.adjudication-submission.v1.0.0";
export const ADJUDICATION_RECORD_SCHEMA_VERSION = "identity.benchmark-adjudication.v1.0.0";
export const ADJUDICATION_RECEIPT_SCHEMA_VERSION = "identity.adjudication-validation-receipt.v1.0.0";
export const MAX_SUBMISSION_BYTES = 10 * 1024 * 1024;
export const MAX_RECORDS = 3_000;

const DECISIONS = Object.freeze(["same_identity", "not_same_identity", "needs_more_evidence"]);
const ROLES = Object.freeze(["primary", "secondary", "adjudicator"]);
const FORBIDDEN_ID_MARKER = /(?:^|[.:_-])(controlled|fixture|synthetic|test)(?:$|[.:_-])/i;
const TOP_LEVEL_KEYS = new Set([
  "schema_version",
  "submission_id",
  "packet_id",
  "reviewer_packet_byte_sha256",
  "benchmark_case_sha256",
  "reviewer_case_sha256",
  "authorization_reference",
  "authorization_receipt_id",
  "reviewer_roster",
  "records",
  "record_set_sha256",
]);
const ROSTER_KEYS = new Set([
  "schema_version",
  "reviewer_id",
  "human",
  "identified",
  "controlled_fixture",
  "identity_receipt_id",
  "independence_attestation_id",
  "assigned_roles",
  "independence_declarations",
]);
const DECLARATION_KEYS = new Set([
  "controlled_label_access",
  "peer_decision_access_before_independent_submission",
  "algorithm_output_access",
  "conflict_disclosures",
]);
const RECORD_KEYS = new Set([
  "schema_version",
  "packet_id",
  "reviewer_packet_byte_sha256",
  "review_case_id",
  "reviewer_id",
  "reviewer_identity_receipt_id",
  "independence_attestation_id",
  "review_role",
  "human",
  "decision",
  "rationale",
  "evidence_reference_ids",
  "reviewed_at",
  "review_receipt_id",
  "review_evidence_status",
]);

function issue(code, path, message) {
  return { code, path, message };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unexpectedKeys(value, allowed, path, errors) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(issue("UNEXPECTED_FIELD", `${path}.${key}`, "Field is not part of the sealed adjudication contract"));
  }
}

function requiredText(value, path, errors, { pattern = null, min = 1, max = 2_000, forbidFixtureMarker = false } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
    errors.push(issue("INVALID_TEXT", path, `Expected a string of ${min}-${max} characters${pattern ? " matching the required identifier syntax" : ""}`));
    return false;
  }
  if (forbidFixtureMarker && FORBIDDEN_ID_MARKER.test(value)) {
    errors.push(issue("CONTROLLED_FIXTURE_IDENTIFIER_FORBIDDEN", path, "Controlled, fixture, synthetic, and test identities cannot enter external-review evidence"));
    return false;
  }
  return true;
}

function validUtcTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function agreementFor(pairs) {
  if (pairs.length === 0) return { percent_agreement: null, cohens_kappa: null };
  const agreements = pairs.filter(({ primary, secondary }) => primary.decision === secondary.decision).length;
  const percentAgreement = agreements / pairs.length;
  let expectedAgreement = 0;
  for (const decision of DECISIONS) {
    const primaryRate = pairs.filter(({ primary }) => primary.decision === decision).length / pairs.length;
    const secondaryRate = pairs.filter(({ secondary }) => secondary.decision === decision).length / pairs.length;
    expectedAgreement += primaryRate * secondaryRate;
  }
  return {
    percent_agreement: percentAgreement,
    cohens_kappa: expectedAgreement === 1 ? null : (percentAgreement - expectedAgreement) / (1 - expectedAgreement),
  };
}

function validateRoster(roster, errors) {
  if (!Array.isArray(roster) || roster.length < 2 || roster.length > 50) {
    errors.push(issue("INVALID_REVIEWER_ROSTER", "reviewer_roster", "Reviewer roster must contain 2-50 identified humans"));
    return new Map();
  }
  const byId = new Map();
  const identityReceipts = new Set();
  const independenceReceipts = new Set();
  roster.forEach((entry, index) => {
    const base = `reviewer_roster[${index}]`;
    if (!isObject(entry)) {
      errors.push(issue("INVALID_REVIEWER_ENTRY", base, "Reviewer entry must be an object"));
      return;
    }
    unexpectedKeys(entry, ROSTER_KEYS, base, errors);
    if (entry.schema_version !== "identity.reviewer-roster-entry.v1.0.0") errors.push(issue("INVALID_SCHEMA_VERSION", `${base}.schema_version`, "Reviewer entry schema version is not supported"));
    requiredText(entry.reviewer_id, `${base}.reviewer_id`, errors, { pattern: /^reviewer:[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/, min: 12, max: 137, forbidFixtureMarker: true });
    requiredText(entry.identity_receipt_id, `${base}.identity_receipt_id`, errors, { pattern: /^receipt:[A-Za-z0-9][A-Za-z0-9._:-]{2,191}$/, min: 12, max: 200, forbidFixtureMarker: true });
    requiredText(entry.independence_attestation_id, `${base}.independence_attestation_id`, errors, { pattern: /^attestation:[A-Za-z0-9][A-Za-z0-9._:-]{2,187}$/, min: 16, max: 200, forbidFixtureMarker: true });
    if (entry.human !== true || entry.identified !== true || entry.controlled_fixture !== false) errors.push(issue("REVIEWER_IDENTITY_BOUNDARY_INVALID", base, "Reviewer must be an identified human and must not be a controlled fixture"));
    if (!Array.isArray(entry.assigned_roles) || entry.assigned_roles.length === 0 || entry.assigned_roles.some((role) => !ROLES.includes(role)) || new Set(entry.assigned_roles).size !== entry.assigned_roles.length) errors.push(issue("INVALID_REVIEWER_ROLES", `${base}.assigned_roles`, "Assigned roles must be a unique non-empty subset of primary, secondary, and adjudicator"));
    if (!isObject(entry.independence_declarations)) {
      errors.push(issue("INDEPENDENCE_DECLARATION_REQUIRED", `${base}.independence_declarations`, "Independence declarations are required"));
    } else {
      unexpectedKeys(entry.independence_declarations, DECLARATION_KEYS, `${base}.independence_declarations`, errors);
      const declarations = entry.independence_declarations;
      if (declarations.controlled_label_access !== false || declarations.peer_decision_access_before_independent_submission !== false || declarations.algorithm_output_access !== false || !Array.isArray(declarations.conflict_disclosures)) errors.push(issue("INDEPENDENCE_DECLARATION_INVALID", `${base}.independence_declarations`, "Reviewer must attest no controlled-label, prior peer-decision, or algorithm-output access and provide a conflict-disclosure array"));
      if (Array.isArray(declarations.conflict_disclosures) && declarations.conflict_disclosures.length > 0) errors.push(issue("REVIEWER_CONFLICT_DISCLOSED", `${base}.independence_declarations.conflict_disclosures`, "A reviewer with a disclosed conflict cannot be accepted by this import path"));
    }
    if (byId.has(entry.reviewer_id)) errors.push(issue("DUPLICATE_REVIEWER_ID", `${base}.reviewer_id`, "Reviewer IDs must be unique"));
    if (identityReceipts.has(entry.identity_receipt_id)) errors.push(issue("REUSED_IDENTITY_RECEIPT", `${base}.identity_receipt_id`, "Each identified reviewer requires a distinct identity receipt"));
    if (independenceReceipts.has(entry.independence_attestation_id)) errors.push(issue("REUSED_INDEPENDENCE_ATTESTATION", `${base}.independence_attestation_id`, "Each reviewer requires a distinct independence attestation"));
    byId.set(entry.reviewer_id, entry);
    identityReceipts.add(entry.identity_receipt_id);
    independenceReceipts.add(entry.independence_attestation_id);
  });
  return byId;
}

function validateRecords(submission, reviewCaseIndex, rosterById, errors) {
  const records = submission.records;
  if (!Array.isArray(records) || records.length > MAX_RECORDS) {
    errors.push(issue("INVALID_RECORD_SET", "records", `Records must be an array with at most ${MAX_RECORDS} entries`));
    return [];
  }
  const acceptedShape = [];
  const reviewerCaseKeys = new Set();
  const reviewReceiptIds = new Set();
  records.forEach((record, index) => {
    const base = `records[${index}]`;
    const before = errors.length;
    if (!isObject(record)) {
      errors.push(issue("INVALID_REVIEW_RECORD", base, "Review record must be an object"));
      return;
    }
    unexpectedKeys(record, RECORD_KEYS, base, errors);
    if (record.schema_version !== ADJUDICATION_RECORD_SCHEMA_VERSION) errors.push(issue("INVALID_SCHEMA_VERSION", `${base}.schema_version`, "Adjudication record schema version is not supported"));
    if (record.packet_id !== submission.packet_id || record.reviewer_packet_byte_sha256 !== submission.reviewer_packet_byte_sha256) errors.push(issue("PACKET_BINDING_MISMATCH", base, "Every review must bind to the exact packet ID and byte digest"));
    const reviewCaseEntry = reviewCaseIndex.get(record.review_case_id);
    if (!reviewCaseEntry) errors.push(issue("UNKNOWN_REVIEW_CASE", `${base}.review_case_id`, "Review case is not in the sealed blinded packet"));
    const rosterEntry = rosterById.get(record.reviewer_id);
    if (!rosterEntry) errors.push(issue("UNKNOWN_REVIEWER", `${base}.reviewer_id`, "Reviewer is not present in the identified roster"));
    if (!ROLES.includes(record.review_role) || (rosterEntry && !rosterEntry.assigned_roles.includes(record.review_role))) errors.push(issue("REVIEW_ROLE_NOT_ASSIGNED", `${base}.review_role`, "Review role is invalid or not assigned to this reviewer"));
    if (record.human !== true || record.review_evidence_status !== "externally_verified_human_review") errors.push(issue("EXTERNAL_HUMAN_EVIDENCE_REQUIRED", base, "Review must be identified as externally verified human evidence"));
    if (rosterEntry && (record.reviewer_identity_receipt_id !== rosterEntry.identity_receipt_id || record.independence_attestation_id !== rosterEntry.independence_attestation_id)) errors.push(issue("REVIEWER_RECEIPT_BINDING_MISMATCH", base, "Review identity and independence receipts must match the roster"));
    if (!DECISIONS.includes(record.decision)) errors.push(issue("INVALID_DECISION", `${base}.decision`, "Decision is not in the sealed three-value decision set"));
    requiredText(record.rationale, `${base}.rationale`, errors, { min: 20, max: 2_000 });
    if (!Array.isArray(record.evidence_reference_ids) || record.evidence_reference_ids.length === 0 || record.evidence_reference_ids.length > 50 || new Set(record.evidence_reference_ids).size !== record.evidence_reference_ids.length || record.evidence_reference_ids.some((value) => typeof value !== "string" || value.length < 3 || value.length > 200 || FORBIDDEN_ID_MARKER.test(value))) {
      errors.push(issue("INVALID_EVIDENCE_REFERENCES", `${base}.evidence_reference_ids`, "Evidence references must be unique non-fixture identifiers from the blinded packet"));
    } else if (reviewCaseEntry) {
      const allowedEvidence = new Set([
        ...reviewCaseEntry.review_case.assertions.flatMap((item) => item.evidence_refs),
      ]);
      if (record.evidence_reference_ids.some((value) => !allowedEvidence.has(value))) errors.push(issue("UNKNOWN_EVIDENCE_REFERENCE", `${base}.evidence_reference_ids`, "Every evidence reference must belong to the same blinded review case"));
    }
    if (!validUtcTimestamp(record.reviewed_at)) errors.push(issue("INVALID_REVIEW_TIME", `${base}.reviewed_at`, "Review timestamp must be an explicit UTC ISO timestamp"));
    requiredText(record.review_receipt_id, `${base}.review_receipt_id`, errors, { pattern: /^review-receipt:[A-Za-z0-9][A-Za-z0-9._:-]{2,183}$/, min: 19, max: 200, forbidFixtureMarker: true });
    const reviewerCaseKey = `${record.review_case_id}\u0000${record.reviewer_id}`;
    if (reviewerCaseKeys.has(reviewerCaseKey)) errors.push(issue("DUPLICATE_REVIEWER_CASE", base, "One reviewer may submit only one immutable decision per review case"));
    if (reviewReceiptIds.has(record.review_receipt_id)) errors.push(issue("DUPLICATE_REVIEW_RECEIPT", `${base}.review_receipt_id`, "Review receipt IDs must be unique"));
    reviewerCaseKeys.add(reviewerCaseKey);
    reviewReceiptIds.add(record.review_receipt_id);
    if (errors.length === before) acceptedShape.push(record);
  });
  return acceptedShape;
}

function compileMetrics(cases, records, errors) {
  const caseIndex = buildReviewCaseIndex(cases);
  const grouped = new Map();
  for (const record of records) {
    if (!grouped.has(record.review_case_id)) grouped.set(record.review_case_id, []);
    grouped.get(record.review_case_id).push(record);
  }
  const pairs = [];
  const finalized = new Map();
  let resolvedConflicts = 0;
  let unresolvedConflicts = 0;
  for (const [reviewCaseId, caseRecords] of grouped) {
    const byRole = new Map(ROLES.map((role) => [role, caseRecords.filter((record) => record.review_role === role)]));
    for (const role of ROLES) {
      if (byRole.get(role).length > 1) errors.push(issue("DUPLICATE_CASE_ROLE", `records:${reviewCaseId}:${role}`, `Review case may have only one ${role} reviewer`));
    }
    const primary = byRole.get("primary")[0];
    const secondary = byRole.get("secondary")[0];
    const adjudicator = byRole.get("adjudicator")[0];
    if (!primary || !secondary) {
      errors.push(issue("INCOMPLETE_DOUBLE_REVIEW", `records:${reviewCaseId}`, "Every submitted review case requires one primary and one secondary decision"));
      continue;
    }
    if (primary.reviewer_id === secondary.reviewer_id) errors.push(issue("REVIEWERS_NOT_DISTINCT", `records:${reviewCaseId}`, "Primary and secondary reviewers must be distinct identified humans"));
    pairs.push({ review_case_id: reviewCaseId, primary, secondary });
    if (primary.decision === secondary.decision) {
      if (adjudicator) errors.push(issue("UNNECESSARY_ADJUDICATOR", `records:${reviewCaseId}`, "A third adjudicator is accepted only for a sealed primary/secondary conflict"));
      finalized.set(reviewCaseId, primary.decision);
      continue;
    }
    if (!adjudicator) {
      unresolvedConflicts += 1;
      errors.push(issue("UNRESOLVED_REVIEW_CONFLICT", `records:${reviewCaseId}`, "Disagreement must remain unresolved until a third distinct adjudicator records a decision"));
      continue;
    }
    if ([primary.reviewer_id, secondary.reviewer_id].includes(adjudicator.reviewer_id)) errors.push(issue("ADJUDICATOR_NOT_DISTINCT", `records:${reviewCaseId}`, "Conflict adjudicator must be distinct from both independent reviewers"));
    resolvedConflicts += 1;
    finalized.set(reviewCaseId, adjudicator.decision);
  }

  const agreement = agreementFor(pairs);
  const requiredDoubleReview = Math.min(100, cases.length);
  if (pairs.length < requiredDoubleReview) errors.push(issue("DOUBLE_REVIEW_FLOOR_NOT_MET", "records", `At least ${requiredDoubleReview} cases must be double reviewed`));
  if (agreement.percent_agreement === null || agreement.percent_agreement < 0.9) errors.push(issue("PERCENT_AGREEMENT_FLOOR_NOT_MET", "records", "Independent double-review agreement must be at least 0.90"));
  if (agreement.cohens_kappa === null || agreement.cohens_kappa < 0.8) errors.push(issue("COHENS_KAPPA_FLOOR_NOT_MET", "records", "Cohen's kappa must be at least 0.80 and must be defined"));
  const strata = [...new Set(cases.map((item) => item.stratum_id))].sort();
  const perStratum = strata.map((stratumId) => {
    const stratumCaseIds = new Set(cases.filter((item) => item.stratum_id === stratumId).map((item) => {
      for (const [reviewCaseId, entry] of caseIndex) if (entry.source_case.benchmark_case_id === item.benchmark_case_id) return reviewCaseId;
      return null;
    }));
    const stratumPairs = pairs.filter((pair) => stratumCaseIds.has(pair.review_case_id));
    const stratumFinal = [...finalized.entries()].filter(([reviewCaseId]) => stratumCaseIds.has(reviewCaseId));
    const sourceFor = (reviewCaseId) => caseIndex.get(reviewCaseId)?.source_case;
    const stratumAgreement = agreementFor(stratumPairs);
    const categoryDoubleReviewed = Object.fromEntries(["positive", "hard_negative", "temporal_reuse_conflict"].map((category) => [
      category,
      stratumPairs.filter((pair) => sourceFor(pair.review_case_id)?.category === category).length,
    ]));
    if (stratumPairs.length > 0 && Object.values(categoryDoubleReviewed).some((count) => count === 0)) errors.push(issue("STRATIFIED_SAMPLE_CATEGORY_MISSING", `records:${stratumId}`, "Every represented stratum must include each sealed case category in the double-review sample"));
    return {
      stratum_id: stratumId,
      eligible_cases: cases.filter((item) => item.stratum_id === stratumId).length,
      double_reviewed_cases: stratumPairs.length,
      double_reviewed_by_sealed_case_class: categoryDoubleReviewed,
      finalized_cases: stratumFinal.length,
      adjudicated_positive_pairs: stratumFinal.filter(([reviewCaseId, decision]) => sourceFor(reviewCaseId)?.category === "positive" && decision === "same_identity").length,
      adjudicated_hard_negative_pairs: stratumFinal.filter(([reviewCaseId, decision]) => sourceFor(reviewCaseId)?.category === "hard_negative" && decision === "not_same_identity").length,
      adjudicated_temporal_reuse_conflict_cases: stratumFinal.filter(([reviewCaseId]) => sourceFor(reviewCaseId)?.category === "temporal_reuse_conflict").length,
      decisions: Object.fromEntries(DECISIONS.map((decision) => [decision, stratumFinal.filter(([, value]) => value === decision).length])),
      percent_agreement: stratumAgreement.percent_agreement,
      cohens_kappa: stratumAgreement.cohens_kappa,
    };
  });
  if (pairs.length > 0 && perStratum.some((item) => item.double_reviewed_cases === 0)) errors.push(issue("STRATIFIED_SAMPLE_STRATUM_MISSING", "records", "The audited double-review sample must represent every launch-critical stratum"));

  return {
    eligible_cases: cases.length,
    required_double_reviewed_cases: requiredDoubleReview,
    submitted_review_records: records.length,
    distinct_reviewers: new Set(records.map((item) => item.reviewer_id)).size,
    double_reviewed_cases: pairs.length,
    finalized_cases: finalized.size,
    review_pending_cases: cases.length - finalized.size,
    review_pending_rate: ratio(cases.length - finalized.size, cases.length),
    unresolved_conflicts: unresolvedConflicts,
    resolved_conflicts: resolvedConflicts,
    percent_agreement: agreement.percent_agreement,
    cohens_kappa: agreement.cohens_kappa,
    per_stratum: perStratum,
  };
}

function authorizationState(authorizationEntry, submission, packet, errors) {
  const expected = authorizationEntry?.id === "AUTH-14" && authorizationEntry.environment === "identity_evaluation_governance";
  if (!expected) {
    errors.push(issue("AUTHORIZATION_REGISTER_ENTRY_INVALID", "authorization", "AUTH-14 identity-evaluation boundary is missing or malformed"));
    return { authorized: false, status: "invalid_register_entry" };
  }
  if (authorizationEntry.status === "not_requested" && authorizationEntry.authorized === false) {
    errors.push(issue("AUTHORIZATION_REQUIRED", "authorization", "AUTH-14 records a future authorization/coordination boundary only; review or import is not authorized"));
    return { authorized: false, status: "pending_external_authorization" };
  }
  const explicitReceipt = typeof authorizationEntry.authorization_receipt_id === "string" && authorizationEntry.authorization_receipt_id.length >= 3;
  const authorized = authorizationEntry.authorized === true && authorizationEntry.status === "authorized" && explicitReceipt;
  if (!authorized || submission.authorization_receipt_id !== authorizationEntry.authorization_receipt_id) {
    errors.push(issue("EXPLICIT_AUTHORIZATION_RECEIPT_REQUIRED", "authorization", "An authorized AUTH-14 entry and matching explicit authorization receipt are required"));
    return { authorized: false, status: "authorization_receipt_invalid" };
  }
  if (packet.authorization_boundary?.authorized !== true || packet.authorization_boundary?.authorization_receipt_id !== authorizationEntry.authorization_receipt_id) {
    errors.push(issue("PACKET_REISSUANCE_REQUIRED", "packet", "The reviewer packet must be reissued and resealed after explicit authorization"));
    return { authorized: false, status: "packet_reissuance_required" };
  }
  return { authorized: true, status: "authorized" };
}

export function validateAdjudicationSubmission({ submission, cases, packet, packetByteSha256, authorizationEntry }) {
  const errors = [];
  if (!isObject(submission)) return { status: "invalid", ready_for_import: false, errors: [issue("INVALID_SUBMISSION", "$", "Submission must be an object")], metrics: null, validation_receipt: null };
  unexpectedKeys(submission, TOP_LEVEL_KEYS, "$", errors);
  if (submission.schema_version !== ADJUDICATION_SUBMISSION_SCHEMA_VERSION) errors.push(issue("INVALID_SCHEMA_VERSION", "schema_version", "Submission schema version is not supported"));
  requiredText(submission.submission_id, "submission_id", errors, { pattern: /^adjudication-submission:[A-Za-z0-9][A-Za-z0-9._:-]{2,175}$/, min: 25, max: 200, forbidFixtureMarker: true });
  if (submission.packet_id !== packet.packet_id || submission.reviewer_packet_byte_sha256 !== packetByteSha256) errors.push(issue("PACKET_DIGEST_MISMATCH", "packet_id", "Submission does not bind to the exact reviewer packet bytes"));
  if (submission.benchmark_case_sha256 !== packet.benchmark.case_sha256 || submission.reviewer_case_sha256 !== packet.reviewer_case_contract.case_sha256) errors.push(issue("CASE_SET_DIGEST_MISMATCH", "reviewer_case_sha256", "Submission case digests do not match the sealed packet"));
  if (submission.authorization_reference !== "AUTH-14") errors.push(issue("AUTHORIZATION_REFERENCE_INVALID", "authorization_reference", "Submission must reference AUTH-14 without treating it as authorization"));
  requiredText(submission.authorization_receipt_id, "authorization_receipt_id", errors, { min: 3, max: 200, forbidFixtureMarker: true });
  const rosterById = validateRoster(submission.reviewer_roster, errors);
  const reviewCaseIndex = buildReviewCaseIndex(cases);
  const shapeValidRecords = validateRecords(submission, reviewCaseIndex, rosterById, errors);
  const expectedRecordDigest = sha256(canonicalJson(submission.records ?? []));
  if (submission.record_set_sha256 !== expectedRecordDigest) errors.push(issue("RECORD_SET_DIGEST_MISMATCH", "record_set_sha256", "Record-set digest does not match canonical review records"));
  const metrics = compileMetrics(cases, shapeValidRecords, errors);
  const auth = authorizationState(authorizationEntry, submission, packet, errors);
  const nonAuthorizationErrors = errors.filter((item) => !["AUTHORIZATION_REQUIRED", "EXPLICIT_AUTHORIZATION_RECEIPT_REQUIRED", "PACKET_REISSUANCE_REQUIRED"].includes(item.code));
  const readyForImport = auth.authorized && errors.length === 0;
  const receiptPayload = readyForImport ? {
    schema_version: ADJUDICATION_RECEIPT_SCHEMA_VERSION,
    status: "validated_ready_for_append_only_import",
    submission_id: submission.submission_id,
    packet_id: packet.packet_id,
    reviewer_packet_byte_sha256: packetByteSha256,
    benchmark_case_sha256: packet.benchmark.case_sha256,
    reviewer_case_sha256: packet.reviewer_case_contract.case_sha256,
    record_set_sha256: expectedRecordDigest,
    authorization_reference: "AUTH-14",
    authorization_receipt_id: submission.authorization_receipt_id,
    metrics,
    controlled_fixture_records_accepted: 0,
    import_executed: false,
  } : null;
  return {
    schema_version: "identity.adjudication-import-validation.v1.0.0",
    status: readyForImport ? "validated_ready_for_append_only_import" : auth.status === "pending_external_authorization" && nonAuthorizationErrors.length === 0 ? "pending_external_authorization" : "rejected",
    ready_for_import: readyForImport,
    authorization: { reference: "AUTH-14", register_status: authorizationEntry?.status ?? null, authorized: authorizationEntry?.authorized === true, effective: auth.authorized },
    errors,
    metrics,
    metrics_evidence_status: readyForImport ? "authorized_external_submission_validated" : "untrusted_submission_not_adjudication_evidence",
    validation_receipt: receiptPayload ? { ...receiptPayload, receipt_payload_sha256: sha256(canonicalJson(receiptPayload)) } : null,
  };
}
