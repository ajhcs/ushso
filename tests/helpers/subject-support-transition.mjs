// Explicit v1.3 semantic transition applied to frozen historical controls.
// Scores, ordering, lexical matches, facets and unrelated fields stay exact.
export function withSubjectSupportTransition(response) {
  const replace = value => {
    if (typeof value === 'string') return value.replaceAll('observatory-canonical-ranking.v1.2.0', 'observatory-canonical-ranking.v1.3.0').replaceAll('is stated directly in publisher title or description text.', 'appears in publisher text; subject support has not been established by an identity-bound capability.');
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,replace(item)]));
    return value;
  };
  const copy = replace(response);
  for (const item of copy.results) {
    const lexicalSubjects = item.relevance.score_components.filter(component => component.kind === 'subject_direct_text');
    for (const component of lexicalSubjects) component.evidence_state = 'inferred';
    if (lexicalSubjects.length || (!copy.query.interpretation.subjects.length && !(copy.query.interpretation.named_sources??[]).length)) item.match_state = 'contextual';
  }
  copy.sections = Object.fromEntries(['supported','uncertain','contextual'].map(state => [state,copy.results.filter(item=>item.match_state===state).map(item=>item.record_id)]));
  return copy;
}
