function round(value) {
  return value === null ? null : Number(value.toFixed(6));
}

function gainAtRank(gain, rank) {
  return gain / Math.log2(rank + 1);
}

function aggregate(rows) {
  const eligible = rows.filter(row => row.idcg > 0);
  const macro = eligible.length === 0 ? null : eligible.reduce((sum, row) => sum + row.ndcg, 0) / eligible.length;
  const dcg = eligible.reduce((sum, row) => sum + row.dcg, 0);
  const idcg = eligible.reduce((sum, row) => sum + row.idcg, 0);
  return {
    eligible_questions: eligible.length,
    null_gold_questions: rows.length - eligible.length,
    macro_score: round(macro),
    micro_score: idcg === 0 ? null : round(dcg / idcg),
    dcg: round(dcg),
    ideal_dcg: round(idcg)
  };
}

export function evaluateNormalizedDcg({ cases, cohort, splitByQuestion, gains, k = 5 }) {
  if (!Array.isArray(cases) || cases.length === 0) throw new Error('NDCG_CASES_REQUIRED');
  if (!Number.isInteger(k) || k < 1) throw new Error('NDCG_K_INVALID');
  const caseIds = new Set(cases.map(item => item.question_id));
  if (caseIds.size !== cases.length) throw new Error('NDCG_CASE_IDS_DUPLICATE');

  const bindings = new Map(cohort.asset_bindings.map(binding => [binding.record_id, binding.canonical_source_id]));
  const goldByQuestion = new Map([...caseIds].map(questionId => [questionId, new Map()]));
  for (const requirement of cohort.requirements) {
    if (!caseIds.has(requirement.question_id) || requirement.status !== 'present_search_eligible') continue;
    const gain = gains[requirement.label] ?? 0;
    const gold = goldByQuestion.get(requirement.question_id);
    gold.set(requirement.source_record_id, Math.max(gold.get(requirement.source_record_id) ?? 0, gain));
  }

  const rawQuestions = [...cases].sort((left, right) => left.question_id.localeCompare(right.question_id)).map(item => {
    const split = splitByQuestion.get(item.question_id);
    if (!['development', 'validation'].includes(split)) throw new Error(`NDCG_SPLIT_FORBIDDEN:${item.question_id}:${split ?? 'missing'}`);
    const gold = goldByQuestion.get(item.question_id);
    const seen = new Set();
    let dcg = 0;
    let undiscountedGain = 0;
    for (const result of item.result_bundle.results) {
      if (result.rank > k || result.recommendation_state !== 'recommended') continue;
      const canonical = bindings.get(result.record_id);
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      const gain = gold.get(canonical) ?? 0;
      dcg += gainAtRank(gain, result.rank);
      undiscountedGain += gain;
    }
    const idealGains = [...gold.values()].sort((left, right) => right - left).slice(0, k);
    const idcg = idealGains.reduce((sum, gain, index) => sum + gainAtRank(gain, index + 1), 0);
    const idealUndiscountedGain = idealGains.reduce((sum, gain) => sum + gain, 0);
    return {
      question_id: item.question_id,
      split,
      dcg,
      ideal_dcg: idcg,
      ndcg: idcg === 0 ? null : dcg / idcg,
      earned_undiscounted_gain: undiscountedGain,
      attainable_undiscounted_gain: idealUndiscountedGain,
      present_gold_sources: gold.size
    };
  });

  const normalizedRows = rawQuestions.map(row => ({ ...row, idcg: row.ideal_dcg }));
  const fixedSlotEarned = rawQuestions.reduce((sum, row) => sum + row.earned_undiscounted_gain, 0);
  const fixedSlotAttainable = rawQuestions.reduce((sum, row) => sum + row.attainable_undiscounted_gain, 0);
  const fixedSlotDenominator = rawQuestions.length * k;
  return {
    metric_id: `present_source_normalized_dcg_at_${k}`,
    k,
    cohorts: {
      development: aggregate(normalizedRows.filter(row => row.split === 'development')),
      validation: aggregate(normalizedRows.filter(row => row.split === 'validation')),
      combined: aggregate(normalizedRows)
    },
    historical_fixed_slot_geometry: {
      earned_gain: round(fixedSlotEarned),
      attainable_gain: round(fixedSlotAttainable),
      denominator: fixedSlotDenominator,
      observed_score: round(fixedSlotEarned / fixedSlotDenominator),
      mathematical_ceiling: round(fixedSlotAttainable / fixedSlotDenominator)
    },
    questions: rawQuestions.map(row => ({
      ...row,
      dcg: round(row.dcg),
      ideal_dcg: round(row.ideal_dcg),
      ndcg: round(row.ndcg),
      earned_undiscounted_gain: round(row.earned_undiscounted_gain),
      attainable_undiscounted_gain: round(row.attainable_undiscounted_gain)
    }))
  };
}
