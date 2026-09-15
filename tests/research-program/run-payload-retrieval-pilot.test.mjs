import assert from 'node:assert/strict';
import test from 'node:test';
import { runPayloadRetrievalPilot } from '../../scripts/research-program/run-payload-retrieval-pilot.mjs';

test('payload retrieval pilot does not fetch unless --execute is set', async () => {
  await assert.rejects(() => runPayloadRetrievalPilot({ execute: false }), { code: 'PILOT_EXECUTE_FLAG_REQUIRED' });
});
