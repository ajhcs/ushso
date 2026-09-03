import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadStrategyManifest,
  parseStrategyManifestText,
  validateManifestDocument,
  validateStrategyPackage
} from './strategy-evidence.mjs';

function cloned(value) {
  return structuredClone(value);
}

export function registerStrategyEvidenceTests(strategyKey) {
  test(`${strategyKey} strategy package validates exact offline evidence`, async () => {
    const summary = await validateStrategyPackage(strategyKey);
    assert.equal(summary.status, 'PASS');
    assert.equal(summary.structural_status, 'PASS');
    assert.equal(summary.release_readiness, 'BLOCKED');
    assert.equal(summary.external_actions, 0);
  });

  test(`${strategyKey} rejects duplicate and missing controls`, async (context) => {
    const manifest = await loadStrategyManifest(strategyKey);
    await context.test('duplicate', async () => {
      const duplicate = cloned(manifest);
      duplicate.controls.push(cloned(duplicate.controls[0]));
      await assert.rejects(validateManifestDocument(duplicate, strategyKey, { verifyEvidence: false }), /CONTROL_COUNT_MISMATCH|CONTROL_ID_DUPLICATE/u);
    });
    await context.test('missing', async () => {
      const missing = cloned(manifest);
      missing.controls.pop();
      await assert.rejects(validateManifestDocument(missing, strategyKey, { verifyEvidence: false }), /CONTROL_COUNT_MISMATCH/u);
    });
  });

  test(`${strategyKey} rejects traversal, stale hashes, and evasive tampering`, async (context) => {
    const manifest = await loadStrategyManifest(strategyKey);
    await context.test('path traversal', async () => {
      const traversal = cloned(manifest);
      traversal.controls[0].evidence[0].path = '../outside.test.mjs';
      await assert.rejects(validateManifestDocument(traversal, strategyKey), /EVIDENCE_PATH_UNSAFE|EVIDENCE_PATH_PREFIX_FORBIDDEN/u);
    });
    await context.test('missing evidence path', async () => {
      const missingPath = cloned(manifest);
      missingPath.controls[0].evidence[0].path = 'packages/__missing_strategy_evidence__/tests/missing.test.mjs';
      await assert.rejects(validateManifestDocument(missingPath, strategyKey), /EVIDENCE_PATH_MISSING/u);
    });
    await context.test('stale exact byte hash', async () => {
      const stale = cloned(manifest);
      stale.controls[0].evidence[0].sha256 = '0'.repeat(64);
      await assert.rejects(validateManifestDocument(stale, strategyKey), /EVIDENCE_HASH_STALE/u);
    });
    await context.test('evasive statement', async () => {
      const evasive = cloned(manifest);
      evasive.controls[0].statement = 'Best effort tests as needed.';
      await assert.rejects(validateManifestDocument(evasive, strategyKey, { verifyEvidence: false }), /CONTROL_STATEMENT_MISMATCH|CONTROL_STATEMENT_EVASIVE/u);
    });
  });

  test(`${strategyKey} rejects false readiness and any claimed side effect`, async (context) => {
    const manifest = await loadStrategyManifest(strategyKey);
    await context.test('false release readiness', async () => {
      const ready = cloned(manifest);
      ready.release_readiness = 'READY';
      await assert.rejects(validateManifestDocument(ready, strategyKey, { verifyEvidence: false }), /FALSE_RELEASE_READINESS/u);
    });
    for (const field of ['repository_writes', 'receipt_writes', 'network_calls', 'external_actions']) {
      await context.test(field, async () => {
        const sideEffect = cloned(manifest);
        sideEffect.execution_policy[field] = 1;
        await assert.rejects(validateManifestDocument(sideEffect, strategyKey, { verifyEvidence: false }), /MUST_BE_ZERO/u);
      });
    }
  });

  test(`${strategyKey} strict manifest parser rejects duplicate decoded keys`, () => {
    assert.throws(
      () => parseStrategyManifestText('{"schema_version":"one","schema_version":"two"}'),
      /JSON_DUPLICATE_KEY/u
    );
  });
}
