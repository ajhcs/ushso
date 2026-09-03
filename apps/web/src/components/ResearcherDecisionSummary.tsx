import { AlertTriangle, ExternalLink, FileJson2, KeyRound } from 'lucide-react'
import { buildResearcherGuidance, type GuidanceField } from '../lib/researcherGuidance'
import type { DatasetFamily } from '../types/catalog'

function EvidenceLabel({ field }: { field: GuidanceField }) {
  return <small className="guidance-evidence">Evidence: {field.evidenceState} · {field.evidenceIds.length} reference{field.evidenceIds.length === 1 ? '' : 's'}</small>
}

function Values({ values }: { values: string[] }) {
  return values.length === 1
    ? <p>{values[0]}</p>
    : <ul>{values.map((value) => <li key={value}>{value}</li>)}</ul>
}

export function ResearcherDecisionSummary({ dataset }: { dataset: DatasetFamily }) {
  const guidance = buildResearcherGuidance(dataset)
  return (
    <section className="researcher-guidance" aria-labelledby="researcher-guidance-heading" data-review-status={guidance.reviewStatus}>
      <header>
        <p>Researcher decision summary · external review pending</p>
        <h2 id="researcher-guidance-heading">Decide whether this source belongs in your research plan</h2>
        <p>These evidence-bounded cards explain fit and acquisition steps. They do not authorize access, retrieve a payload, or perform an analysis.</p>
      </header>

      <article className="guidance-card guidance-card--wide" aria-labelledby="use-card-heading">
        <div className="guidance-card__heading">
          <AlertTriangle aria-hidden="true" />
          <div><p>Evidence-backed decision aid</p><h3 id="use-card-heading">Use Card</h3></div>
        </div>
        <dl className="guidance-fields">
          {guidance.useCard.fields.map((field) => (
            <div key={field.label}>
              <dt>{field.label}</dt>
              <dd><Values values={field.values} /><EvidenceLabel field={field} /></dd>
            </div>
          ))}
        </dl>
      </article>

      <div className="guidance-card-grid">
        <article className="guidance-card" aria-labelledby="access-plan-heading">
          <div className="guidance-card__heading">
            <KeyRound aria-hidden="true" />
            <div><p>Human authorization remains external</p><h3 id="access-plan-heading">Access Plan</h3></div>
          </div>
          <dl className="guidance-fields guidance-fields--stacked">
            <div><dt>Access class</dt><dd><p>{guidance.accessPlan.accessClass}</p></dd></div>
            <div><dt>Who qualifies</dt><dd><Values values={guidance.accessPlan.whoQualifies} /></dd></div>
            <div><dt>Request process</dt><dd>{guidance.accessPlan.requestProcess.length > 0 ? <ol>{guidance.accessPlan.requestProcess.map((step) => <li key={step.sequence}><b>Step {step.sequence}:</b> {step.instruction} <small>Expected: {step.expectedResult}</small></li>)}</ol> : <p>No request process is captured.</p>}</dd></div>
            <div><dt>Human gates</dt><dd><Values values={guidance.accessPlan.humanGates.length > 0 ? guidance.accessPlan.humanGates : ['No human gate is captured; do not infer that none applies.']} /></dd></div>
            <div><dt>Turnaround</dt><dd><p>{guidance.accessPlan.turnaround.category}: {guidance.accessPlan.turnaround.statement}</p></dd></div>
            <div><dt>Fee basis</dt><dd><p>{guidance.accessPlan.feeBasis}</p></dd></div>
            <div><dt>Delivery and format</dt><dd><Values values={guidance.accessPlan.delivery} /></dd></div>
            <div><dt>Required inputs</dt><dd><Values values={guidance.accessPlan.requiredInputs} /></dd></div>
            <div><dt>Expected artifacts</dt><dd><Values values={guidance.accessPlan.expectedArtifacts} /></dd></div>
            <div><dt>Stop conditions</dt><dd><Values values={guidance.accessPlan.stopConditions} /></dd></div>
            <div><dt>Typed failures</dt><dd><p>{guidance.accessPlan.typedFailures.map((failure) => failure.outcome).join(' · ')}</p><small>Failures never become “not found.”</small></dd></div>
          </dl>
        </article>

        <article className="guidance-card" aria-labelledby="retrieval-recipe-heading">
          <div className="guidance-card__heading">
            <FileJson2 aria-hidden="true" />
            <div><p>Technical instructions only</p><h3 id="retrieval-recipe-heading">Retrieval Recipe</h3></div>
          </div>
          <p className="guidance-warning" role="note">Not promoted: exact {guidance.retrievalRecipe.missingPins.join(', ')} pins are unavailable in this published record.</p>
          <dl className="guidance-fields guidance-fields--stacked">
            <div><dt>Asset pin</dt><dd><code>{guidance.retrievalRecipe.pins.assetId}</code></dd></div>
            <div><dt>Release / distribution / access route</dt><dd><p>Unresolved; no executable recipe is emitted.</p></dd></div>
            <div><dt>Ordered steps</dt><dd>{guidance.retrievalRecipe.steps.length > 0 ? <ol>{guidance.retrievalRecipe.steps.map((step) => <li key={step.sequence}><b>{step.action}:</b> {step.instruction}{step.url && <> <a href={step.url} target="_blank" rel="noreferrer">Authoritative route <ExternalLink aria-hidden="true" /></a></>}</li>)}</ol> : <p>No bounded step is captured.</p>}</dd></div>
            <div><dt>Expected artifacts</dt><dd><Values values={guidance.retrievalRecipe.expectedArtifacts} /></dd></div>
            <div><dt>Execution boundary</dt><dd><p>Execution allowed: no. Payload acquisition claimed: no. Authorization claimed: no.</p></dd></div>
          </dl>
          <h4>Machine-readiness flags</h4>
          <dl className="machine-readiness">
            {guidance.machineReadiness.map((flag) => <div key={flag.flag}><dt>{flag.flag}</dt><dd>{flag.state}</dd></div>)}
          </dl>
        </article>
      </div>
    </section>
  )
}
