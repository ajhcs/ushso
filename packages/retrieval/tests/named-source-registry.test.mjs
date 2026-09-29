import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuestion } from '../tools/question-parser-v1.2.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(fs.readFileSync(path.join(packageRoot, 'fixtures/named-source-registry.v1.0.0.json'), 'utf8'));
const vocabulary = JSON.parse(fs.readFileSync(path.join(packageRoot, 'fixtures/controlled-vocabulary.json'), 'utf8'));
const rural = registry.sources.find((s) => s.source_id === 'rural-hospital-closure-tracking');
const namedIds = (q) => parseQuestion({ question: q }, vocabulary, registry).interpretation.named_sources.map((s) => s.source_id);

test('rural closure tracking entry keeps its evidence boundary and official locator', () => {
  assert.ok(rural);
  assert.ok(rural.aliases.includes('Sheps rural hospital closures'));
  assert.ok(rural.aliases.includes('rural hospital closures'));
  assert.equal(rural.coverage_state, 'not_indexed');
  assert.equal(rural.catalog_membership, false);
  assert.equal(rural.official_discovery_url, 'https://www.shepscenter.unc.edu/programs-projects/rural-health/rural-hospital-closures/');
});

test('natural rural hospital closures query resolves the tracked family', () => {
  const parsed = parseQuestion({ question: 'rural hospital closures' }, vocabulary, registry);
  const match = parsed.interpretation.named_sources.find((s) => s.source_id === 'rural-hospital-closure-tracking');
  assert.ok(match);
  assert.ok(match.matched_aliases.includes('rural hospital closures'));
  assert.equal(match.official_discovery_url, rural.official_discovery_url);
});

test('sheps-qualified query still resolves the tracked family', () => {
  assert.ok(namedIds('Sheps rural hospital closures').includes('rural-hospital-closure-tracking'));
});

test('unrelated families are unaffected by the rural alias', () => {
  assert.ok(namedIds('AHA annual survey hospital').includes('aha-annual-survey'));
  assert.ok(!namedIds('AHA annual survey hospital').includes('rural-hospital-closure-tracking'));
  assert.ok(!namedIds('hospital cost report').includes('rural-hospital-closure-tracking'));
});
