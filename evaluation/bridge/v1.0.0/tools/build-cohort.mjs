import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBenchmark } from '../../../harness/v2.0.0/tools/benchmark-loader.mjs';
import { PROJECT_ROOT, prettyJson, readJson, readJsonl, sha256 } from '../../../harness/v2.0.0/tools/integrity.mjs';

export const BRIDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CURRENT_ROOT = path.join(PROJECT_ROOT, 'packages/retrieval/versions/v1.1.0');

function locatorKey(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return String(value ?? '').replace(/\/$/, '');
  }
}

function verifyExplicitEquivalence(item, record, canonicalRecords) {
  const canonicalLocators = new Set(canonicalRecords.map(candidate => locatorKey(candidate.authoritative_url)));
  if (!canonicalLocators.has(locatorKey(record.authoritative_url))) {
    throw new Error(`EQUIVALENCE_LOCATOR_MISMATCH:${item.record_id}:${item.canonical_source_id}`);
  }
}

export async function buildPresentSourceCohort() {
  const [benchmark, policy, records, searchDocuments, corpus, corpusManifestBytes] = await Promise.all([
    loadBenchmark(),
    readJson(path.join(BRIDGE_ROOT, 'policies/present-source-policy.json')),
    readJsonl(path.join(CURRENT_ROOT, 'corpus/records.jsonl')),
    readJsonl(path.join(CURRENT_ROOT, 'corpus/search-documents.jsonl')),
    readJson(path.join(CURRENT_ROOT, 'corpus/corpus.json')),
    fs.readFile(path.join(CURRENT_ROOT, 'manifests/corpus-manifest.json'))
  ]);
  const benchmarkSources = new Set(benchmark.sourceIndex.sources.map(source => source.source_record_id));
  const searchIds = new Set(searchDocuments.map(document => document.resource_record_id));
  const explicitByRecord = new Map(policy.explicit_equivalences.map(item => [item.record_id, item]));
  const assetBindings = [];

  for (const record of records) {
    let canonicalSourceId = null;
    let basis = null;
    let evidence = null;
    if (benchmarkSources.has(record.record_id)) {
      canonicalSourceId = record.record_id;
      basis = 'record_id_exact';
      evidence = 'The corpus record_id exactly equals the frozen benchmark source_record_id.';
    } else if (benchmarkSources.has(record.identity?.match_fields?.source_id)) {
      canonicalSourceId = record.identity.match_fields.source_id;
      basis = 'source_native_id_exact';
      evidence = 'The source-native ID exactly equals the frozen benchmark source_record_id.';
    } else if (explicitByRecord.has(record.record_id)) {
      const explicit = explicitByRecord.get(record.record_id);
      canonicalSourceId = explicit.canonical_source_id;
      basis = explicit.basis;
      evidence = explicit.evidence;
      const canonicalRecords = records.filter(candidate => candidate.record_id === canonicalSourceId || candidate.identity?.match_fields?.source_id === canonicalSourceId);
      verifyExplicitEquivalence(explicit, record, canonicalRecords);
    }
    if (canonicalSourceId === null) continue;
    if (!searchIds.has(record.record_id)) throw new Error(`COHORT_BOUND_RECORD_NOT_SEARCHABLE:${record.record_id}`);
    assetBindings.push({
      record_id: record.record_id,
      source_native_id: record.identity?.match_fields?.source_id ?? null,
      canonical_source_id: canonicalSourceId,
      basis,
      evidence,
      search_eligible: true
    });
  }
  assetBindings.sort((a, b) => a.record_id.localeCompare(b.record_id));
  const bindingsBySource = new Map();
  for (const binding of assetBindings) bindingsBySource.set(binding.canonical_source_id, [...(bindingsBySource.get(binding.canonical_source_id) ?? []), binding]);
  const excluded = new Set(policy.present_but_excluded);

  const sourceClassifications = benchmark.sourceIndex.sources.map(source => {
    const bindings = bindingsBySource.get(source.source_record_id) ?? [];
    const status = excluded.has(source.source_record_id)
      ? 'present_but_excluded'
      : bindings.length
        ? 'present_search_eligible'
        : 'missing';
    const reason = status === 'present_search_eligible'
      ? `${bindings.length} reviewed searchable asset binding(s) in corpus v1.1.0.`
      : status === 'present_but_excluded'
        ? 'Present in the generation but excluded by the frozen cohort policy.'
        : 'No reviewed asset binding exists in the pinned 157-record generation.';
    return {
      source_record_id: source.source_record_id,
      source_family_id: source.source_family_id,
      status,
      reason,
      record_ids: bindings.map(binding => binding.record_id)
    };
  }).sort((a, b) => a.source_record_id.localeCompare(b.source_record_id));
  const statusBySource = new Map(sourceClassifications.map(item => [item.source_record_id, item.status]));
  const requirements = benchmark.positives.map(judgment => ({
    judgment_id: judgment.judgment_id,
    question_id: judgment.question_id,
    source_record_id: judgment.source_record_id,
    analytical_role: judgment.analytical_role,
    label: judgment.label,
    status: statusBySource.get(judgment.source_record_id),
    reason: sourceClassifications.find(item => item.source_record_id === judgment.source_record_id).reason
  })).sort((a, b) => a.judgment_id.localeCompare(b.judgment_id));
  const count = (rows, status) => rows.filter(item => item.status === status).length;

  return {
    manifest_version: 'ushso-retrieval-present-source-cohort.v1',
    generated_at: '2026-08-30T00:00:00.000Z',
    current_generation: {
      corpus_id: corpus.corpus_id,
      corpus_version: corpus.corpus_version,
      record_count: corpus.record_count,
      corpus_manifest_sha256: sha256(corpusManifestBytes),
      content_fingerprint_sha256: corpus.manifest_sha256,
      benchmark_pin_sha256: benchmark.pin_sha256,
      policy_sha256: sha256(await fs.readFile(path.join(BRIDGE_ROOT, 'policies/present-source-policy.json')))
    },
    status_vocabulary: ['present_search_eligible', 'present_but_excluded', 'missing'],
    source_classifications: sourceClassifications,
    requirements,
    asset_bindings: assetBindings,
    counts: {
      sources: {
        total: sourceClassifications.length,
        present_search_eligible: count(sourceClassifications, 'present_search_eligible'),
        present_but_excluded: count(sourceClassifications, 'present_but_excluded'),
        missing: count(sourceClassifications, 'missing')
      },
      requirements: {
        total: requirements.length,
        present_search_eligible: count(requirements, 'present_search_eligible'),
        present_but_excluded: count(requirements, 'present_but_excluded'),
        missing: count(requirements, 'missing')
      },
      essential_requirements: {
        total: requirements.filter(item => item.label === 'essential').length,
        present_search_eligible: requirements.filter(item => item.label === 'essential' && item.status === 'present_search_eligible').length,
        present_but_excluded: requirements.filter(item => item.label === 'essential' && item.status === 'present_but_excluded').length,
        missing: requirements.filter(item => item.label === 'essential' && item.status === 'missing').length
      },
      asset_bindings: assetBindings.length
    },
    review: policy.review
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cohort = await buildPresentSourceCohort();
  process.stdout.write(prettyJson(cohort));
}
