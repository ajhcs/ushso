import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReceipt } from '../tools/build-receipt.mjs';
import { validateReceipt } from '../tools/validate-receipt.mjs';

test('WP10A technical receipt and all component seals validate', async () => {
  const result = await validateReceipt();
  assert.equal(result.status, 'PASS');
  assert.equal(result.technical_status, 'PASS');
  assert.equal(result.held_out_scoring_performed, false);
});

test('receipt separately seals every required planner gold component for every split', async () => {
  const receipt = await buildReceipt({ write: false });
  const required = ['questions', 'status_reason_codes', 'required_asset_contributions', 'operations', 'blockers', 'coverage', 'acquisition_dags'];
  for (const split of ['development', 'validation', 'held_out']) {
    assert.deepEqual(Object.keys(receipt.component_seals[split]), required);
    for (const component of Object.values(receipt.component_seals[split])) {
      assert.match(component.sha256, /^[a-f0-9]{64}$/u);
      assert.equal(component.records, 50);
    }
  }
});

test('technical completion cannot be mistaken for missing owner authorization', async () => {
  const receipt = await buildReceipt({ write: false });
  assert.equal(receipt.wp10a_artifact_freeze_complete, true);
  assert.equal(receipt.governance_status, 'PENDING_REQUIRED_OWNER_RATIFICATION');
  assert.equal(receipt.wp10b_authorized, false);
  assert.deepEqual(receipt.governance.role_statuses, {
    product: 'pending',
    research_methods: 'pending',
    engineering: 'pending'
  });
});
