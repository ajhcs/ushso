import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { loadBenchmark } from '../tools/benchmark-loader.mjs';
import { PACKAGE_ROOT } from '../tools/integrity.mjs';

test('direct benchmark pins load the frozen semantic payload and counts', async () => {
  const benchmark = await loadBenchmark();
  assert.equal(benchmark.questions.length, 60);
  assert.equal(benchmark.positives.length, 115);
  assert.equal(benchmark.negatives.length, 82);
  assert.equal(benchmark.sourceIndex.sources.length, 36);
  assert.deepEqual(Object.fromEntries(Object.entries(benchmark.splits.splits).map(([name, ids]) => [name, ids.length])), {
    development: 20,
    validation: 20,
    held_out: 20
  });
  assert.equal(benchmark.pin.files.length, 10);
  assert.equal(benchmark.pin.files.some(file => file.path === 'validation_report.json'), false);
  assert.equal(benchmark.pin.files.some(file => file.path === 'package_manifest.json'), false);
});

test('all evaluator schemas compile as draft 2020-12 contracts', async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const name of ['runner-input.schema.json', 'present-source-cohort.schema.json', 'run-report.schema.json']) {
    const schema = JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, 'schemas', name), 'utf8'));
    assert.doesNotThrow(() => ajv.compile(schema), name);
  }
});
