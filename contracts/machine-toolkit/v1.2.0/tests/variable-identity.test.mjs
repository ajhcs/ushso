import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVariableIdentityValidator,
  SCHEMA_ID,
  SCHEMA_VERSION,
} from '../tools/verify.mjs';

const evidence = ['evidence:machine-toolkit-v1.2:test'];
const digest = 'a'.repeat(64);
const resolvedContext = {
  state: 'resolved',
  binding_state: 'exact',
  source_id: 'urn:ushso:source:package-test',
  asset_id: 'urn:ushso:asset:package-test',
  release_id: 'urn:ushso:release:package-test',
  distribution_id: 'urn:ushso:distribution:package-test',
  schema_snapshot_id: 'urn:ushso:schema:package-test',
  schema_field_id: 'urn:ushso:field:package-test',
  field_revision_id: 'urn:ushso:revision:package-test',
  reason: null,
};

const base = {
  schema_version: SCHEMA_VERSION,
  variable_id: `urn:ushso:variable:${'b'.repeat(32)}`,
  context_binding: resolvedContext,
  wire_name: 'ZIP',
  publisher_label: 'Postal code',
  publisher_concept: 'A postal identifier',
  definition: 'The publisher-described postal code.',
  source_type: { state: 'documented', value: 'string', evidence_ids: evidence },
  observed_type: { state: 'observed', value: 'string', evidence_ids: evidence },
  semantic_role: 'identifier',
  unit: {
    state: 'not_applicable',
    value: null,
    rationale: 'Identifiers have no measurement unit.',
    evidence_ids: evidence,
  },
  code_values: {
    state: 'documented',
    values: [
      { code: '00123', label: 'Éxample' },
      { code: '—', label: 'Suppressed' },
    ],
    evidence_ids: evidence,
  },
  missingness: {
    state: 'documented',
    values: [{ code: '-1', label: 'Not in universe' }],
    evidence_ids: evidence,
  },
  mapping: {
    state: 'exact',
    documented_name: 'ZIP',
    wire_name: 'ZIP',
    candidate_wire_names: [],
    evidence_ids: [],
  },
  provenance: {
    source_locator: 'https://example.test/variables.json',
    pointer: '/variables/ZIP',
    capture_sha256: digest,
    raw_value_sha256: 'c'.repeat(64),
    transformation: { name: 'machine_toolkit_v1_2_test', version: '1.0.0' },
    evidence_ids: evidence,
  },
  evidence_ids: evidence,
  evidence_state: 'documented',
  completeness: 'complete',
  limitations: ['Offline package fixture only.'],
  publication_authorized: false,
  promotion_eligible: false,
};

function valid(validator, value) {
  assert.equal(validator(value), true, JSON.stringify(validator.errors));
}

function invalid(validator, value) {
  assert.equal(validator(value), false, 'expected schema rejection');
}

test('verifier compiles the local closed schema and preserves literal semantics', async () => {
  const loaded = await createVariableIdentityValidator();
  assert.equal(loaded.schema.$id, SCHEMA_ID);
  assert.equal(loaded.schema.additionalProperties, false);
  valid(loaded.validate, base);
  assert.equal(base.publisher_concept, 'A postal identifier');
  assert.equal(base.definition, 'The publisher-described postal code.');
  assert.deepEqual(base.code_values.values.map(value => value.code), ['00123', '—']);
  assert.equal(base.publication_authorized, false);
  assert.equal(base.promotion_eligible, false);
});

test('closed boundary rejects unauthorized fields and publication claims', async () => {
  const { validate } = await createVariableIdentityValidator();
  invalid(validate, { ...base, unexpected: true });
  invalid(validate, { ...base, publication_authorized: true });
  invalid(validate, { ...base, promotion_eligible: true });
});

test('unresolved and ambiguous mappings cannot carry a stable identity', async () => {
  const { validate } = await createVariableIdentityValidator();
  const unresolved = {
    ...base,
    variable_id: null,
    context_binding: {
      state: 'unresolved',
      binding_state: 'unresolved',
      source_id: null,
      asset_id: null,
      release_id: null,
      distribution_id: null,
      schema_snapshot_id: null,
      schema_field_id: null,
      field_revision_id: null,
      reason: 'Release and schema context remain unresolved.',
    },
    wire_name: null,
    mapping: {
      state: 'unmatched',
      documented_name: 'Dictionary-only name',
      wire_name: null,
      candidate_wire_names: [],
      evidence_ids: [],
    },
  };
  valid(validate, unresolved);
  invalid(validate, { ...unresolved, variable_id: base.variable_id });

  const ambiguous = {
    ...base,
    variable_id: null,
    wire_name: null,
    mapping: {
      state: 'ambiguous',
      documented_name: 'FTE – Employees on Payroll',
      wire_name: null,
      candidate_wire_names: ['FTE - Employees on Payroll'],
      evidence_ids: evidence,
    },
  };
  valid(validate, ambiguous);
  invalid(validate, { ...ambiguous, variable_id: base.variable_id });
});

test('mapping states preserve exact and reviewed literal alternatives', async () => {
  const { validate } = await createVariableIdentityValidator();
  valid(validate, base);
  valid(validate, {
    ...base,
    wire_name: 'Wage-Related Costs',
    mapping: {
      state: 'reviewed_alias',
      documented_name: 'Wage – Related Costs',
      wire_name: 'Wage-Related Costs',
      candidate_wire_names: ['Wage-Related Costs'],
      evidence_ids: evidence,
    },
  });
  invalid(validate, {
    ...base,
    mapping: {
      state: 'reviewed_alias',
      documented_name: 'Wage – Related Costs',
      wire_name: 'Wage-Related Costs',
      candidate_wire_names: [],
      evidence_ids: [],
    },
  });
});

test('identifier N/A differs from measurement missing or unknown units', async () => {
  const { validate } = await createVariableIdentityValidator();
  valid(validate, base);

  const missing = {
    ...base,
    variable_id: `urn:ushso:variable:${'d'.repeat(32)}`,
    wire_name: 'AMOUNT',
    publisher_label: 'Amount',
    semantic_role: 'measure',
    unit: { state: 'missing', value: null, rationale: null, evidence_ids: [] },
    mapping: { ...base.mapping, documented_name: 'AMOUNT', wire_name: 'AMOUNT' },
    completeness: 'incomplete',
  };
  valid(validate, missing);
  invalid(validate, { ...missing, completeness: 'complete' });

  const unknown = {
    ...missing,
    variable_id: `urn:ushso:variable:${'e'.repeat(32)}`,
    wire_name: 'TOTAL',
    publisher_label: 'Total',
    unit: { state: 'unknown', value: null, rationale: null, evidence_ids: [] },
    mapping: { ...missing.mapping, documented_name: 'TOTAL', wire_name: 'TOTAL' },
    completeness: 'unknown',
  };
  valid(validate, unknown);
  invalid(validate, { ...unknown, completeness: 'complete' });
  invalid(validate, { ...missing, unit: undefined });
  invalid(validate, {
    ...base,
    semantic_role: 'measure',
    unit: { ...base.unit },
  });
});
