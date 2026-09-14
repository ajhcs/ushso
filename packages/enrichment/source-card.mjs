function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

const ESSENTIAL = Object.freeze(['purpose', 'coverage', 'grain', 'example_variables', 'access_steps', 'tested_state', 'limits', 'citation']);

export function buildSourceCard(input = {}) {
  if (Array.isArray(input.topic_tags) && input.topic_tags.length && (!input.purpose || input.purpose_from_topic_tags === true)) {
    fail('BEST_FOR_FROM_TOPIC_TAGS');
  }
  const missing = ESSENTIAL.filter((field) => {
    const value = input[field];
    return value == null || value === '' || (Array.isArray(value) && value.length === 0);
  });
  const claims = (input.claims ?? []).map((claim) => {
    if (!claim.text) fail('EMPTY_CLAIM');
    if (!Array.isArray(claim.evidence_ids) || claim.evidence_ids.length === 0) fail('CLAIM_EVIDENCE_REQUIRED', claim.text);
    if (!claim.publisher_passage) fail('PUBLISHER_PASSAGE_REQUIRED', claim.text);
    return freeze({ ...claim, evidence_ids: freeze([...claim.evidence_ids]) });
  });
  const status = missing.length ? 'incomplete' : (input.status ?? 'documented');
  if (status === 'research_ready' && missing.length) fail('INCOMPLETE_NOT_RESEARCH_READY');
  const unknowns = freeze([...(input.unknowns ?? [])]);
  const unknownSections = unknowns.map((item) => freeze({
    id: item,
    presentation: 'compact',
    full_page_section: false,
  }));
  return freeze({
    format: 'ushso.source-card.v1',
    source_id: input.source_id ?? null,
    status,
    incomplete: missing.length > 0,
    missing_essential: freeze(missing),
    purpose: input.purpose ?? null,
    coverage: input.coverage ?? null,
    grain: input.grain ?? null,
    example_variables: freeze([...(input.example_variables ?? [])]),
    access_steps: freeze([...(input.access_steps ?? [])]),
    tested_state: input.tested_state ?? null,
    limits: freeze([...(input.limits ?? [])]),
    citation: input.citation ?? null,
    documented_use: freeze([...(input.documented_use ?? [])]),
    reviewed_recommendation: freeze([...(input.reviewed_recommendation ?? [])]),
    unsupported_use: freeze([...(input.unsupported_use ?? [])]),
    claims: freeze(claims),
    release_id: input.release_id ?? null,
    schema_id: input.schema_id ?? null,
    example_ids: freeze([...(input.example_ids ?? [])]),
    beginner_guide_id: input.beginner_guide_id ?? null,
    expert_guide_id: input.expert_guide_id ?? null,
    provenance_expandable: true,
    unknowns: freeze(unknownSections),
    generic_warning_copied: false,
    best_for_from_topic_tags: false,
  });
}

export function readerPath(card) {
  const steps = [];
  if (card.purpose) steps.push({ id: 'purpose', value: card.purpose });
  if (card.example_variables.length) steps.push({ id: 'variables', value: card.example_variables });
  const tested = (card.access_steps ?? []).find((step) => step.tested === true) ?? card.access_steps[0];
  if (tested) steps.push({ id: 'tested_access_step', value: tested });
  const caveatPages = (card.unknowns ?? []).filter((item) => item.full_page_section === true);
  return freeze({
    steps: freeze(steps),
    complete: steps.some((step) => step.id === 'purpose') && steps.some((step) => step.id === 'variables') && steps.some((step) => step.id === 'tested_access_step'),
    searches_repeated_caveats: caveatPages.length > 0,
  });
}

export const CARDS = Object.freeze({
  hcris: buildSourceCard({
    source_id: 'cms-hcris',
    purpose: 'Hospital cost-report financial worksheets for Medicare-certified facilities.',
    coverage: 'Medicare-certified hospitals filing HCRIS cost reports.',
    grain: 'facility/report/year',
    example_variables: ['net_patient_revenue', 'ccn'],
    access_steps: [{ sequence: 1, instruction: 'Open the CMS HCRIS hospital cost report page.', tested: true }],
    tested_state: 'metadata_route_validated',
    limits: ['Catalog membership is not payload access.', 'Fiscal year is not a calendar year.'],
    citation: 'CMS Healthcare Cost Report Information System (HCRIS).',
    documented_use: ['Facility-level Medicare cost-report research'],
    reviewed_recommendation: [],
    unsupported_use: ['Person-level clinical outcomes'],
    claims: [{ text: 'HCRIS hospital cost reports are filed by CCN and fiscal year.', evidence_ids: ['ev:hcris:grain'], publisher_passage: 'Hospital cost reports are submitted by provider number for a cost reporting period.' }],
    release_id: 'hcris:hospital:2022',
    schema_id: 'hcris:worksheet-g3',
    example_ids: ['ex:hcris:npr'],
    beginner_guide_id: 'guide:hcris:beginner',
    expert_guide_id: 'guide:hcris:expert',
    unknowns: ['complete row inventory'],
  }),
  places: buildSourceCard({
    source_id: 'cdc-places',
    purpose: 'County-level chronic disease prevalence estimates.',
    coverage: 'US counties in CDC PLACES.',
    grain: 'county/measure/year',
    example_variables: ['obesity_prevalence'],
    access_steps: [{ sequence: 1, instruction: 'Open the CDC PLACES data portal.', tested: true }],
    tested_state: 'metadata_route_validated',
    limits: ['Estimates are model-based.', 'Age-adjusted prevalence is not a crude rate.'],
    citation: 'CDC PLACES: Local Data for Better Health.',
    documented_use: ['County public-health prevalence comparisons'],
    reviewed_recommendation: [],
    unsupported_use: ['Hospital facility financial analysis'],
    claims: [{ text: 'PLACES publishes county measure-year prevalence estimates.', evidence_ids: ['ev:places:grain'], publisher_passage: 'PLACES provides model-based estimates for counties and census tracts.' }],
    release_id: 'places:2023',
    schema_id: 'places:county-measure',
    example_ids: ['ex:places:obesity'],
    beginner_guide_id: 'guide:places:beginner',
    expert_guide_id: 'guide:places:expert',
    unknowns: ['tract-level fitness for a specific local question'],
  }),
});
