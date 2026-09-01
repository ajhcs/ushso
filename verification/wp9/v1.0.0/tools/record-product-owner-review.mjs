import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '../../..');
const PACKET_PATH = path.join(ROOT, 'governance/product-owner-wording-review.json');
const RECEIPT_PATH = path.join(ROOT, 'governance/product-owner-wording-review.receipt.json');

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`MISSING_ARGUMENT:${name}`);
  return process.argv[index + 1];
}

async function sha256(file) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

function validUtc(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

async function main() {
  const reviewerId = argument('--reviewer-id');
  const reviewedAt = argument('--reviewed-at');
  const reviewEvidenceRef = argument('--review-evidence-ref');
  const attestationFile = argument('--attestation-file');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,179}$/.test(reviewerId)) throw new Error('INVALID_REVIEWER_ID');
  if (!validUtc(reviewedAt)) throw new Error('INVALID_REVIEWED_AT');
  if (reviewEvidenceRef.length < 8 || reviewEvidenceRef.length > 500) throw new Error('INVALID_REVIEW_EVIDENCE_REF');

  const packet = JSON.parse(await fs.readFile(PACKET_PATH, 'utf8'));
  if (packet.status !== 'pending_external_review' || packet.publication_authorized !== false) throw new Error('REVIEW_PACKET_STATE_MISMATCH');
  for (const artifact of packet.artifacts_to_review) {
    const actual = await sha256(path.join(REPO, artifact.path));
    if (actual !== artifact.sha256) throw new Error(`REVIEW_ARTIFACT_DIGEST_MISMATCH:${artifact.path}`);
  }
  const attestation = (await fs.readFile(path.resolve(attestationFile), 'utf8')).trim();
  if (attestation !== packet.required_attestation) throw new Error('ATTESTATION_TEXT_MISMATCH');

  const receipt = {
    schema_version: 'ushso-product-owner-wording-review-receipt.v1.0.0',
    review_id: packet.review_id,
    decision: 'wording_approved',
    reviewer_role: packet.required_owner_role,
    reviewer_id: reviewerId,
    reviewed_at: reviewedAt,
    review_evidence_ref: reviewEvidenceRef,
    attestation_sha256: crypto.createHash('sha256').update(attestation, 'utf8').digest('hex'),
    artifact_digests: Object.fromEntries(packet.artifacts_to_review.map(artifact => [artifact.path, artifact.sha256])),
    publication_authorized: false,
    authorization_boundary: packet.scope
  };
  await fs.writeFile(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ status: 'recorded', receipt_path: path.relative(REPO, RECEIPT_PATH), receipt_sha256: await sha256(RECEIPT_PATH) })}\n`);
}

await main();
