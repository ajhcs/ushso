import { HCRIS_HOSPITAL_COST_REPORT_ID } from './asset-context-collections.mjs';

export const COMPARISON_DIMENSIONS_VERSION = 'ushso.comparison-dimensions.v1';
export const PHC4_PUBLIC_FINANCIAL_REPORTS_ID = 'obs:asset:pa-phc4-public-financial-reports';
export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';

function freeze(value) {
  return Object.freeze(value);
}

const HCRIS_EVIDENCE = freeze(['evidence:cms-data-catalog:bf696c5e94f4146abe7ad61b']);
const PHC4_EVIDENCE = freeze(['evidence:pa-phc4:public-financial-reports']);

const HCRIS = freeze({
  record_id: HCRIS_HOSPITAL_COST_REPORT_ID,
  reporting_definition: 'Medicare hospital cost-report worksheets filed by CCN for a provider cost-reporting period. Not Pennsylvania PHC4 financial-statement reporting.',
  universe: 'medicare_certified_hospitals',
  geography: 'United States Medicare-certified hospitals; not limited to Pennsylvania.',
  grain: 'facility/report/year (CMS cost report / CCN / fiscal year). Inferred catalog unit tags are not this claim.',
  access: 'Public CMS catalog documentation. Catalog membership is not payload access.',
  time: 'Provider cost-reporting fiscal period, not PHC4 annual public financial-report vintage.',
  variables_schema: 'Accepted HCRIS Worksheet G-3 example-packet wire mappings only. Not a complete HCRIS schema and not PHC4 statement lines.',
  freshness: 'current first-party catalog metadata as of the selected generation',
  authority: 'CMS hospital cost-report catalog metadata',
  join_compatibility: 'No automatic CCN=NPI or HCRIS-to-PHC4 identity merge.',
  evidence_ids: HCRIS_EVIDENCE,
});

const PHC4 = freeze({
  record_id: PHC4_PUBLIC_FINANCIAL_REPORTS_ID,
  reporting_definition: 'Pennsylvania Health Care Cost Containment Council public hospital and health-system financial reports. Not CMS HCRIS Worksheet G-3 cost-report definitions.',
  universe: 'pennsylvania_hospitals_and_health_systems',
  geography: 'Pennsylvania public financial reporting; not the national Medicare cost-report universe.',
  grain: 'hospital/health-system public financial report. Public report visibility is not PHC4 custom record-level access.',
  access: 'Public PHC4 report pages. Custom record-level PHC4 files remain a separate restricted request path.',
  time: 'PHC4 public financial-report vintage, not a CMS cost-reporting fiscal period.',
  variables_schema: 'PHC4 public financial-statement categories. Not HCRIS Worksheet G-3 NET_PATIENT_REVENUE wire mappings.',
  freshness: 'documented public-report locator only; payload completeness unknown',
  authority: 'PHC4 public financial-report catalog metadata',
  join_compatibility: 'No automatic CCN=NPI or HCRIS-to-PHC4 identity merge.',
  evidence_ids: PHC4_EVIDENCE,
});

const DOCUMENTED = freeze({
  [HCRIS.record_id]: HCRIS,
  [PHC4.record_id]: PHC4,
});

export function documentedComparisonProfile(recordId) {
  return DOCUMENTED[recordId] ?? null;
}

function knownValue(text, evidenceIds) {
  return freeze({ metadata_value: text, state: 'known', evidence_ids: evidenceIds });
}

export function comparisonFact(record, dimension) {
  const documented = documentedComparisonProfile(record?.record_id);
  if (!documented) return freeze({ metadata_value: null, state: 'unknown', evidence_ids: freeze([record?.evidence?.[0]?.evidence_id].filter(Boolean)) });
  switch (dimension) {
    case 'access': return knownValue(documented.access, documented.evidence_ids);
    case 'time': return knownValue(documented.time, documented.evidence_ids);
    case 'grain': return knownValue(documented.grain, documented.evidence_ids);
    case 'variables_schema': return knownValue(documented.variables_schema, documented.evidence_ids);
    case 'geography': return knownValue(documented.geography, documented.evidence_ids);
    case 'authority': return knownValue(documented.authority, documented.evidence_ids);
    case 'freshness': return knownValue(documented.freshness, documented.evidence_ids);
    case 'join_compatibility': return knownValue(documented.join_compatibility, documented.evidence_ids);
    case 'role': return knownValue(documented.reporting_definition, documented.evidence_ids);
    case 'machine_readiness': return freeze({ metadata_value: null, state: 'unknown', evidence_ids: documented.evidence_ids });
    case 'operation_kind': return freeze({ metadata_value: 'none', state: 'known', evidence_ids: documented.evidence_ids });
    case 'join_evidence': return freeze({ metadata_value: 'Reviewed join fixtures are separate from this comparison overlay.', state: 'known', evidence_ids: documented.evidence_ids });
    default: return freeze({ metadata_value: null, state: 'unknown', evidence_ids: documented.evidence_ids });
  }
}

export function comparisonDimensionState(values) {
  if (values.some((value) => value.state !== 'known' || value.metadata_value == null)) return 'unknown';
  const texts = [...new Set(values.map((value) => value.metadata_value))];
  if (texts.length === 1) return 'comparable';
  return 'incomparable';
}

export function comparisonExplanation(dimension, values, state) {
  if (state === 'incomparable') {
    return 'These assets use different reporting definitions. Populated dimension values are documented metadata, not a generic complete comparison and not a ranking of source values.';
  }
  if (state === 'unknown') {
    return 'At least one requested comparison dimension remains unknown. Envelope construction is not comparison completeness.';
  }
  return 'Indexed and documented metadata for this dimension is comparable. Unknown values stay unknown and no source values or analytical rankings are produced.';
}

export const HCRIS_PHC4_DEFINITION_CAVEAT = 'HCRIS Worksheet G-3 cost-report definitions are not PHC4 public financial-statement definitions.';
