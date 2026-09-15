import assert from 'node:assert/strict';
import test from 'node:test';
import { checkGuideExamples } from '../../scripts/research-program/check-guide-examples.mjs';
import { QUALIFIED_ROUTES, buildRetrievalRecipe } from '../../packages/registry/qualified-access-routes.mjs';

test('guide examples retain tested recipe bounds and never embed credentials', async () => {
  const result = await checkGuideExamples();
  assert.equal(result.ok, true);
  assert.equal(result.generation, 'live-2026-09-03-85b50522b420');
  assert.equal(result.census_parameter, 'key');
  assert.equal(result.census_placeholder, '[REDACTED]');
  assert.equal(result.live_example_execution, 'forbidden');
  assert.equal(result.tested_example_badge, false);
  const census = QUALIFIED_ROUTES.find((route) => route.kind === 'keyed_census');
  const recipe = buildRetrievalRecipe(census);
  assert.equal(recipe.parameters[0].name, 'key');
  assert.equal(recipe.parameters[0].example_value, '[REDACTED]');
  assert.match(recipe.sample_requests[0], /key=\[REDACTED\]/);
});
