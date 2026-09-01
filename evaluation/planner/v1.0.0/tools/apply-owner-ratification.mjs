import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, deepEqual, sha256Id } from './common.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbiddenHeldOutMarkers = ['benchmark/held_out/', 'PLAN-V1-H', 'item_level_held_out'];

const assertClosed = (value, allowed, label) => {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  assert.deepEqual(unknown, [], `${label} has unknown fields: ${unknown.join(', ')}`);
};

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--evidence', '--output'].includes(flag) || !value) throw new Error('Usage: --evidence /absolute/evidence.json --output /absolute/authorization.json');
    result[flag.slice(2)] = value;
  }
  if (!path.isAbsolute(result.evidence ?? '') || !path.isAbsolute(result.output ?? '')) throw new Error('Evidence and output paths must be absolute');
  if (path.resolve(result.output).startsWith(`${packageRoot}${path.sep}`)) throw new Error('Authorization output must not modify the frozen planner benchmark package');
  return result;
}

export function validateOwnerEvidence({ evidence, packet, rawEvidenceBytes }) {
  assertClosed(evidence, ['evidence_version', 'external_authorization_id', 'approval_digests', 'approvals'], 'owner evidence');
  assert.equal(evidence.evidence_version, 'observatory-planner-owner-approval-evidence.v1.0.0');
  assert.equal(evidence.external_authorization_id, 'AUTH-12');
  assert(deepEqual(evidence.approval_digests, packet.approval_digests), 'Top-level approval digests differ from packet');
  assert(Array.isArray(evidence.approvals) && evidence.approvals.length === 3, 'Exactly three approvals are required');
  const expectedAttestations = new Map(packet.required_approvals.map(item => [item.role, item.exact_attestation]));
  const roles = new Set();
  for (const approval of evidence.approvals) {
    assertClosed(approval, ['role', 'reviewer_identity', 'reviewed_at', 'attestation', 'approval_digests', 'review_evidence'], `${approval.role ?? 'unknown'} approval`);
    assertClosed(approval.approval_digests, ['benchmark_manifest_digest', 'evaluator_contract_digest', 'review_subject_digest'], `${approval.role ?? 'unknown'} approval digests`);
    assertClosed(approval.review_evidence, ['kind', 'reference', 'sha256'], `${approval.role ?? 'unknown'} review evidence`);
    assert(expectedAttestations.has(approval.role), `Unknown owner role ${approval.role}`);
    assert(!roles.has(approval.role), `Duplicate owner role ${approval.role}`);
    roles.add(approval.role);
    assert.equal(approval.attestation, expectedAttestations.get(approval.role), `${approval.role} attestation differs from frozen language`);
    assert(deepEqual(approval.approval_digests, packet.approval_digests), `${approval.role} digest mismatch`);
    assert(typeof approval.reviewer_identity === 'string' && approval.reviewer_identity.length > 0 && approval.reviewer_identity.length <= 240, `${approval.role} reviewer identity required`);
    assert(typeof approval.reviewed_at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(approval.reviewed_at) && !Number.isNaN(Date.parse(approval.reviewed_at)), `${approval.role} reviewed_at must be an absolute UTC ISO date-time`);
    assert(['digital_signature', 'review_system_record', 'signed_document'].includes(approval.review_evidence?.kind), `${approval.role} evidence kind invalid`);
    assert(typeof approval.review_evidence?.reference === 'string' && approval.review_evidence.reference.length > 0 && approval.review_evidence.reference.length <= 1000, `${approval.role} review reference required`);
    assert(/^sha256:[a-f0-9]{64}$/u.test(approval.review_evidence?.sha256 ?? ''), `${approval.role} evidence digest invalid`);
  }
  assert.deepEqual([...roles].sort(), ['engineering', 'product', 'research_methods']);
  const rawText = rawEvidenceBytes.toString('utf8');
  for (const marker of forbiddenHeldOutMarkers) assert(!rawText.includes(marker), `Owner evidence must not expose held-out marker ${marker}`);
  return true;
}

export async function applyOwnerRatification({ evidencePath, outputPath }) {
  const [packet, rawEvidenceBytes] = await Promise.all([
    fs.readFile(path.join(packageRoot, 'governance/owner-review-packet.json'), 'utf8').then(JSON.parse),
    fs.readFile(evidencePath)
  ]);
  const evidence = JSON.parse(rawEvidenceBytes);
  validateOwnerEvidence({ evidence, packet, rawEvidenceBytes });
  const authorization = {
    authorization_record_version: 'observatory-planner-owner-authorization.v1.0.0',
    external_authorization_id: 'AUTH-12',
    benchmark_package: packet.benchmark_package,
    approval_digests: packet.approval_digests,
    approvals: evidence.approvals.map(approval => ({
      role: approval.role,
      reviewer_identity: approval.reviewer_identity,
      reviewed_at: approval.reviewed_at,
      review_evidence: approval.review_evidence
    })).sort((a, b) => a.role.localeCompare(b.role)),
    evidence_file_sha256: sha256Id(rawEvidenceBytes),
    item_level_held_out_gold_read: false,
    held_out_scoring_authorized: false,
    wp10b_authorized: true
  };
  authorization.authorization_digest = sha256Id(canonicalJson(authorization));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(authorization, null, 2)}\n`, { flag: 'wx' });
  return authorization;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  const result = await applyOwnerRatification({ evidencePath: args.evidence, outputPath: args.output });
  process.stdout.write(`${JSON.stringify({ authorization_digest: result.authorization_digest, wp10b_authorized: result.wp10b_authorized, held_out_scoring_authorized: result.held_out_scoring_authorized })}\n`);
}
