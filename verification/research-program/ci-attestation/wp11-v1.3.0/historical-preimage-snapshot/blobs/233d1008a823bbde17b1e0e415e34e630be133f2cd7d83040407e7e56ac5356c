import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function createDraft(packageId, technicalEvidence) {
  assert.equal(technicalEvidence.status, 'PASS', 'SUCCESSOR_TECHNICAL_CHECKS_NOT_PASS');
  const subject = { package_id: packageId, technical_evidence: technicalEvidence };
  return { schema_version: 'ushso-successor-attestation.v1.0.0', ...subject,
    subject_sha256: sha256(canonical(subject)), status: 'pending_authorized_review', technical_status: 'PASS',
    approval: null, release_gate_pass: false, release_ready: false, production_eligibility: false };
}
export function approvalStatement(draft) {
  return `I authorize the successor attestation ${draft.package_id} for subject ${draft.subject_sha256}. This does not authorize release, publication, or deployment.`;
}
export function validateApproval(draft, approval, evidenceBytes) {
  assert.deepEqual(draft, createDraft(draft.package_id, draft.technical_evidence), 'SUCCESSOR_DRAFT_TAMPERED');
  assert.ok(approval && approval.status === 'approved', 'SUCCESSOR_APPROVAL_PENDING');
  assert.equal(approval.schema_version, 'ushso-successor-approval.v1.0.0', 'SUCCESSOR_APPROVAL_SCHEMA');
  assert.equal(approval.package_id, draft.package_id, 'SUCCESSOR_APPROVAL_WRONG_PACKAGE');
  assert.equal(approval.subject_sha256, draft.subject_sha256, 'SUCCESSOR_APPROVAL_STALE_SUBJECT');
  assert.ok(approval.reviewer && typeof approval.reviewer.id === 'string' && approval.reviewer.id.trim().length >= 3, 'SUCCESSOR_REVIEWER_REQUIRED');
  assert.ok(['repository_owner', 'authorized_release_reviewer'].includes(approval.reviewer.role), 'SUCCESSOR_REVIEWER_ROLE');
  assert.ok(typeof approval.recorded_at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(approval.recorded_at) && Number.isFinite(Date.parse(approval.recorded_at)), 'SUCCESSOR_APPROVAL_TIMESTAMP');
  assert.ok(evidenceBytes?.length > 0, 'SUCCESSOR_APPROVAL_EVIDENCE_REQUIRED');
  assert.equal(approval.evidence_sha256, sha256(evidenceBytes), 'SUCCESSOR_APPROVAL_EVIDENCE_HASH');
  assert.equal(approval.attestation, approvalStatement(draft), 'SUCCESSOR_APPROVAL_SCOPE');
  // Evidence must carry the actual recorded statement and reviewer, not a bare hash.
  const evidence = evidenceBytes.toString('utf8');
  assert.ok(evidence.includes(approval.attestation) && evidence.includes(approval.reviewer.id), 'SUCCESSOR_APPROVAL_EVIDENCE_STATEMENT');
  return true;
}
export function issueApprovedReceipt(draft, approval, evidenceBytes) {
  validateApproval(draft, approval, evidenceBytes);
  return { ...draft, status: 'approved_scoped_attestation', approval: structuredClone(approval) };
}
export async function pinFiles(repoRoot, names) {
  const pins = [];
  for (const name of [...new Set(names)].sort()) {
    assert.ok(!path.isAbsolute(name) && !name.split(/[\\/]/).includes('..'), 'SUCCESSOR_UNSAFE_PATH');
    const file = path.join(repoRoot, name);
    const real = await fs.realpath(file);
    assert.ok(real.startsWith(`${await fs.realpath(repoRoot)}${path.sep}`), 'SUCCESSOR_PATH_ESCAPE');
    const bytes = await fs.readFile(file);
    pins.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return pins;
}
export async function listFiles(repoRoot, relative) {
  const result = [];
  for (const entry of await fs.readdir(path.join(repoRoot, relative), { withFileTypes: true })) {
    if (['node_modules', '.git', 'receipts', 'approvals', 'drafts', 'dist', '.wrangler'].includes(entry.name)) continue;
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await listFiles(repoRoot, child));
    else if (entry.isFile()) result.push(child);
    else throw new Error(`SUCCESSOR_UNSUPPORTED_FILE_TYPE:${child}`);
  }
  return result.sort();
}
export async function runSuccessorCli({ packageId, packageRoot, buildTechnicalEvidence, args = process.argv.slice(2) }) {
  const allowed = new Set(['--draft', '--validate', '--issue', '--output', '--approval', '--evidence']);
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    assert.ok(allowed.has(args[i]), `SUCCESSOR_UNKNOWN_ARGUMENT:${args[i]}`);
    assert.ok(!seen.has(args[i]), `SUCCESSOR_DUPLICATE_ARGUMENT:${args[i]}`);
    seen.add(args[i]);
    if (['--output', '--approval', '--evidence'].includes(args[i])) assert.ok(args[++i] && !args[i].startsWith('--'), 'SUCCESSOR_ARGUMENT_VALUE');
  }
  const modes = args.filter(arg => ['--draft', '--validate', '--issue'].includes(arg));
  assert.equal(modes.length, 1, 'SUCCESSOR_EXACTLY_ONE_MODE_REQUIRED');
  const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
  assert.ok(modes[0] === '--draft' || !value('--output'), 'SUCCESSOR_OUTPUT_ONLY_FOR_DRAFT');
  const draft = createDraft(packageId, await buildTechnicalEvidence());
  if (modes[0] === '--draft') {
    assert.ok(!value('--approval') && !value('--evidence'), 'SUCCESSOR_DRAFT_CANNOT_APPROVE');
    if (value('--output')) await fs.writeFile(value('--output'), JSON.stringify(draft, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify(draft, null, 2) + '\n');
    return draft;
  }
  const approvalFile = value('--approval') ?? path.join(packageRoot, 'approvals/approval.json');
  const evidenceFile = value('--evidence') ?? path.join(packageRoot, 'approvals/evidence.txt');
  const pending = () => {
    process.stdout.write(JSON.stringify({ status: 'BLOCKED_APPROVAL_PENDING', package_id: packageId, subject_sha256: draft.subject_sha256, technical_status: 'PASS', release_gate_pass: false }) + '\n');
    process.exitCode = 2;
    return draft;
  };
  let approval, evidence;
  try {
    approval = JSON.parse(await fs.readFile(approvalFile, 'utf8'));
    if (!approval || ['pending_authorized_review', 'pending'].includes(approval.status)) return pending();
    evidence = await fs.readFile(evidenceFile);
  }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return pending();
  }
  const approved = issueApprovedReceipt(draft, approval, evidence);
  const receiptFile = path.join(packageRoot, 'receipts/approved.json');
  if (modes[0] === '--issue') {
    assert.ok(!value('--output'), 'SUCCESSOR_APPROVED_OUTPUT_IS_FIXED');
    await fs.mkdir(path.dirname(receiptFile), { recursive: true });
    // Never overwrite predecessor or previously issued successor receipts.
    await fs.writeFile(receiptFile, JSON.stringify(approved, null, 2) + '\n', { flag: 'wx' });
  } else assert.deepEqual(JSON.parse(await fs.readFile(receiptFile, 'utf8')), approved, 'SUCCESSOR_APPROVED_RECEIPT_STALE');
  process.stdout.write(JSON.stringify({ status: approved.status, subject_sha256: approved.subject_sha256, release_gate_pass: false }) + '\n');
  return approved;
}
