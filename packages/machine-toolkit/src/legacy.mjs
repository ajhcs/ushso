import { validateLegacyInput } from './input-validation.mjs';
import { LEGACY_COMPATIBILITY } from './manifest.mjs';

const EMPTY_FILTERS = Object.freeze({
  geography_ids: [],
  subject_ids: [],
  grain: [],
  access_classes: [],
  authority_levels: [],
  machine_readiness: [],
  time_period: null,
  negative_constraints: [],
  dimensions: []
});

export function translateLegacyDiscoverSources(input) {
  const issues = validateLegacyInput(input);
  const ambiguousFields = ['geography', 'subjects', 'units_of_analysis', 'access_statuses', 'include_restricted', 'time_window'].filter((name) => Object.hasOwn(input ?? {}, name));
  if (ambiguousFields.length > 0) issues.push({ path: '/', message: `legacy filters require a reviewed semantic mapping: ${ambiguousFields.join(', ')}` });
  if (issues.length > 0) return { ok: false, code: 'invalid_input', issues };
  return {
    ok: true,
    input: {
      contract_version: 'observatory.machine.search-assets.input.v1.0.0',
      mode: 'search',
      research_need: input.question,
      filters: structuredClone(EMPTY_FILTERS),
      grouping: 'none',
      limit: input.limit ?? 10,
      cursor: null,
      expected_generation: null
    }
  };
}

export function legacyCompatibilityStatus() {
  return LEGACY_COMPATIBILITY;
}
