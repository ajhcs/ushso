export const PLANNER_ACCEPTANCE_VERSION = 'ushso.planner-acceptance.v1';
export const LAST_GOOD_GENERATION = 'live-2026-09-03-85b50522b420';
export const PLANNER_PUBLIC_ACTIVATION = Object.freeze({
  plan_research_enabled: false,
  public_capability_count: 8,
  planner_status: 'disabled_pending_owner_boundary',
  authorization_requirement_id: 'AUTH-12',
  dependency: 'WP10B',
  incidental_activation_forbidden: true,
  study_design_certified: false,
  acquisition_executed: false,
  analysis_executed: false,
});

export const PLANNER_OUTPUT_SCOPE = Object.freeze({
  allowed: Object.freeze(['goal', 'sources', 'fields', 'access_steps', 'qualified_joins', 'limitations', 'citations', 'named_gaps']),
  forbidden: Object.freeze(['invented_dataset', 'invented_field', 'invented_join', 'analysis_output', 'payload', 'two_hop_composition']),
  missing_required_source: 'named_gap',
  insufficient_evidence: 'incomplete',
});
