export const METHODS_GENERATION = 'live-2026-09-03-85b50522b420'
export const CURRENT_CORPUS_ID = 'ushso-live-catalog-2026-09-03'
export const CURRENT_CORPUS_VERSION = '1.2.0'
export const CURRENT_RECORD_COUNT = 3434
export const HISTORICAL_BASELINE_RECORD_COUNT = 143
export const EVALUATOR_VERSION = 'ushso.retrieval-eval.v1'
export const CURRENT_EVAL_RESULT = 'evaluation/research-program/retrieval-eval/result.json'
export const CURRENT_EVAL_METHODS = 'evaluation/research-program/retrieval-eval/METHODS.md'
export const HISTORICAL_EVAL_REPORT = 'evaluation/baseline/v0.1.0/outputs/evaluation-report.json'
export const HISTORICAL_EVAL_DOC = 'docs/EVALUATION.md'

export const CURRENT_EVAL_CLAIMS = {
  present_source_recall_at_10: { value: '1', receipt: CURRENT_EVAL_METHODS },
  precision_at_5: { value: '0.6', receipt: CURRENT_EVAL_METHODS },
  full_universe_recall: { value: '0.42857142857142855', receipt: CURRENT_EVAL_METHODS },
  forbidden_results: { value: '0', receipt: CURRENT_EVAL_METHODS },
  named_source_misses: { value: '3', receipt: CURRENT_EVAL_METHODS },
  universe_denominator: { value: '7', receipt: CURRENT_EVAL_METHODS },
} as const

export const FAILING_DOMAINS = [
  { domain: 'quality', remediation: 'PR-039-quality-remediation' },
  { domain: 'utilization', remediation: 'PR-039-utilization-remediation' },
  { domain: 'workforce', remediation: 'PR-039-workforce-remediation' },
  { domain: 'geography', remediation: 'PR-039-geography-remediation' },
] as const

export interface MethodsGuide {
  id: string
  title: string
  paragraphs: string[]
  examples?: Array<{ label: string; body: string }>
}

export const assessmentGuide: MethodsGuide = {
  id: 'source-assessment',
  title: 'Assess a source before using it',
  paragraphs: [
    'Read population or universe, observation grain, denominator, weights or margin of error, suppression, date roles, and schema drift before treating a catalog hit as analysis-ready. Unknown cells stay unknown. Catalog membership is not payload access, schema completeness, joinability, scientific quality, or fitness.',
    'CDC NVSS maternal mortality counts deaths associated with pregnancy. CDC infant mortality counts deaths of live-born infants. Those numerators, denominators, and age windows are not interchangeable. A supported maternal-mortality card is not promoted above earlier contextual or uncertain cards, and an infant-mortality source is not a maternal-mortality answer.',
    'HCRIS hospital cost reports are filed by CMS Certification Number for a provider cost-reporting fiscal period. PHC4 public financial reports use a Pennsylvania public-report vintage that is not that CMS fiscal period. Fiscal year and calendar year are not equivalent when both are evidenced and disagree. Metadata-modified dates are not observation ends.',
    'Accepted HCRIS Worksheet G-3 example-packet wire mappings are not a complete HCRIS schema. Unapproved dictionary text is not a canonical schema. Inferred unit tags are search aids only. Appropriate non-use includes treating a docs landing page as proven payload, treating unknown geography as a confirmed match, and treating a successful tool envelope as a completed research task.',
  ],
  examples: [
    {
      label: 'Maternal versus infant mortality',
      body: 'Question “CDC maternal mortality data” leads with CDC provisional maternal death counts. Infant mortality remains a different measure. Do not treat the two as one outcome family.',
    },
    {
      label: 'Fiscal versus calendar period',
      body: 'HCRIS grain is facility/report/year (CMS cost report / CCN / fiscal year). PHC4 time is a public financial-report vintage, not a CMS cost-reporting fiscal period.',
    },
  ],
}

export const joinMrfGuide: MethodsGuide = {
  id: 'joins-and-mrf',
  title: 'Joins, identifiers, and machine-readable files',
  paragraphs: [
    'Identifier systems stay distinct. CCN identifies a Medicare-certified hospital or unit on a cost report. NPI identifies a provider enumeration. Equal numeric reference IDs in different files cannot join. Provider-reference IDs are in-file only. No automatic name-based merge is available.',
    'An individually valid pair of joins cannot be promoted to a valid combined path. Mapping loss and cardinality stay explicit. Geographic vintages are not interchangeable. Unknown geography is not a confirmed match. Unresolved HCRIS/PHC4 joins are not confirmed merges.',
    'Hospital machine-readable files and payer in-network files publish different products. Hospital files may include gross charges, cash or self-pay prices, and negotiated rates. Payer files publish in-network negotiated rates and allowed amounts. Gross, cash, negotiated, and allowed-amount remain distinct measures. None of these is a patient bill. Negotiated rates are not observed payments and are not a basis for inferring what a patient paid.',
    'Official fictional CMS examples are marked synthetic. Unknown newer schema versions are never compatible. Algorithm, percentage, and per-diem values are not comparable dollars. A passing sample is not legal compliance, complete hospital reporting, or comparable patient costs. Frozen hospital and payer identifier lists remain ids_frozen_locators_not_materialized. Unknown locator cells cannot count as supported.',
  ],
  examples: [
    {
      label: 'HCRIS and PHC4',
      body: 'Compare documented HCRIS and PHC4 metadata. HCRIS Worksheet G-3 cost-report definitions are not PHC4 public financial-statement definitions. No automatic CCN=NPI or HCRIS-to-PHC4 identity merge.',
    },
    {
      label: 'Hospital versus payer MRF',
      body: 'Hospital example obs:asset:hospital-mrf-example and payer example obs:asset:payer-mrf-example keep rate types distinct. Do not infer observed payments from negotiated-rate files.',
    },
  ],
}

export const evaluationGuide: MethodsGuide = {
  id: 'current-evaluation',
  title: 'Current evaluation, historical baseline, and citation',
  paragraphs: [
    'Current-generation retrieval evaluation uses evaluator ushso.retrieval-eval.v1 on corpus ushso-live-catalog-2026-09-03 version 1.2.0, generation live-2026-09-03-85b50522b420, 3434 records. Machine-readable results live at evaluation/research-program/retrieval-eval/result.json. Methods and named quantitative claims live at evaluation/research-program/retrieval-eval/METHODS.md.',
    'Present-source recall is hits among sources actually present in the current generation. Full-universe recall keeps known absent named sources in the denominator so missing coverage does not vanish. Producer tests are reported separately from independent reviewer labels. Held-out labels were not used in producer scoring. Label uncertainty stays explicit.',
    'Current published claims from METHODS.md: present-source recall@10 is 1; precision@5 is 0.6; full-universe recall is 0.42857142857142855; forbidden results are 0; named-source misses are 3; universe denominator is 7. R07 remains incomplete. Failing domains are quality, utilization, workforce, and geography, each with a bounded remediation task instead of a passing summary.',
    'The historical 60-question baseline for the immutable 143-record corpus v1.0.1 remains a labeled historical fixture. It must not be read as evidence of the current catalog or retrieval version. Reproduce it from evaluation/baseline/v0.1.0 and docs/EVALUATION.md. Must-not-miss recall at 1/5/10/20 in that historical run is 0.216270 / 0.442460 / 0.500000 / 0.547619.',
    'Cite the publisher product, not USHSO verification. Absent DOI, authors, year, and license stay not captured and are not invented. Packet exports exclude credentials and default to source evidence only. A cited source is the publisher product; USHSO verification is identified separately and is not a publisher endorsement.',
  ],
}

export const methodsGuides = [assessmentGuide, joinMrfGuide, evaluationGuide]
