import assert from 'node:assert/strict';
import test from 'node:test';
import { CARDS, buildSourceCard, readerPath } from '../../packages/enrichment/source-card.mjs';

test('a card cannot declare Best for from topic tags alone; missing essential facts are explicitly incomplete', () => {
  assert.throws(() => buildSourceCard({
    source_id: 'topic-only',
    topic_tags: ['hospitals', 'finance'],
    purpose_from_topic_tags: true,
    purpose: 'Best for hospital finance',
  }), { code: 'BEST_FOR_FROM_TOPIC_TAGS' });
  const incomplete = buildSourceCard({ source_id: 'incomplete', purpose: 'Something' });
  assert.equal(incomplete.status, 'incomplete');
  assert.ok(incomplete.missing_essential.includes('coverage'));
  assert.ok(incomplete.missing_essential.includes('grain'));
  assert.equal(incomplete.incomplete, true);
});

test('HCRIS/PLACES cards have evidence-bound claims a reviewer can compare with publisher passages', () => {
  for (const card of [CARDS.hcris, CARDS.places]) {
    assert.equal(card.incomplete, false);
    assert.ok(card.claims.length > 0);
    for (const claim of card.claims) {
      assert.ok(claim.evidence_ids.length > 0);
      assert.ok(claim.publisher_passage.length > 0);
    }
    assert.ok(card.limits.length > 0);
    assert.ok(card.unknowns.every((item) => item.full_page_section === false));
    assert.equal(card.generic_warning_copied, false);
  }
  assert.notEqual(CARDS.hcris.purpose, CARDS.places.purpose);
  assert.notEqual(CARDS.hcris.grain, CARDS.places.grain);
});

test('a reader can move from purpose to variables to a tested access step without searching repeated caveats', () => {
  const path = readerPath(CARDS.hcris);
  assert.equal(path.complete, true);
  assert.deepEqual(path.steps.map((step) => step.id), ['purpose', 'variables', 'tested_access_step']);
  assert.equal(path.searches_repeated_caveats, false);
  assert.ok(CARDS.hcris.release_id && CARDS.hcris.schema_id && CARDS.hcris.example_ids.length);
  assert.ok(CARDS.hcris.beginner_guide_id && CARDS.hcris.expert_guide_id);
  assert.equal(CARDS.hcris.provenance_expandable, true);
});
