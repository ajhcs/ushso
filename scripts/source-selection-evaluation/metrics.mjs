/** Family units keep their original result slots: duplicates consume ranks, not credit. */
export const VERSION = 'ushso.source-selection-evaluation.v2';
const unique = values => [...new Set(values)];
const ratio = (n, d) => d ? n / d : null;
export function scoreQuery(run, judgment, membership, k) {
  if (!Number.isInteger(k) || k < 1) throw new Error('INVALID_K');
  if (!judgment || judgment.query_id !== run.query_id) throw new Error('QUERY_JUDGMENT_MISMATCH');
  const labels = new Map();
  for (const label of judgment.units) {
    if (!label.unit_id || labels.has(label.unit_id) || !['relevant', 'irrelevant', 'unresolved'].includes(label.relevance)) throw new Error('INVALID_OR_DUPLICATE_LABEL');
    labels.set(label.unit_id, label);
  }
  const relevant = [...labels.values()].filter(x => x.relevance === 'relevant').map(x => x.unit_id);
  const present = relevant.filter(id => membership.includes(id));
  const rows = run.status === 'ok' ? run.ranked.slice(0, k) : [];
  const ids = unique(rows.map(x => x.unit_id));
  const hits = ids.filter(id => labels.get(id)?.relevance === 'relevant').length;
  const unknown = ids.filter(id => !labels.has(id) || labels.get(id).relevance === 'unresolved').length;
  const judged = ids.length - unknown;
  const critical = rows.filter(x => x.match_state === 'supported' && labels.get(x.unit_id)?.critical_false_direct === true);
  const hasDirect = rows.some(x => x.match_state === 'supported');
  return { query_id: run.query_id, k, status: run.status, hits, returned_slots: rows.length,
    distinct_units: ids.length, duplicate_slots: rows.length - ids.length, unjudged_units: unknown,
    judgment_coverage: ratio(judged, ids.length), precision_lower: hits / k, precision_upper: (hits + unknown) / k,
    conditional_denominator: present.length, universe_denominator: relevant.length,
    conditional_recall: ratio(hits, present.length), universe_recall: ratio(hits, relevant.length),
    critical_false_direct_count: critical.length,
    no_direct_expected: judgment.no_direct_expected ?? null,
    no_direct_correct: judgment.no_direct_expected === true ? run.status === 'ok' && !hasDirect : null,
    false_abstention: judgment.no_direct_expected === false ? run.status === 'ok' && !hasDirect : null };
}
export function aggregate(rows) {
  const sum = key => rows.reduce((n, r) => n + r[key], 0);
  const mean = key => { const r = rows.filter(x => x[key] !== null); return ratio(r.reduce((n, x) => n + Number(x[key]), 0), r.length); };
  return { attempted_queries: rows.length, failed_queries: rows.filter(x => x.status !== 'ok').length,
    macro_precision_lower: mean('precision_lower'), macro_precision_upper: mean('precision_upper'),
    macro_conditional_recall: mean('conditional_recall'), micro_conditional_recall: ratio(sum('hits'), sum('conditional_denominator')),
    macro_universe_recall: mean('universe_recall'), micro_universe_recall: ratio(sum('hits'), sum('universe_denominator')),
    zero_conditional_denominators: rows.filter(x => !x.conditional_denominator).length,
    critical_false_direct_count: sum('critical_false_direct_count'),
    no_direct_cases: rows.filter(x => x.no_direct_expected === true).length,
    no_direct_correct: rows.filter(x => x.no_direct_correct === true).length,
    false_abstentions: rows.filter(x => x.false_abstention === true).length };
}
