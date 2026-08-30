import { stableJson } from './common.mjs';

function push(errors, code, detail) { errors.push({ code, detail }); }
function unique(values) { return new Set(values).size === values.length; }

export function validateSourceTruthSet(records, dependencyPin, curatedAssets = null) {
  const errors = [];
  if (records.length !== 3) push(errors, 'SOURCE_TRUTH_COUNT', String(records.length));
  if (!unique(records.map(record => record.source_truth_id))) push(errors, 'DUPLICATE_SOURCE_TRUTH_ID', 'source_truth_id');
  if (!unique(records.map(record => record.record_id))) push(errors, 'DUPLICATE_ASSET_ID', 'record_id');
  const expectedIds = [...dependencyPin.record_ids].sort();
  const actualIds = records.map(record => record.record_id).sort();
  if (stableJson(expectedIds) !== stableJson(actualIds)) push(errors, 'DEPENDENCY_RECORD_SET_MISMATCH', `${actualIds.join(',')}`);
  for (const record of records) if (record.evidence.origin_sha256 !== dependencyPin.sha256) push(errors, 'SOURCE_TRUTH_PIN_MISMATCH', record.source_truth_id);
  if (curatedAssets) {
    const byId = new Map(curatedAssets.assets.map(asset => [asset.record_id, asset]));
    for (const record of records) {
      const source = byId.get(record.record_id);
      if (!source) { push(errors, 'SOURCE_RECORD_MISSING', record.record_id); continue; }
      const pairs = [
        ['source_id', record.source_id, source.source_id], ['family_id', record.family_id, source.family_id], ['title', record.title, source.title],
        ['description', record.description, source.description], ['authoritative_url', record.authoritative_url, source.authoritative_url],
        ['asset_type', record.asset_type, source.asset_type], ['geography', record.geography, source.geography], ['time_coverage', record.time_coverage, source.time_coverage],
        ['units', record.units, source.unit_of_analysis], ['subjects', record.subjects, source.subjects], ['access', record.access, source.access],
        ['retrieval_urls', record.retrieval_urls, source.retrieval_urls], ['limitations', record.limitations, source.limitations]
      ];
      for (const [field, observed, expected] of pairs) if (stableJson(observed) !== stableJson(expected)) push(errors, 'SOURCE_TRUTH_FIELD_MISMATCH', `${record.record_id}:${field}`);
    }
  }
  return errors;
}

export function validateUseCard(card, truthById) {
  const errors = [];
  const referencedTruth = card.source_truth_ids.map(id => truthById.get(id));
  for (let index = 0; index < referencedTruth.length; index += 1) if (!referencedTruth[index]) push(errors, 'UNKNOWN_SOURCE_TRUTH', card.source_truth_ids[index]);
  if (referencedTruth.filter(Boolean).every(record => record.record_id !== card.asset_id)) push(errors, 'USE_CARD_ASSET_TRUTH_MISMATCH', card.use_card_id);
  const evidenceIds = new Set(card.evidence.map(item => item.evidence_id));
  if (!unique([...evidenceIds])) push(errors, 'DUPLICATE_EVIDENCE_ID', card.use_card_id);
  for (const evidence of card.evidence) {
    if (!card.source_truth_ids.includes(evidence.source_truth_id)) push(errors, 'EVIDENCE_TRUTH_OUT_OF_SCOPE', evidence.evidence_id);
    if (!truthById.has(evidence.source_truth_id)) push(errors, 'UNKNOWN_SOURCE_TRUTH', evidence.source_truth_id);
  }
  const usedEvidence = [
    ...card.measures.flatMap(item => item.evidence_ids), card.compatible_geographies.evidence_ids, card.time_needs.evidence_ids
  ].flat();
  for (const id of usedEvidence) if (!evidenceIds.has(id)) push(errors, 'UNKNOWN_USE_CARD_EVIDENCE', `${card.use_card_id}:${id}`);
  if (card.assertion_type !== 'curated_analytical_fit_not_source_truth') push(errors, 'SOURCE_TRUTH_BOUNDARY_VIOLATION', card.use_card_id);
  if (card.truth_boundary?.llm_generated_truth_allowed !== false || card.truth_boundary?.source_truth_separate !== true) push(errors, 'LLM_TRUTH_BOUNDARY_VIOLATION', card.use_card_id);
  return errors;
}

export function validateAccessRecipe(recipe, truthById) {
  const errors = [];
  const truth = truthById.get(recipe.source_truth_id);
  if (!truth) push(errors, 'UNKNOWN_SOURCE_TRUTH', recipe.source_truth_id);
  if (truth && truth.record_id !== recipe.asset_id) push(errors, 'UNKNOWN_ASSET', recipe.asset_id);
  if (truth && truth.authoritative_url !== recipe.authoritative_url) push(errors, 'AUTHORITATIVE_URL_MISMATCH', recipe.recipe_id);
  if (!recipe.source_urls.includes(recipe.authoritative_url)) push(errors, 'AUTHORITATIVE_URL_NOT_IN_SOURCE_URLS', recipe.recipe_id);
  const sequences = recipe.steps.map(step => step.sequence);
  if (sequences.some((sequence, index) => sequence !== index + 1)) push(errors, 'NON_CONSECUTIVE_STEPS', `${recipe.recipe_id}:${sequences.join(',')}`);
  for (const step of recipe.steps) {
    if (step.network_action && step.authorization_gate === 'none_offline') push(errors, 'NETWORK_STEP_WITHOUT_GATE', `${recipe.recipe_id}:${step.sequence}`);
    if (!step.network_action && ['open_source', 'download_bounded', 'call_api_bounded', 'submit_application', 'receive_controlled_transfer'].includes(step.action)) push(errors, 'NETWORK_ACTION_MISLABELED', `${recipe.recipe_id}:${step.sequence}`);
  }
  if (recipe.authorization.execution_allowed !== false || recipe.authorization.network_allowed !== false) push(errors, 'EXECUTION_BOUNDARY_VIOLATION', recipe.recipe_id);
  for (const outcome of recipe.typed_failure_outcomes) {
    if (outcome.outcome === 'not_found' || outcome.preserve_as === 'not_found' || outcome.translation_to_not_found !== false) push(errors, 'NOT_FOUND_TRANSLATION', `${recipe.recipe_id}:${outcome.outcome}`);
    if (outcome.preserve_as !== outcome.outcome) push(errors, 'TYPED_OUTCOME_RENAMED', `${recipe.recipe_id}:${outcome.outcome}->${outcome.preserve_as}`);
  }
  if (!recipe.expected_artifacts.some(item => item.artifact_type === 'typed_failure_receipt')) push(errors, 'TYPED_FAILURE_ARTIFACT_MISSING', recipe.recipe_id);
  if (!recipe.expected_artifacts.some(item => item.artifact_type === 'no_payload_fixture_attestation')) push(errors, 'NO_PAYLOAD_ATTESTATION_MISSING', recipe.recipe_id);
  return errors;
}

export function validateBundle(useCards, recipes, truthById) {
  const errors = [];
  if (useCards.length !== 3) push(errors, 'USE_CARD_COUNT', String(useCards.length));
  if (recipes.length !== 3) push(errors, 'ACCESS_RECIPE_COUNT', String(recipes.length));
  if (!unique(useCards.map(card => card.use_card_id))) push(errors, 'DUPLICATE_USE_CARD_ID', 'use_card_id');
  if (!unique(recipes.map(recipe => recipe.recipe_id))) push(errors, 'DUPLICATE_RECIPE_ID', 'recipe_id');
  if (!unique(recipes.map(recipe => recipe.route_id))) push(errors, 'DUPLICATE_ROUTE_ID', 'route_id');
  const expectedKinds = ['custom_application_request', 'public_bulk_or_api', 'public_report_publication'];
  if (stableJson(recipes.map(recipe => recipe.route_kind).sort()) !== stableJson(expectedKinds)) push(errors, 'DISTINCT_ROUTE_KINDS_MISSING', 'route_kind');
  const publicPhc4 = recipes.find(recipe => recipe.route_kind === 'public_report_publication');
  const customPhc4 = recipes.find(recipe => recipe.route_kind === 'custom_application_request');
  if (!publicPhc4 || !customPhc4 || publicPhc4.asset_id === customPhc4.asset_id || publicPhc4.route_id === customPhc4.route_id) push(errors, 'PHC4_ASSET_ROUTE_COLLAPSE', 'public and custom PHC4 routes must remain distinct');
  for (const card of useCards) errors.push(...validateUseCard(card, truthById));
  for (const recipe of recipes) errors.push(...validateAccessRecipe(recipe, truthById));
  return errors;
}

export function mutateAtPath(value, dottedPath, replacement) {
  const clone = structuredClone(value);
  const parts = dottedPath.split('.');
  let cursor = clone;
  for (let index = 0; index < parts.length - 1; index += 1) cursor = cursor[Number.isInteger(Number(parts[index])) && String(Number(parts[index])) === parts[index] ? Number(parts[index]) : parts[index]];
  const final = parts.at(-1);
  cursor[Number.isInteger(Number(final)) && String(Number(final)) === final ? Number(final) : final] = replacement;
  return clone;
}
