export const QUALIFIED_VARIABLE_CONTEXTS_VERSION = 'ushso.qualified-variable-contexts.v1';
export const HCRIS_HOSPITAL_COST_REPORT_ID = 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17';
export const HCRIS_RELEASE_ID = 'release.cms.hcris.documentation';
export const HCRIS_DISTRIBUTION_ID = 'distribution.cms.hcris.landing-page';
export const HCRIS_SCHEMA_ID = 'schema.cms.hcris.worksheet-g3.accepted';
export const PLACES_154_RECORD_ID = 'asset.places.154.fixture';
export const PLACES_RELEASE_ID = 'release.cdc.places.acs';
export const PLACES_DISTRIBUTION_ID = 'distribution.cdc.places.columns';
export const PLACES_SCHEMA_ID = 'schema.cdc.places.154';
export const DICTIONARY_PROPOSAL_PATH = '/api/research/v1/dictionary-review';

function freeze(value) {
  return Object.freeze(value);
}

function field({ schema_field_id, label, description, native_name, data_type, unit = null, allowed_values = [], code_system = null, semantic_role, identifier_namespace = null, evidence_ids, limitations }) {
  return freeze({
    schema_field_id,
    label,
    description,
    native_name,
    data_type,
    unit,
    allowed_values: freeze([...allowed_values]),
    code_system,
    semantic_role,
    identifier_namespace,
    evidence_ids: freeze([...evidence_ids]),
    limitations: freeze([...limitations]),
  });
}

const HCRIS_EVIDENCE = freeze(['evidence:cms-data-catalog:bf696c5e94f4146abe7ad61b']);
const HCRIS_LIMITS = freeze([
  'Accepted example-packet wire mappings only. Not full HCRIS schema validation.',
  'Catalog membership is not payload access.',
  'Unapproved dictionary documentation is not a canonical field.',
]);

const HCRIS_FIELDS = freeze([
  field({
    schema_field_id: 'field.hcris.PROVNUM',
    label: 'Provider number',
    description: 'CMS Certification Number / provider number on the hospital cost report.',
    native_name: 'PROVNUM',
    data_type: 'string',
    semantic_role: 'identifier',
    identifier_namespace: 'cms.ccn',
    evidence_ids: HCRIS_EVIDENCE,
    limitations: HCRIS_LIMITS,
  }),
  field({
    schema_field_id: 'field.hcris.NET_PATIENT_REVENUE',
    label: 'Net patient revenue',
    description: 'Net patient revenue from HCRIS Worksheet G-3 as used in the accepted example packet.',
    native_name: 'NET_PATIENT_REVENUE',
    data_type: 'number',
    semantic_role: 'measure_description',
    evidence_ids: HCRIS_EVIDENCE,
    limitations: HCRIS_LIMITS,
  }),
]);

function placesField(index) {
  const native = index === 0 ? 'stateabbr' : `places_field_${String(index).padStart(3, '0')}`;
  const label = index === 0 ? 'StateAbbr' : `PLACES field ${index}`;
  return field({
    schema_field_id: `field.places.${native}`,
    label,
    description: index === 0 ? 'State abbreviation from the retained PLACES 154-field CDC view fixture.' : `Indexed PLACES column ${index} retained for traversal completeness.`,
    native_name: native,
    data_type: 'string',
    semantic_role: index === 0 ? 'geography' : 'metadata',
    evidence_ids: freeze(['evidence.places.154']),
    limitations: freeze([
      'Wire names are preserved from the PLACES 154-field fixture.',
      'Geography completeness is not claimed.',
      'Person-level grain is not claimed.',
    ]),
  });
}

const PLACES_FIELDS = freeze(Array.from({ length: 154 }, (_, index) => placesField(index)));

export const QUALIFIED_VARIABLE_CONTEXTS = freeze([
  freeze({
    record_id: HCRIS_HOSPITAL_COST_REPORT_ID,
    release_id: HCRIS_RELEASE_ID,
    distribution_id: HCRIS_DISTRIBUTION_ID,
    schema_id: HCRIS_SCHEMA_ID,
    schema_completeness: 'complete',
    scientific_status: 'example_packet_wire_mapping',
    unapproved_documentation_leaked: false,
    fields: HCRIS_FIELDS,
  }),
  freeze({
    record_id: PLACES_154_RECORD_ID,
    release_id: PLACES_RELEASE_ID,
    distribution_id: PLACES_DISTRIBUTION_ID,
    schema_id: PLACES_SCHEMA_ID,
    schema_completeness: 'complete',
    scientific_status: 'indexed_fixture',
    unapproved_documentation_leaked: false,
    fields: PLACES_FIELDS,
  }),
]);

export function matchQualifiedVariableContext(input = {}) {
  return QUALIFIED_VARIABLE_CONTEXTS.find((context) => (
    context.record_id === input.record_id
    && context.release_id === input.release_id
    && context.distribution_id === input.distribution_id
    && context.schema_id === input.schema_id
  )) ?? null;
}

export function suppliedSchemaDoesNotEstablishApplicability(input = {}) {
  return Boolean(input.schema_id) && matchQualifiedVariableContext(input) == null;
}

function matchesQuery(field, semanticQuery) {
  if (!semanticQuery) return true;
  const needle = semanticQuery.toLowerCase();
  return field.native_name.toLowerCase() === needle
    || field.label.toLowerCase() === needle
    || field.schema_field_id.toLowerCase() === needle;
}

function matchesFilters(field, filters = []) {
  for (const filter of filters) {
    if (filter.dimension === 'native_name' && !filter.values.includes(field.native_name)) return false;
    if (filter.dimension === 'semantic_role' && !filter.values.includes(field.semantic_role)) return false;
  }
  return true;
}

export function filterQualifiedFields(context, { semantic_query = null, filters = [] } = {}) {
  return freeze(context.fields.filter((field) => matchesQuery(field, semantic_query) && matchesFilters(field, filters)));
}

export function oversizedFieldRetrievalPath(field) {
  return freeze({
    schema_field_id: field.schema_field_id,
    native_name: field.native_name,
    retrieval_path: `${DICTIONARY_PROPOSAL_PATH}?field=${field.schema_field_id}`,
    truncated_in_page: true,
  });
}

export function dictionaryProposalStatus({ record_id, known = false } = {}) {
  return freeze({
    record_id,
    review_status: known ? 'pending_owner_review' : 'none',
    publication_authorized: false,
    scientific_status_changed: false,
    proposal_visible: known,
    inspect_path: known ? `${DICTIONARY_PROPOSAL_PATH}?record_id=${encodeURIComponent(record_id)}` : null,
  });
}
