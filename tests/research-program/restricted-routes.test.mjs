import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNamedSourceRegistry, resolveNamedSource } from '../../packages/enrichment/named-sources.mjs';
import {
  LAST_GOOD_GENERATION,
  buildWorkflowCard,
  evaluateRestrictedRoutes,
  inspectRoute,
  loadRestrictedFamilies,
  separateAccessClasses,
} from '../../packages/connectors/source-registry/access-workflows.mjs';

const families = loadRestrictedFamilies();
const registry = loadNamedSourceRegistry();
const byId = Object.fromEntries(families.families.map((family) => [family.family_id, family]));

test('public MEPS files are not labeled restricted solely because another MEPS product is restricted; AHA terms are not inferred', () => {
  const meps = separateAccessClasses(byId['ahrq-meps']);
  const puf = meps.products.find((product) => product.product_id === 'meps-puf');
  const restricted = meps.products.find((product) => product.product_id === 'meps-restricted');
  assert.equal(puf.payload_access, 'public_download');
  assert.equal(restricted.payload_access, 'restricted');
  assert.throws(() => separateAccessClasses({
    ...byId['ahrq-meps'],
    products: [{ product_id: 'meps-puf', access_class: 'public_use_file', payload_access: 'restricted' }],
  }), { code: 'PUBLIC_MEPS_NOT_RESTRICTED_BECAUSE_SIBLING' });
  assert.equal(byId['aha-annual-survey'].terms_inferred, false);
  assert.equal(byId['aha-annual-survey'].products[0].fee, 'unknown');
  assert.throws(() => separateAccessClasses({ ...byId['aha-annual-survey'], terms_inferred: true }), { code: 'AHA_TERMS_NOT_INFERRED' });
});

test('each step cites a source; an undocumented fee or eligibility criterion remains unknown rather than guessed; credentials are not collected', () => {
  const card = buildWorkflowCard(byId['ahrq-hcup']);
  assert.ok(card.steps.every((step) => step.citation && step.fee === 'unknown' && step.collects_eligibility_or_credentials === false));
  assert.throws(() => buildWorkflowCard({
    ...byId['ahrq-hcup'],
    workflow: [{ id: 'guess', action: 'guess', citation: 'https://hcup-us.ahrq.gov/databases.jsp', fee_guessed: true }],
  }), { code: 'UNKNOWN_NOT_GUESSED' });
  assert.throws(() => buildWorkflowCard({
    ...byId['aha-annual-survey'],
    workflow: [{ id: 'collect', action: 'collect', citation: 'https://www.ahadata.com/aha-annual-survey-database', collects_eligibility_or_credentials: true }],
  }), { code: 'USHSO_DOES_NOT_COLLECT_CREDENTIALS' });
});

test('an agent can explain the next legitimate step and cannot claim a successful restricted-data download', () => {
  const result = evaluateRestrictedRoutes({ families: families.families, registry });
  assert.equal(result.family_count, 3);
  assert.equal(result.generation, LAST_GOOD_GENERATION);
  assert.equal(result.restricted_download_claimed, false);
  for (const family of families.families) {
    const named = resolveNamedSource(family.discovery_question, registry);
    assert.equal(named.sources[0].source_id, family.named_source_id);
    const route = inspectRoute(family);
    assert.equal(route.next_legitimate_step.id, family.workflow[0].id);
    assert.equal(route.restricted_download_claimed, false);
  }
  assert.throws(() => inspectRoute(byId['ahrq-hcup'], { claimRestrictedDownload: true }), { code: 'RESTRICTED_DOWNLOAD_NOT_CLAIMED' });
});
