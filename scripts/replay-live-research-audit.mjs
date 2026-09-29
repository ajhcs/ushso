import fs from 'node:fs/promises';
import path from 'node:path';

const questions = [
  'I need hospital financial and utilization data for Pennsylvania',
  'hospital cost reports',
  'HCRIS',
  'PHC4',
  'HCUP',
  'AHRQ Compendium of US Health Systems',
  'hospital ownership',
  'Medicaid enrollment by state',
  'rural hospital closures',
  'hospital readmission rates',
  'Medicare hospital spending 2023',
  'uninsured adults by county',
  'maternal mortality by race',
  'NHIS',
  'MEPS',
  'BRFSS',
  'Pennsylvania flibbertigibbet qzxwvu',
  'zzzxxyqq',
  'hospital',
  'hospital in California',
  'hospital in Pennsylvania',
  'hospital 2020',
  'hospital 2024',
  'hospital public use data only',
  'Pennsylvania hospital discharge and utilization data',
  'Hospital financial and utilization data in California',
  'Hospital quality and workforce data in New York',
  'Hospital ownership changes and enrollments in Texas',
  'Rural hospital classifications and closures in Kansas',
  'hospital public only',
  'hospital free data',
  'hospital 1900',
  'hospital 2099',
  'hospital NOT nursing home',
  'hospital excluding nursing homes',
  'hospital readmissions',
  'maternal mortality',
  'pregnancy related mortality',
  'hospital finance',
  'hospital financials',
  'CMS Hospital Readmissions Reduction Program',
  'health insurance small area estimates',
];

const homepageExamples = [
  ['CMS HCRIS hospital cost reports by state', 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17'],
  ['CDC maternal mortality data', 'obs:asset:cdc-socrata:e2d5-ggg7-de73391d5d45d504'],
  ['What CMS sources describe hospital ownership in Pennsylvania?', 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-60625-369694b51de508f8'],
  ['Public-use hospital utilization data', 'obs:asset:cdc-socrata:tqpr-vcrm-4aa4061557d57dc8'],
  ['CMS Medicare inpatient hospital utilization', 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-1e1be-2e19bf0aa4756bb2'],
].map(([question, expectedLeadingId]) => ({ question, expectedLeadingId }));

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

const base = arg('--base-url', 'http://127.0.0.1:8787').replace(/\/$/, '');
const only = arg('--only', 'all');
if (!['all', 'audit', 'homepage'].includes(only)) throw new Error('--only must be all, audit, or homepage');
const jsonPath = arg('--output-json', 'docs/reviews/2026-09-06-live-research-audit/candidate-replay.json');
const markdownPath = arg('--output-markdown', 'docs/reviews/2026-09-06-live-research-audit/candidate-replay.md');

async function runOne(entry, kind, number) {
  const response = await fetch(base + '/api/discover', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: entry.question, limit: 10 }),
  });
  const responseText = await response.text();
  let body;
  try {
    body = JSON.parse(responseText);
  } catch {
    throw new Error('Non-JSON response for question #' + number + ' (' + response.status + '): ' + responseText.slice(0, 160));
  }
  const results = Array.isArray(body.results) ? body.results : [];
  const orderedIds = body.ranking?.ordered_ids ?? [];
  return {
    kind,
    number,
    question: entry.question,
    http_status: response.status,
    total_matches: body.pagination?.total_matches ?? body.total_matches ?? null,
    top: results.slice(0, 5).map((result) => ({
      id: result.record_id,
      title: result.record?.title ?? null,
      match_state: result.match_state ?? null,
      named_source_role: result.metadata?.named_source_role ?? null,
      geographic_compatibility: result.metadata?.geographic_compatibility ?? null,
      observation_time_compatibility: result.metadata?.observation_time_compatibility ?? null,
      access_compatibility: result.metadata?.access_compatibility ?? null,
    })),
    sections: Object.fromEntries(Object.entries(body.sections ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value.length : null])),
    interpreted_constraints: body.query?.interpretation ?? null,
    named_source_resolution: body.named_source_resolution ?? [],
    warnings: body.warnings ?? [],
    partial_results: body.partial_results ?? null,
    checks: {
      http_200: response.status === 200,
      production_corpus_3434: body.corpus?.record_count === 3434,
      production_version_1_2_0: body.corpus?.corpus_version === '1.2.0',
      source_slices_3434: Object.values(body.corpus?.source_slices ?? {}).reduce((sum, value) => sum + Number(value), 0) === 3434,
      ordered_ids_match_page: JSON.stringify(orderedIds) === JSON.stringify(results.map((result) => result.record_id)),
      invalid_records_isolated: body.partial_results?.is_partial === true && body.partial_results?.invalid_item_count === 4,
      expected_homepage_leader: entry.expectedLeadingId == null ? null : results[0]?.record_id === entry.expectedLeadingId,
    },
    expected_leading_id: entry.expectedLeadingId ?? null,
  };
}

async function runBatch(entries, kind) {
  const output = [];
  for (let index = 0; index < entries.length; index += 1) {
    output.push(await runOne(entries[index], kind, index + 1));
  }
  return output;
}

const catalogResponse = await fetch(base + '/api/catalog?page_size=1&sort=title_asc');
const catalog = await catalogResponse.json();
const auditResults = only === 'homepage' ? [] : await runBatch(questions.map((question) => ({ question })), 'original_audit');
const homepageResults = only === 'audit' ? [] : await runBatch(homepageExamples, 'homepage_example');
const all = [...auditResults, ...homepageResults];
const checks = all.flatMap((result) => Object.entries(result.checks).filter(([, value]) => value !== null).map(([name, passed]) => ({ name, passed })));
const report = {
  report_version: 'ushso-live-audit-candidate-replay.v1.0.0',
  generated_at: new Date().toISOString(),
  target: base,
  inputs: {
    original_audit_question_count: questions.length,
    homepage_example_count: homepageExamples.length,
    acceptance_basis: 'Release-candidate Worker plus the 3,434-record v1.2.0 production manifest. Historical 143/157-record counts and old ordering are diagnostic history, not candidate acceptance expectations.',
  },
  candidate: {
    corpus: catalog.corpus ?? null,
    searchable_record_count: catalog.pagination?.total_matches ?? catalog.total_matches ?? null,
    partial_results: catalog.partial_results ?? null,
  },
  summary: {
    requests_completed: all.length,
    original_audit_requests_completed: auditResults.length,
    homepage_requests_completed: homepageResults.length,
    contract_checks_passed: checks.filter((check) => check.passed).length,
    contract_checks_failed: checks.filter((check) => !check.passed).length,
    homepage_leading_expectations_passed: homepageResults.filter((result) => result.checks.expected_homepage_leader).length,
    homepage_leading_expectations_failed: homepageResults.filter((result) => !result.checks.expected_homepage_leader).length,
  },
  original_audit_results: auditResults,
  homepage_results: homepageResults,
};

function rows(results) {
  return results.map((result) => {
    const leader = result.top[0];
    const acceptance = result.expected_leading_id == null ? 'diagnostic replay' : (result.checks.expected_homepage_leader ? 'pass' : 'FAIL');
    return '| ' + result.number + ' | ' + result.question.replaceAll('|', '\\|') + ' | ' + (result.total_matches ?? 'n/a') + ' | ' + (leader?.title ?? '—').replaceAll('|', '\\|') + ' | ' + (leader?.match_state ?? '—') + ' | ' + acceptance + ' |';
  }).join('\n');
}

const markdown = [
  '# Release-candidate replay of the live research audit',
  '',
  'Generated: ' + report.generated_at,
  '',
  'Target: ' + base,
  '',
  'This replay uses the production-lineage Worker corpus: **' + (report.candidate.corpus?.record_count ?? 'unknown') + ' published records** (' + (report.candidate.searchable_record_count ?? 'unknown') + ' currently searchable; ' + (report.candidate.partial_results?.invalid_item_count ?? 0) + ' incompatible records isolated), version ' + (report.candidate.corpus?.corpus_version ?? 'unknown') + ', generation ' + (report.candidate.corpus?.publication?.generation ?? 'unknown') + '.',
  '',
  'The 143-record evaluation corpus and 157-record predecessor are historical fixtures, not candidate acceptance expectations.',
  '',
  '## Outcome',
  '',
  '- Original audit questions replayed in this receipt: ' + report.summary.original_audit_requests_completed + '/' + (only === 'homepage' ? 0 : 42) + '.',
  '- Homepage examples replayed in this receipt: ' + report.summary.homepage_requests_completed + '/' + (only === 'audit' ? 0 : 5) + '.',
  '- Worker/corpus/ordering/isolation checks: ' + report.summary.contract_checks_passed + ' passed, ' + report.summary.contract_checks_failed + ' failed.',
  '- Homepage expected leading records: ' + report.summary.homepage_leading_expectations_passed + '/' + (only === 'audit' ? 0 : 5) + ' passed.',
  '- Relevance remains a reviewer judgment. HTTP 200 or a nonzero count is not proof that a result answers the question.',
  '',
  '## Original 42-question diagnostic replay',
  '',
  '| # | Question | Matches | Leading result | Leading state | Acceptance |',
  '|---:|---|---:|---|---|---|',
  rows(auditResults),
  '',
  '## Homepage example acceptance replay',
  '',
  '| # | Question | Matches | Leading result | Leading state | Expected production leader |',
  '|---:|---|---:|---|---|---|',
  rows(homepageResults),
  '',
  'The JSON companion preserves interpreted constraints, five ordered records, section counts, named-source resolution, partial-result state, and every automated check.',
  '',
].join('\n');

await fs.mkdir(path.dirname(jsonPath), { recursive: true });
await fs.mkdir(path.dirname(markdownPath), { recursive: true });
await fs.writeFile(jsonPath, JSON.stringify(report, null, 2) + '\n');
await fs.writeFile(markdownPath, markdown);
console.log(JSON.stringify(report.summary));
