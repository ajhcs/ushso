import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { scoreQuery, aggregate, VERSION } from './metrics.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function scoreFrozen(receipt, labels) {
  if (receipt.schema !== 'ushso.frozen-retrieval.v2' || labels.cohort_sha256 !== receipt.cohort_sha256 || labels.source_unit !== receipt.source_unit || !labels.revision) throw new Error('LABEL_BINDING_MISMATCH');
  if (labels.independence !== 'producer_fixture' && labels.independence !== 'independently_adjudicated') throw new Error('LABEL_PROVENANCE_REQUIRED');
  const judgments = new Map();
  for (const q of labels.queries) { if (judgments.has(q.query_id)) throw new Error('DUPLICATE_QUERY_LABEL'); judgments.set(q.query_id, q); }
  if (judgments.size !== receipt.rows.length || new Set(receipt.rows.map(r => r.query_id)).size !== receipt.rows.length) throw new Error('COHORT_MEMBERSHIP_MISMATCH');
  const membership = receipt.corpus_units;
  if (!membership || sha(JSON.stringify(membership)) !== receipt.corpus_units_sha256 || labels.corpus_units_sha256 !== receipt.corpus_units_sha256) throw new Error('CORPUS_MEMBERSHIP_BINDING_MISMATCH');
  if ('corpus_units' in labels) throw new Error('LABELS_MUST_NOT_DEFINE_CORPUS_MEMBERSHIP');
  if (!Array.isArray(membership) || new Set(membership).size !== membership.length) throw new Error('INVALID_MEMBERSHIP');
  for (const row of receipt.rows) if (row.ranked.some(r => !membership.includes(r.unit_id))) throw new Error('RESULT_OUTSIDE_DECLARED_CORPUS');
  const metrics = {};
  for (const k of [1, 5, 10, 20]) {
    const rows = receipt.rows.map(r => scoreQuery(r, judgments.get(r.query_id), membership, k));
    metrics[k] = { rows, aggregate: aggregate(rows) };
  }
  return { evaluator: VERSION, label_revision: labels.revision, label_independence: labels.independence,
    acceptance: labels.independence === 'producer_fixture' ? 'not_established_by_producer_fixtures' : 'requires_owner_disposition', metrics };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [receiptFile, digest, labelsFile, output] = process.argv.slice(2);
  if (!output) throw new Error('Usage: score.mjs RECEIPT EXPECTED_SHA256 LABELS OUTPUT');
  const bytes = await readFile(receiptFile);
  if (sha(bytes) !== digest) throw new Error('FROZEN_RECEIPT_DIGEST_MISMATCH');
  const labelsBytes = await readFile(labelsFile);
  const result = { ...scoreFrozen(JSON.parse(bytes), JSON.parse(labelsBytes)), receipt_sha256: digest, labels_sha256: sha(labelsBytes) };
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, acceptance: result.acceptance }));
}
