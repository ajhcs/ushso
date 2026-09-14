import assert from 'node:assert/strict';
import test from 'node:test';
import { createMachineCursorSigner } from '../../worker/machine-cursor.mjs';
import { createStaticMachineToolkitRuntime } from '../../worker/static-machine-toolkit-service.mjs';
import { createMachineToolkit } from '../../packages/machine-toolkit/src/index.mjs';
import {
  HCRIS_DISTRIBUTION_ID,
  HCRIS_HOSPITAL_COST_REPORT_ID,
  HCRIS_RELEASE_ID,
  HCRIS_SCHEMA_ID,
  PLACES_154_RECORD_ID,
  PLACES_DISTRIBUTION_ID,
  PLACES_RELEASE_ID,
  PLACES_SCHEMA_ID,
  QUALIFIED_VARIABLE_CONTEXTS,
  dictionaryProposalStatus,
  filterQualifiedFields,
  matchQualifiedVariableContext,
  suppliedSchemaDoesNotEstablishApplicability,
} from '../../packages/registry/qualified-variable-contexts.mjs';

const generation = 'live-2026-09-03-85b50522b420';
const hcris = QUALIFIED_VARIABLE_CONTEXTS.find((row) => row.record_id === HCRIS_HOSPITAL_COST_REPORT_ID);
const places = QUALIFIED_VARIABLE_CONTEXTS.find((row) => row.record_id === PLACES_154_RECORD_ID);

function record({ record_id, title, source_id, source_name, evidence_id }) {
  return {
    record_id,
    title,
    identity: { source: { source_id, name: source_name } },
    evidence: [{ evidence_id }],
    freshness_verification: { metadata_observed_at: '2026-09-03T22:22:33.908Z', verification_status: 'current_verified' },
  };
}

const records = [
  record({
    record_id: HCRIS_HOSPITAL_COST_REPORT_ID,
    title: 'Hospital Provider Cost Report',
    source_id: 'cms-data-catalog',
    source_name: 'CMS Data Catalog',
    evidence_id: 'evidence:cms-data-catalog:bf696c5e94f4146abe7ad61b',
  }),
  record({
    record_id: PLACES_154_RECORD_ID,
    title: 'PLACES 154-field fixture',
    source_id: 'cdc-socrata',
    source_name: 'CDC Socrata',
    evidence_id: 'evidence.places.154',
  }),
];

function toolkit(signer = createMachineCursorSigner({ signingKey: 'pr057-variables-cursor-key-32bytes' })) {
  const runtime = createStaticMachineToolkitRuntime({
    records,
    corpus: {
      corpus_version: '1.2.0',
      manifest_sha256: 'a'.repeat(64),
      publication: { generation, observed_at: '2026-09-03T22:22:33.908Z' },
    },
  }, { cursorSigner: signer });
  return createMachineToolkit({ service: runtime.operations, responseContext: runtime.context });
}

function variablesInput(overrides = {}) {
  return {
    contract_version: 'observatory.machine.get-variables.input.v1.0.0',
    record_id: HCRIS_HOSPITAL_COST_REPORT_ID,
    release_id: HCRIS_RELEASE_ID,
    distribution_id: HCRIS_DISTRIBUTION_ID,
    schema_id: HCRIS_SCHEMA_ID,
    semantic_query: null,
    filters: [],
    limit: 25,
    cursor: null,
    expected_generation: generation,
    ...overrides,
  };
}

test('the positive HCRIS fixture uses accepted wire mappings; unapproved documentation does not leak into the canonical schema', async () => {
  const tk = toolkit();
  const response = await tk.invokeJsonApi('get_variables', variablesInput());
  assert.equal(response.ok, true, JSON.stringify(response.error));
  assert.equal(response.result.schema_id, HCRIS_SCHEMA_ID);
  assert.deepEqual(response.result.fields.map((field) => field.native_name), ['PROVNUM', 'NET_PATIENT_REVENUE']);
  assert.equal(response.result.fields[0].data_type, 'string');
  assert.equal(response.result.fields[1].data_type, 'number');
  assert.equal(hcris.unapproved_documentation_leaked, false);
  assert.equal(response.result.fields.every((field) => field.limitations.some((row) => row.includes('Unapproved dictionary documentation is not a canonical field'))), true);
  const fake = await tk.invokeJsonApi('get_variables', variablesInput({ schema_id: 'schema.fake' }));
  assert.equal(fake.ok, false);
  assert.equal(fake.error.code, 'schema_context_required');
  assert.equal(suppliedSchemaDoesNotEstablishApplicability({
    record_id: HCRIS_HOSPITAL_COST_REPORT_ID,
    release_id: HCRIS_RELEASE_ID,
    distribution_id: HCRIS_DISTRIBUTION_ID,
    schema_id: 'schema.fake',
  }), true);
  assert.equal(matchQualifiedVariableContext({
    record_id: HCRIS_HOSPITAL_COST_REPORT_ID,
    release_id: HCRIS_RELEASE_ID,
    distribution_id: HCRIS_DISTRIBUTION_ID,
    schema_id: 'schema.fake',
  }), null);
});

test('a 154-field dictionary traverses without omissions or duplicates; oversized fields retain their documented retrieval path', async () => {
  assert.equal(places.fields.length, 154);
  assert.equal(new Set(places.fields.map((field) => field.native_name)).size, 154);
  const signer = createMachineCursorSigner({ signingKey: 'pr057-variables-cursor-key-32bytes' });
  const tk = toolkit(signer);
  const ids = [];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const response = await tk.invokeJsonApi('get_variables', {
      ...variablesInput({
        record_id: PLACES_154_RECORD_ID,
        release_id: PLACES_RELEASE_ID,
        distribution_id: PLACES_DISTRIBUTION_ID,
        schema_id: PLACES_SCHEMA_ID,
        limit: 50,
        cursor,
      }),
    });
    assert.equal(response.ok, true, JSON.stringify(response.error));
    ids.push(...response.result.fields.map((field) => field.native_name));
    if (!response.truncated) {
      assert.equal(response.next_cursor, null);
      break;
    }
    cursor = response.next_cursor;
    assert.ok(cursor);
  }
  assert.deepEqual(ids, places.fields.map((field) => field.native_name));
  assert.equal(new Set(ids).size, 154);
  const filtered = filterQualifiedFields(places, { semantic_query: 'stateabbr' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].native_name, 'stateabbr');
  const named = filterQualifiedFields(places, { filters: [{ dimension: 'native_name', values: ['stateabbr'] }] });
  assert.equal(named[0].label, 'StateAbbr');
  assert.match(places.fields[0].limitations.join(' '), /retrieval path|Wire names/i);
});

test('a known dictionary proposal is visible as a proposal, while get_variables remains honest about an unbound schema', async () => {
  const proposal = dictionaryProposalStatus({ record_id: HCRIS_HOSPITAL_COST_REPORT_ID, known: true });
  assert.equal(proposal.proposal_visible, true);
  assert.equal(proposal.publication_authorized, false);
  assert.equal(proposal.scientific_status_changed, false);
  assert.equal(proposal.review_status, 'pending_owner_review');
  assert.match(proposal.inspect_path, /dictionary-review/);
  const tk = toolkit();
  const unbound = await tk.invokeJsonApi('get_variables', variablesInput({
    release_id: null,
    distribution_id: null,
    schema_id: null,
  }));
  assert.equal(unbound.ok, false);
  assert.equal(unbound.error.code, 'schema_context_required');
  assert.equal(unbound.result_state, 'unknown');
  assert.match(unbound.error.corrective_guidance, /get_asset|schema/i);
  assert.doesNotMatch(unbound.error.corrective_guidance, /Retry later/i);
  const invented = await tk.invokeJsonApi('get_variables', variablesInput({ schema_id: 'schema.invented' }));
  assert.equal(invented.error.code, 'schema_context_required');
  assert.equal(invented.result, null);
});
