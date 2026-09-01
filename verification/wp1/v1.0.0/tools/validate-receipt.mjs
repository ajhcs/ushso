import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const receiptPath = path.join(root, 'verification/wp1/v1.0.0/receipts/repository-adapter-contract.json');
const artifactPath = path.join(root, 'verification/wp1/v1.0.0/static-rollback-artifact.json');
const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
const errors = [];

if (receipt.status !== 'PASS') errors.push('receipt status is not PASS');
if (receipt.publication_context?.resolved_once_per_request !== true || receipt.publication_context?.deeply_frozen !== true) {
  errors.push('publication context invariants are missing');
}
if (receipt.static_behavior?.coverage_status !== 'unknown' || receipt.static_behavior?.absence_claim_permitted !== false) {
  errors.push('static coverage boundary is invalid');
}
if (receipt.static_behavior?.planner_error !== 'planner_unavailable') errors.push('static planner boundary is invalid');
if (receipt.verification_commands?.some(command => command.status !== 'PASS')) errors.push('a scoped verification command did not pass');

for (const source of receipt.source_files ?? []) {
  const bytes = await fs.readFile(path.join(root, source.path));
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== source.sha256) errors.push(`${source.path}: expected ${source.sha256}, got ${digest}`);
}

if (artifact.entrypoint !== receipt.rollback_artifact?.entrypoint) errors.push('rollback entrypoint differs between artifact and receipt');
if (artifact.entrypoint_sha256 !== receipt.source_files.find(source => source.path === artifact.entrypoint)?.sha256) errors.push('rollback entrypoint hash is inconsistent');
if (artifact.dry_run?.bundle_sha256 !== receipt.rollback_artifact?.bundle_sha256) errors.push('rollback bundle hash is inconsistent');
if (artifact.dry_run?.bundle_bytes !== receipt.rollback_artifact?.bundle_bytes) errors.push('rollback bundle byte count is inconsistent');
if (JSON.stringify(artifact.required_bindings) !== JSON.stringify(['ASSETS'])) errors.push('rollback artifact requires a binding other than ASSETS');
if (artifact.dry_run?.deployed !== false || artifact.truth_boundary?.source_requests_made !== false) errors.push('rollback artifact crossed an external-action boundary');

const result = {
  status: errors.length ? 'FAIL' : 'PASS',
  receipt: path.relative(root, receiptPath),
  source_files_verified: receipt.source_files?.length ?? 0,
  rollback_entrypoint: artifact.entrypoint,
  rollback_bundle_sha256: artifact.dry_run?.bundle_sha256,
  errors
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (errors.length) process.exitCode = 1;
