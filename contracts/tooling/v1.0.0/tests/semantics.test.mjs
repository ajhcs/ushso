import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAcyclic, findDirectedCycles, GraphValidationError, topologicalSort } from '../src/graph.mjs';
import { resolveClaimPointers, resolveEvidenceClaims, resolveJsonPointer } from '../src/evidence.mjs';

test('topological helpers are deterministic and reject cycles or dangling edges', () => {
  assert.deepEqual(topologicalSort(['c', 'a', 'b'], [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }]), ['a', 'b', 'c']);
  assert.deepEqual(findDirectedCycles(['a', 'b', 'c'], [['a', 'b'], ['b', 'a'], ['c', 'c']]), [['a', 'b'], ['c']]);
  assert.throws(() => assertAcyclic(['a', 'b'], [['a', 'b'], ['b', 'a']]), error => error instanceof GraphValidationError && error.code === 'GRAPH_CYCLE');
  assert.throws(() => topologicalSort(['a'], [['a', 'missing']]), error => error instanceof GraphValidationError && error.code === 'GRAPH_EDGE_NODE_MISSING');
  assert.throws(() => topologicalSort(['a', 'b'], [['a', 'b'], ['a', 'b']]), error => error instanceof GraphValidationError && error.code === 'GRAPH_DUPLICATE_EDGE');
});

test('research-plan claim pointers resolve only auditable non-transport claims', () => {
  const claimManifest = {
    auditable_roots: ['/asset_contributions'],
    critical_claims: [
      { claim_id: 'status', json_pointer: '/plan_status' },
      { claim_id: 'assets', json_pointer: '/asset_contributions' }
    ],
    transport_only_pointers: ['/request_id']
  };
  const result = resolveClaimPointers({
    claimDocument: { request_id: 'req', plan_status: 'ready', asset_contributions: [{ asset_id: 'a' }] },
    claimManifest,
    evidenceReferences: [
      { evidence_reference_id: 'ref:1', evidence_id: 'ev:1', claim_pointers: ['/plan_status', '/asset_contributions/0'] },
      { evidence_reference_id: 'ref:2', evidence_id: 'ev:2', claim_pointers: ['/request_id'] }
    ]
  });
  assert.equal(result.critical_coverage_complete, true);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'CLAIM_POINTER_TRANSPORT_ONLY');
});

test('JSON Pointer and evidence claims resolve exact values and retain failures', () => {
  assert.equal(resolveJsonPointer({ 'a/b': { '~key': 7 } }, '/a~1b/~0key'), 7);
  const result = resolveEvidenceClaims({
    evidence: [{ evidence_id: 'ev:1', document: { claims: [{ state: 'verified' }] } }],
    claims: [
      { claim_id: 'claim:1', evidence_refs: [{ evidence_id: 'ev:1', pointer: '/claims/0/state' }] },
      { claim_id: 'claim:2', evidence_refs: [{ evidence_id: 'ev:missing', pointer: '' }] }
    ]
  });
  assert.equal(result.ok, false);
  assert.equal(result.resolved[0].references[0].value, 'verified');
  assert.equal(result.errors[0].code, 'EVIDENCE_REFERENCE_UNRESOLVED');
});
