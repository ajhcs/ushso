import { Download, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ACTIVE_CATALOG } from '../data/catalogDescriptor'
import { EVIDENCE_STATES, buildPriorityResearchPacket, findPriorityResearchQuestion, PRIORITY_RESEARCH_QUESTIONS, RESEARCH_QUESTION_SET_VERSION, type EvidenceState, type PriorityResearchQuestion, type ResearchFact, sourceProfileForId } from '../data/researchNavigator'
import { downloadJsonPacket } from '../lib/searchReceipt'

const evidenceStateLabels: Record<EvidenceState, string> = {
  publisher_documented: 'Publisher documented',
  ushso_observed: 'USHSO observed',
  successfully_tested: 'Successfully tested',
  provisional: 'Provisional',
  conflicting: 'Conflicting',
  unknown: 'Unknown',
}

function EvidenceStateBadge({ state }: { state: EvidenceState }) {
  return <span className={`evidence-state evidence-state--${state}`} data-evidence-state={state}>{evidenceStateLabels[state]}</span>
}

function FactList({ facts }: { facts: readonly ResearchFact[] }) {
  return (
    <dl className="priority-source__facts">
      {facts.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd><span>{item.value}</span> <EvidenceStateBadge state={item.state} /></dd>
          <small>Evidence: {item.evidenceRefs.join(' · ')}</small>
        </div>
      ))}
    </dl>
  )
}

export function PriorityResearchSource({ profileId }: { profileId: string }) {
  const profile = sourceProfileForId(profileId)
  if (!profile) return null
  return (
    <article className={`priority-source priority-source--${profile.coverage}`} data-source-profile={profile.id}>
      <header className="priority-source__header">
        <div>
          <p className="priority-source__family">{profile.familyId}</p>
          <h3>{profile.name}</h3>
          <p><strong>{profile.publisher}</strong> · {profile.product}</p>
        </div>
        <span className={`priority-coverage priority-coverage--${profile.coverage}`}>{profile.coverageLabel}</span>
      </header>
      <p className="priority-source__note">{profile.coverageNote}</p>
      <FactList facts={profile.facts} />
      <div className="priority-source__actions">
        <p><strong>Next action:</strong> {profile.nextAction}</p>
        <p><strong>Join limitation:</strong> {profile.joinLimitations}</p>
        <a href={profile.officialDiscoveryUrl} target="_blank" rel="noreferrer">Open official discovery route <ExternalLink aria-hidden="true" /></a>
      </div>
    </article>
  )
}

export function EvidenceStateLegend() {
  return (
    <details className="evidence-state-legend">
      <summary>Evidence-state key</summary>
      <ul>
        {EVIDENCE_STATES.map((state) => <li key={state}><EvidenceStateBadge state={state} /><span>{state === 'unknown' ? 'Not established in the retained evidence.' : state === 'conflicting' ? 'Retained evidence points to an unresolved mismatch.' : state === 'provisional' ? 'Publisher marks the estimate or release provisional.' : 'The source or observation is bound to the cited evidence.'}</span></li>)}
      </ul>
    </details>
  )
}

export function PriorityResearchBrief({ question }: { question: PriorityResearchQuestion }) {
  const packet = buildPriorityResearchPacket(question)
  return (
    <section className="priority-brief" aria-labelledby="priority-brief-title" data-priority-question={question.id}>
      <div className="priority-brief__header">
        <div>
          <p className="eyebrow">Frozen research question · {question.id}</p>
          <h2 id="priority-brief-title">Research brief</h2>
          <p className="priority-brief__question">{question.question}</p>
        </div>
        <button className="priority-packet-button" data-priority-packet type="button" onClick={() => downloadJsonPacket(packet, question.packetFilename)}><Download aria-hidden="true" /> Download evidence packet</button>
      </div>
      <div className="priority-brief__summary">
        <p><strong>Why this matches:</strong> {question.matchExplanation}</p>
        <p><strong>Decision it supports:</strong> {question.decision}</p>
        <p><strong>Next action:</strong> {question.nextAction}</p>
      </div>
      <p className="priority-brief__catalog">Evidence is scoped to the {ACTIVE_CATALOG.displayLabel} ({ACTIVE_CATALOG.generation}). The packet is metadata and routing evidence; it does not contain source payload rows.</p>
      <EvidenceStateLegend />
      <div className="priority-brief__sources">
        {question.sourceProfileIds.map((profileId) => <PriorityResearchSource key={profileId} profileId={profileId} />)}
      </div>
    </section>
  )
}

export function PriorityResearchMatch({ query }: { query: string }) {
  const question = findPriorityResearchQuestion(query)
  return question ? <PriorityResearchBrief question={question} /> : null
}

export function PriorityResearchCatalog() {
  return (
    <section className="priority-catalog" aria-labelledby="priority-catalog-title">
      <div className="priority-catalog__header">
        <div>
          <p className="eyebrow">Research navigator · {PRIORITY_RESEARCH_QUESTIONS.length} frozen questions</p>
          <h2 id="priority-catalog-title">Start with a real health-systems question</h2>
          <p>Search one of these representative questions to see the source or precise named gap, the match explanation, evidence-bound dimensions, and the next action.</p>
        </div>
        <Link className="priority-catalog__browse" to="/search">Open catalog browse</Link>
      </div>
      <ol className="priority-catalog__grid">
        {PRIORITY_RESEARCH_QUESTIONS.map((question, index) => {
          const source = sourceProfileForId(question.sourceProfileIds[0])
          return (
            <li key={question.id}>
              <article className="priority-question-card">
                <span className="priority-question-card__number">{String(index + 1).padStart(2, '0')}</span>
                <p className="priority-question-card__family">{source?.familyId ?? question.familyIds.join(' · ')}</p>
                <h3><Link to={`/search?q=${encodeURIComponent(question.question)}`}>{question.question}</Link></h3>
                <p>{source?.coverageLabel ?? 'Evidence-bound source route'}</p>
                <Link className="priority-question-card__action" to={`/search?q=${encodeURIComponent(question.question)}`}>View brief →</Link>
              </article>
            </li>
          )
        })}
      </ol>
      <p className="priority-catalog__footnote">Question set {RESEARCH_QUESTION_SET_VERSION} · {new Set(PRIORITY_RESEARCH_QUESTIONS.flatMap((question) => question.familyIds)).size} source families · candidate-only records remain explicitly labeled and are not part of the published baseline.</p>
    </section>
  )
}
