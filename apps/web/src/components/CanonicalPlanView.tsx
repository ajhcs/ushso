import { AlertCircle, CheckCircle2, CircleHelp, LockKeyhole, Route, ShieldAlert } from 'lucide-react'
import { coveragePositioning } from '../data/coveragePositioning'
import { assertCanonicalResearchPlanSurface, PLAN_SECTION_ORDER } from '../lib/researchPlanContract'
import type { AssetContribution, CanonicalResearchPlan, PlanClaim, PlanCoverage, RecommendationState } from '../types/researchPlan'
import { PlanJsonExport } from './PlanJsonExport'

const roleOrder: RecommendationState[] = ['essential', 'supporting', 'conditional', 'rejected', 'unavailable']

const statusCopy = {
  unsupported: 'The request is outside the USHSO recommendation boundary or has no defensible source bundle.',
  clarification_required: 'A material answer is required before USHSO can recommend a source bundle.',
  incomplete: 'Some required source roles, evidence, access details, or compatibility facts remain unresolved.',
  ready_with_constraints: 'A defensible source bundle is available with explicit constraints and unresolved work.',
  ready: 'The pinned evidence supports this source bundle and its non-executed handoff.',
} as const

function sentenceCase(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function Values({ values, empty }: { values: string[]; empty: string }) {
  return values.length > 0 ? <ul>{values.map((value) => <li key={value}>{value}</li>)}</ul> : <p>{empty}</p>
}

function CoverageDetails({ coverage, empty }: { coverage: PlanCoverage | null; empty: string }) {
  if (!coverage) return <p>{empty}</p>
  return (
    <dl className="plan-coverage-details">
      <div><dt>Period</dt><dd>{coverage.period ? `${coverage.period.start} through ${coverage.period.end} (${coverage.period.period_kind})` : 'Not specified'}</dd></div>
      <div><dt>Geography</dt><dd>{coverage.geographies.join(' · ') || 'Not specified'}</dd></div>
      <div><dt>Grain</dt><dd>{coverage.grain ? sentenceCase(coverage.grain) : 'Not specified'}</dd></div>
      <div><dt>Support state</dt><dd>{sentenceCase(coverage.coverage_state)}</dd></div>
      <div><dt>Evidence</dt><dd>{coverage.evidence_reference_ids.join(' · ') || 'No reference supplied'}</dd></div>
    </dl>
  )
}

function Contribution({ contribution }: { contribution: AssetContribution }) {
  return (
    <article className="plan-contribution">
      <h4>{contribution.asset_id ?? `${sentenceCase(contribution.selection_level)} placeholder`}</h4>
      <p>{contribution.fitness.join(' ')}</p>
      <dl>
        <div><dt>Role</dt><dd>{sentenceCase(contribution.role_kind)} · {contribution.role_id}</dd></div>
        <div><dt>Exact release</dt><dd>{contribution.release_id ?? 'Unresolved'}</dd></div>
        <div><dt>Distribution</dt><dd>{contribution.distribution_id ?? 'Unresolved'}</dd></div>
        <div><dt>Access route</dt><dd>{contribution.access_route_id ?? 'Unresolved'}</dd></div>
        <div><dt>Access</dt><dd>{sentenceCase(contribution.access.access_class)} · authorization {sentenceCase(contribution.access.authorization_state)}</dd></div>
        <div><dt>Identity</dt><dd>{sentenceCase(contribution.identity_context.resolution_state)} at {contribution.identity_context.valid_at}</dd></div>
        <div><dt>Evidence</dt><dd>{contribution.evidence_reference_ids.join(' · ')}</dd></div>
      </dl>
      <Values values={contribution.limitations} empty="No contribution-specific limitation is recorded." />
    </article>
  )
}

function Claims({ claims, empty }: { claims: PlanClaim[]; empty: string }) {
  return claims.length > 0 ? (
    <ul className="plan-claims">{claims.map((claim) => (
      <li key={claim.claim_id}>
        <strong>{claim.code}</strong><span>{claim.text}</span><small>Evidence: {claim.evidence_reference_ids.join(' · ')}</small>
      </li>
    ))}</ul>
  ) : <p>{empty}</p>
}

export function CanonicalPlanView({ plan }: { plan: CanonicalResearchPlan }) {
  assertCanonicalResearchPlanSurface(plan)
  const sourceByRole = new Map(roleOrder.map((role) => [role, plan.asset_contributions.filter((item) => item.recommendation_state === role)]))
  const supported = plan.downstream_handoff.analysis_decisions.filter((decision) => decision.classification === 'supported' || decision.classification === 'conditional')
  const unsupported = plan.downstream_handoff.analysis_decisions.filter((decision) => decision.classification === 'blocked' || decision.classification === 'unsupported')

  return (
    <article className="canonical-plan" data-contract-version={plan.contract_version} data-plan-status={plan.plan_status}>
      <section className="plan-section plan-lead" data-plan-section={PLAN_SECTION_ORDER[0]} aria-labelledby="plan-lead-heading">
        <p>Canonical research plan · {sentenceCase(plan.plan_status)}</p>
        <h1 id="plan-lead-heading">You need these sources.</h1>
        <p className="plan-lead__answer">{plan.response.lead}</p>
        <p>{plan.response.summary}</p>
        <div className={`plan-status plan-status--${plan.plan_status}`} role="status">
          {plan.plan_status === 'ready' ? <CheckCircle2 aria-hidden="true" /> : plan.plan_status === 'clarification_required' ? <CircleHelp aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
          <div><strong>{sentenceCase(plan.plan_status)}</strong><p>{statusCopy[plan.plan_status]}</p><small>{plan.plan_status_reason_codes.join(' · ')}</small></div>
        </div>
      </section>

      <section className="plan-section" data-plan-section={PLAN_SECTION_ORDER[1]} aria-labelledby="plan-roles-heading">
        <p className="plan-section__number">02</p><h2 id="plan-roles-heading">Source roles</h2>
        <p>Essential, supporting, conditional, rejected, and unavailable roles remain visibly distinct.</p>
        <div className="plan-role-grid">
          {roleOrder.map((role) => {
            const contributions = sourceByRole.get(role) ?? []
            return <section className={`plan-role plan-role--${role}`} key={role} aria-labelledby={`plan-role-${role}`}><h3 id={`plan-role-${role}`}>{sentenceCase(role)}</h3>{contributions.length > 0 ? contributions.map((item) => <Contribution key={item.contribution_id} contribution={item} />) : <p>No {role} contribution is present in this canonical plan.</p>}</section>
          })}
        </div>
      </section>

      <section className="plan-section" data-plan-section={PLAN_SECTION_ORDER[2]} aria-labelledby="plan-coverage-heading">
        <p className="plan-section__number">03</p><h2 id="plan-coverage-heading">Requested and supported coverage</h2>
        <div className="plan-coverage-grid">
          <article><h3>Requested</h3><CoverageDetails coverage={plan.bundle_assessment.requested_coverage} empty="No requested coverage is recorded." /></article>
          <article><h3>Common supported intersection</h3><CoverageDetails coverage={plan.bundle_assessment.common_supported_coverage} empty="No common supported coverage is established." /></article>
        </div>
        <h3>Per-source support</h3>
        {plan.bundle_assessment.source_supported_coverage.length > 0 ? plan.bundle_assessment.source_supported_coverage.map((item) => <article className="plan-source-coverage" key={item.contribution_id}><h4>{item.contribution_id}</h4><CoverageDetails coverage={item.coverage} empty="No source coverage is recorded." /></article>) : <p>No source-supported coverage is established.</p>}
        <h3>Coverage constraints and gaps</h3>
        <Claims claims={plan.bundle_assessment.constraints} empty="No bundle coverage constraint is recorded." />
      </section>

      <section className="plan-section" data-plan-section={PLAN_SECTION_ORDER[3]} aria-labelledby="plan-operations-heading">
        <p className="plan-section__number">04</p><h2 id="plan-operations-heading">Join, crosswalk, and aggregation map</h2>
        <p>Operation kind, evidence, compatibility, requirements, and blockers are independent facts. “Candidate” never means documented or executed.</p>
        {plan.operations.length > 0 ? <ol className="plan-operations">{plan.operations.map((operation) => (
          <li key={operation.operation_id}>
            <header><Route aria-hidden="true" /><div><h3>{sentenceCase(operation.operation_kind)}</h3><code>{operation.operation_id}</code></div></header>
            <dl>
              <div data-operation-field="operation_kind"><dt>Operation kind</dt><dd>{sentenceCase(operation.operation_kind)}</dd></div>
              <div data-operation-field="evidence_state"><dt>Evidence state</dt><dd>{sentenceCase(operation.evidence_state)} · basis {sentenceCase(operation.basis_evidence_state)}</dd></div>
              <div data-operation-field="compatibility"><dt>Compatibility</dt><dd>{sentenceCase(operation.compatibility)}</dd></div>
              <div><dt>Grain</dt><dd>{sentenceCase(operation.source_grain)} → {sentenceCase(operation.target_grain)}</dd></div>
              <div><dt>Join / identifier evidence</dt><dd>{operation.join_route_id ?? 'No join route'} · {operation.identifier_namespace_id ?? 'No identifier namespace'}</dd></div>
              <div><dt>Inputs → output</dt><dd>{operation.input_ids.join(' · ')} → {operation.output_id}</dd></div>
              <div><dt>Executed</dt><dd>No</dd></div>
            </dl>
            <div className="plan-operation-lists">
              <div data-operation-field="requirements"><h4>Requirements</h4>{operation.requirements.length > 0 ? <ul>{operation.requirements.map((requirement) => <li key={requirement.requirement_id}>{sentenceCase(requirement.kind)} · {sentenceCase(requirement.state)} · {requirement.requirement_id}</li>)}</ul> : <p>None recorded.</p>}</div>
              <div data-operation-field="blockers"><h4>Unresolved blockers</h4>{operation.blockers.length > 0 ? <ul>{operation.blockers.map((blocker) => <li key={blocker.blocker_id}>{sentenceCase(blocker.kind)} · {sentenceCase(blocker.state)}{blocker.fatal ? ' · fatal' : ''} · {blocker.blocker_id}</li>)}</ul> : <p>None recorded.</p>}</div>
            </div>
          </li>
        ))}</ol> : <p>No operation is present. This does not imply compatibility or that no transformation is needed.</p>}
      </section>

      <section className="plan-section" data-plan-section={PLAN_SECTION_ORDER[4]} aria-labelledby="plan-acquisition-heading">
        <p className="plan-section__number">05</p><h2 id="plan-acquisition-heading">Acquisition instructions and human gates</h2>
        <p><LockKeyhole aria-hidden="true" /> USHSO explains these steps but does not register, apply, sign a DUA, pay a fee, log in, retrieve a payload, or authorize access.</p>
        {plan.acquisition_plan.steps.length > 0 ? <ol className="plan-acquisition">{[...plan.acquisition_plan.steps].sort((left, right) => left.sequence - right.sequence).map((step) => <li key={step.step_id}><h3>Step {step.sequence}: {sentenceCase(step.action_kind)}</h3><p>{step.instructions}</p><dl><div><dt>Performed by</dt><dd>{sentenceCase(step.performed_by)}</dd></div><div><dt>Human gates</dt><dd>{step.human_gate_ids.join(' · ') || 'None recorded'}</dd></div><div><dt>Depends on</dt><dd>{step.depends_on.join(' · ') || 'None'}</dd></div><div><dt>Execution state</dt><dd>Not executed</dd></div></dl><h4>Stop conditions</h4><Values values={step.stop_conditions} empty="No stop condition recorded." /></li>)}</ol> : <p>No acquisition sequence is available.</p>}
      </section>

      <section className="plan-section" data-plan-section={PLAN_SECTION_ORDER[5]} aria-labelledby="plan-downstream-heading">
        <p className="plan-section__number">06</p><h2 id="plan-downstream-heading">Supported and unsupported downstream analyses</h2>
        <p>These are source-support classifications, not analytical results. Any execution occurs {sentenceCase(plan.downstream_handoff.execution_location)}.</p>
        <div className="plan-downstream-grid">
          <article><h3>Supported or conditional</h3>{supported.length > 0 ? <ul>{supported.map((decision) => <li key={decision.analysis_id}><strong>{decision.label}</strong><span>{sentenceCase(decision.classification)} · source support {sentenceCase(decision.source_support_state)}</span><Values values={decision.limitations} empty="No limitation recorded." /></li>)}</ul> : <p>No downstream analysis is classified supported or conditional.</p>}</article>
          <article><h3>Blocked or unsupported</h3>{unsupported.length > 0 ? <ul>{unsupported.map((decision) => <li key={decision.analysis_id}><strong>{decision.label}</strong><span>{sentenceCase(decision.classification)} · source support {sentenceCase(decision.source_support_state)}</span><Values values={decision.limitations} empty="No limitation recorded." /></li>)}</ul> : <p>No downstream analysis is classified blocked or unsupported.</p>}</article>
        </div>
      </section>

      <section className="plan-section" data-plan-section={PLAN_SECTION_ORDER[6]} aria-labelledby="plan-limitations-heading">
        <p className="plan-section__number">07</p><h2 id="plan-limitations-heading">Limitations, unresolved gaps, and generation pins</h2>
        <div className="plan-limit-grid">
          <article><h3>Important limitations</h3><Claims claims={plan.important_limitations} empty="No important limitation is recorded." /></article>
          <article><h3>Unresolved gaps</h3><Claims claims={plan.unresolved_gaps} empty="No unresolved gap is recorded." /></article>
          <article><h3>Do not recommend when</h3><Claims claims={plan.conditions_not_recommend} empty="No non-recommendation condition is recorded." /></article>
        </div>
        {plan.clarifications.state === 'open' && <div className="plan-clarifications" role="note"><AlertCircle aria-hidden="true" /><div><h3>Open clarifications</h3><ul>{plan.clarifications.questions.map((question) => <li key={question.question_id}>{question.prompt}</li>)}</ul></div></div>}
        <dl className="plan-pins">
          <div><dt>Publication manifest</dt><dd>{plan.generated_from.publication_manifest_id}</dd></div>
          <div><dt>Registry revision</dt><dd>{plan.generated_from.registry_revision_id}</dd></div>
          <div><dt>Index generation</dt><dd>{plan.generated_from.index_generation}</dd></div>
          <div><dt>Plan coverage snapshot</dt><dd>{plan.generated_from.coverage_snapshot_id}</dd></div>
          <div><dt>Canonical as of</dt><dd><time dateTime={plan.generated_from.canonical_as_of}>{plan.generated_from.canonical_as_of}</time></dd></div>
          <div><dt>Critical-claim digest</dt><dd>{plan.response.critical_claim_digest}</dd></div>
        </dl>
        <aside className="plan-public-coverage-note" aria-label="Current public coverage accounting reference" data-current-coverage-snapshot={coveragePositioning.coverageSnapshotId}>
          <strong>Current public coverage reference — separate from this plan’s pinned snapshot</strong>
          <p>As of <time dateTime={coveragePositioning.asOf}>{coveragePositioning.asOf}</time>: {coveragePositioning.nonAdditivity}</p>
          <small>Product-owner approval for this public wording remains pending.</small>
        </aside>
        <p className="plan-truth-boundary"><strong>Truth boundary:</strong> no source request, access authorization, retrieval, payload acquisition, analysis, or identity merge was performed by USHSO.</p>
      </section>

      <section className="plan-section" data-plan-section={PLAN_SECTION_ORDER[7]} aria-labelledby="plan-export-heading">
        <p className="plan-section__number">08</p><h2 id="plan-export-heading">Copy or download canonical JSON</h2>
        <PlanJsonExport plan={plan} />
      </section>
    </article>
  )
}
