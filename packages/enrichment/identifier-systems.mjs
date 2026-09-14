export const IDENTIFIER_POLICY_VERSION = 'ushso.identifier-systems.v1';

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

export const SYSTEMS = Object.freeze({
  ccn: freeze({ id: 'ccn', entity: 'medicare_provider', format: '^\\d{6}$', preserve_leading_zeros: true, pad_width: 6 }),
  npi: freeze({ id: 'npi', entity: 'npi_organization_or_individual', format: '^\\d{10}$', preserve_leading_zeros: true, pad_width: 10 }),
  fips: freeze({ id: 'fips', entity: 'geography', format: '^\\d{2,15}$', preserve_leading_zeros: true, vintage_required: true }),
  geoid: freeze({ id: 'geoid', entity: 'geography', format: '^\\d{2,15}$', preserve_leading_zeros: true, vintage_required: true }),
  source_report_id: freeze({ id: 'source_report_id', entity: 'source_report', format: '.+', preserve_leading_zeros: true }),
  tax_identifier: freeze({ id: 'tax_identifier', entity: 'organization', format: '.+', preserve_leading_zeros: true }),
  plan_identifier: freeze({ id: 'plan_identifier', entity: 'health_plan', format: '.+', preserve_leading_zeros: true }),
});

export function preserveLeadingZeros(value, systemId) {
  const system = SYSTEMS[systemId];
  if (!system) fail('UNKNOWN_IDENTIFIER_SYSTEM', systemId);
  const raw = String(value ?? '');
  if (system.pad_width && /^\d+$/.test(raw.replace(/^0+/, '') || '0')) {
    return raw.padStart(system.pad_width, '0');
  }
  return raw;
}

export function defineIdentifier({ system, value, entity, valid_from = null, valid_to = null } = {}) {
  const spec = SYSTEMS[system];
  if (!spec) fail('UNKNOWN_IDENTIFIER_SYSTEM', system);
  const preserved = preserveLeadingZeros(value, system);
  if (spec.preserve_leading_zeros && String(value).startsWith('0') && !preserved.startsWith('0') && preserved.length >= String(value).length) {
    fail('LEADING_ZERO_LOST');
  }
  return freeze({
    format: 'ushso.typed-identifier.v1',
    system,
    value: preserved,
    raw: String(value),
    entity: entity ?? spec.entity,
    valid_from,
    valid_to,
    interchangeable_with: freeze([]),
  });
}

export function matchIdentifiers(left, right, { at = null } = {}) {
  if (left.system !== right.system) {
    return freeze({ exact: false, identity_established: false, reason: 'DIFFERENT_IDENTIFIER_SYSTEMS', left: left.system, right: right.system });
  }
  if (left.value !== right.value) {
    return freeze({ exact: false, identity_established: false, reason: 'VALUE_MISMATCH' });
  }
  if (at) {
    const inLeft = (!left.valid_from || at >= left.valid_from) && (!left.valid_to || at < left.valid_to);
    const inRight = (!right.valid_from || at >= right.valid_from) && (!right.valid_to || at < right.valid_to);
    if (!inLeft || !inRight) {
      return freeze({ exact: false, identity_established: false, reason: 'OUTSIDE_APPLICABILITY_PERIOD', status: 'ambiguous_or_incompatible' });
    }
  }
  return freeze({ exact: true, identity_established: true, reason: 'SAME_SYSTEM_AND_VALUE' });
}

export function attachKeyRole(field, { role, evidence_scope, documentation = null, sample_unique = false } = {}) {
  const allowed = new Set(['candidate_key', 'composite_key', 'foreign_key', 'display_label']);
  if (!allowed.has(role)) fail('UNKNOWN_KEY_ROLE', role);
  if (!documentation && evidence_scope !== 'sampled' && evidence_scope !== 'full_release') fail('KEY_ROLE_EVIDENCE_REQUIRED');
  if (sample_unique === true && evidence_scope === 'full_release') fail('SAMPLE_UNIQUENESS_NOT_GLOBAL');
  return freeze({
    field,
    role,
    evidence_scope,
    documentation,
    sample_unique,
    globally_certified: evidence_scope === 'full_release',
    composite: role === 'composite_key',
  });
}

export function refuseNameMerge({ left_name, right_name } = {}) {
  if (left_name && right_name && left_name === right_name) {
    return freeze({ merged: false, reason: 'NAME_BASED_MERGE_FORBIDDEN' });
  }
  return freeze({ merged: false, reason: 'NAME_BASED_MERGE_FORBIDDEN' });
}

export const FIXTURES = Object.freeze({
  ccn: defineIdentifier({ system: 'ccn', value: '012345', entity: 'medicare_provider' }),
  npi: defineIdentifier({ system: 'npi', value: '0123456789', entity: 'npi_organization_or_individual' }),
  same_digits_ccn: defineIdentifier({ system: 'ccn', value: '123456', entity: 'medicare_provider' }),
  same_digits_npi: defineIdentifier({ system: 'npi', value: '123456', entity: 'npi_organization_or_individual' }),
  composite: attachKeyRole(['facility', 'report', 'year'], { role: 'composite_key', evidence_scope: 'sampled', documentation: 'HCRIS facility/report/year', sample_unique: true }),
  retired: defineIdentifier({ system: 'ccn', value: '000001', entity: 'medicare_provider', valid_from: '2000-01-01', valid_to: '2010-01-01' }),
  reused: defineIdentifier({ system: 'ccn', value: '000001', entity: 'medicare_provider', valid_from: '2015-01-01', valid_to: null }),
});
