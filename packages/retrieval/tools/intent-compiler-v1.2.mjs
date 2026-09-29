import { parseQuestion } from './question-parser-v1.2.mjs';

export function compileDiscoveryIntent(rawQuery, vocabulary, namedSourceRegistry = null) {
  const parsed = parseQuestion(rawQuery, vocabulary, namedSourceRegistry);
  const unknowns = [];
  if (!parsed.interpretation.geographies.length) unknowns.push('geography_not_resolved');
  if (!parsed.interpretation.subjects.length) unknowns.push('subject_not_resolved');
  if (!parsed.interpretation.units_of_analysis.length) unknowns.push('unit_of_analysis_not_resolved');
  if (!parsed.interpretation.time_window) unknowns.push('time_window_not_specified');
  return {
    intent_version: 'observatory-discovery-intent.v1.0.0',
    original_question: parsed.original_question,
    normalized_question: parsed.normalized_question,
    interpretation: parsed.interpretation,
    filters: parsed.raw,
    compiler: {
      mode: 'deterministic_controlled_vocabulary',
      vocabulary_version: vocabulary.vocabulary_version,
      llm_used: false,
      external_requests: 0,
      unknowns
    }
  };
}
