import { Download, ExternalLink } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { MouseEvent } from 'react'
import { createSearchReturnContext, datasetDetailsHref, resultAnchorId, serializeReturnContext } from '../lib/returnContext'
import { ACTIVE_CATALOG } from '../data/catalogMode'
import { EVIDENCE_STATES, buildPriorityResearchPacket, findPriorityResearchQuestion, PRIORITY_RESEARCH_QUESTIONS, RESEARCH_QUESTION_SET_VERSION, type EvidenceState, type PriorityResearchQuestion, type ResearchFact, type ResearchSourceProfile, sourceProfileForId } from '../data/researchNavigator'
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
  return <span className={'evidence-state evidence-state--' + state} data-evidence-state={state}>{evidenceStateLabels[state]}</span>
}

function factByLabel(profile: ResearchSourceProfile, label: string): ResearchFact | null {
  return profile.facts.find((item) => item.label === label) ?? null
}

function dossierEvidenceId(profile: ResearchSourceProfile): string | null {
  for (const ref of profile.evidenceRefs) {
    const hash = ref.indexOf('#')
    if (hash > 0 && hash + 1 < ref.length) return ref.slice(hash + 1)
  }
  return null
}

function dossierHref(profile: ResearchSourceProfile): string | null {
  if (!profile.catalogRecordId) return null
  const evidenceId = dossierEvidenceId(profile)
  const recordHref = '/datasets/' + encodeURIComponent(profile.catalogRecordId)
  return evidenceId ? recordHref + '#evidence-' + encodeURIComponent(evidenceId) : recordHref
}

function ReadableEvidenceLinks({ profile }: { profile: ResearchSourceProfile }) {
  const links = profile.evidenceLinks ?? []
  const dossier = dossierHref(profile)
  return (
    <ul className="priority-brief__evidence-links">
      {links.map((link) => (
        <li key={link.url}>
          <a href={link.url} target="_blank" rel="noreferrer">{link.label} <ExternalLink aria-hidden="true" /></a>
          <small>{link.locator}</small>
        </li>
      ))}
      {links.length === 0 && (
        <li>
          <a href={profile.officialDiscoveryUrl} target="_blank" rel="noreferrer">Publisher discovery page <ExternalLink aria-hidden="true" /></a>
          <small>{profile.publisher} · {profile.product}</small>
        </li>
      )}
      {dossier && (
        <li>
          <Link to={dossier}>Open claim evidence dossier</Link>
          <small>Catalog record evidence, claim-level audit trail</small>
        </li>
      )}
    </ul>
  )
}

function FactList({ profile }: { profile: ResearchSourceProfile }) {
  return (
    <dl className="priority-source__facts">
      {profile.facts.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd><span>{item.value}</span> <EvidenceStateBadge state={item.state} /></dd>
          <details><summary>Evidence references</summary><ReadableEvidenceLinks profile={profile} /></details>
        </div>
      ))}
    </dl>
  )
}

function TechnicalIdentifiers({ profile }: { profile: ResearchSourceProfile }) {
  return (
    <details className="priority-brief__provenance" data-provenance="technical-ids">
      <summary>Technical identifiers</summary>
      <p>Raw catalog and registry identifiers for audit. Resolve each claim through the evidence links above.</p>
      <ul>
        {profile.facts.map((item) => (
          <li key={item.label}><strong>{item.label}:</strong> <small>{item.evidenceRefs.join(' · ')}</small></li>
        ))}
      </ul>
    </details>
  )
}

const COVERAGE_LABELS = ['Population / entity', 'Geography', 'Period', 'Grain']

function limitBullets(profile: ResearchSourceProfile): string[] {
  const bullets: string[] = []
  if (profile.coverage !== 'indexed') bullets.push(profile.coverageNote)
  for (const item of profile.facts) {
    if (item.state === 'conflicting') bullets.push(item.label + ': ' + item.value)
  }
  bullets.push(profile.joinLimitations)
  return bullets.slice(0, 3)
}

export function PriorityResearchSource({ profileId, decision }: { profileId: string; decision: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  const profile = sourceProfileForId(profileId)
  if (!profile) return null
  const returnId = 'navigator-' + profile.id
  const returnContext = (scrollY = 0) => (location.pathname === '/search'
    ? createSearchReturnContext(location, returnId, scrollY) : null)
  const detailsHref = (scrollY = 0) => datasetDetailsHref(profile.catalogRecordId!, returnContext(scrollY))
  const openDetails = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const context = returnContext(typeof window === 'undefined' ? 0 : window.scrollY)
    const navState = (typeof location.state === 'object' && location.state !== null ? location.state : {}) as Record<string, unknown>
    if (context && typeof window !== 'undefined') {
      window.history.replaceState({ ...window.history.state, usr: { ...navState, searchReturn: serializeReturnContext(context) } }, '')
    }
    navigate(detailsHref(typeof window === 'undefined' ? 0 : window.scrollY), { state: { ...navState } })
  }
  const population = factByLabel(profile, 'Population / entity')
  const variablesFact = factByLabel(profile, 'Variables / dictionary')
  const accessFact = factByLabel(profile, 'Access / cost / account')
  const coverageFacts = COVERAGE_LABELS.map((label) => factByLabel(profile, label)).filter((item): item is ResearchFact => item !== null)
  const representativeVars = (profile.representativeVars ?? []).slice(0, 5)
  return (
    <article className={'priority-source priority-source--' + profile.coverage} data-source-profile={profile.id} id={resultAnchorId(returnId)}>
      <header className="priority-source__header">
        <div>
          <p className="priority-source__family">{profile.familyId}</p>
          <h3>{profile.name}</h3>
          <p><strong>{profile.publisher}</strong> · {profile.product}</p>
        </div>
        <span className={'priority-coverage priority-coverage--' + profile.coverage}>{profile.coverageLabel}</span>
      </header>
      <p className="priority-source__note">{profile.coverageNote}</p>
      <section className="priority-brief__section" data-brief-section="useful-for" aria-label="Useful for">
        <h4>1 · Useful for</h4>
        <p>{decision}</p>
        {population && <p>{population.value}</p>}
      </section>
      <section className="priority-brief__section" data-brief-section="coverage" aria-label="Coverage">
        <h4>2 · Coverage</h4>
        <dl className="priority-source__facts">
          {coverageFacts.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd><span>{item.value}</span> <EvidenceStateBadge state={item.state} /></dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="priority-brief__section" data-brief-section="available-info" aria-label="Available info">
        <h4>3 · Available info</h4>
        {representativeVars.length > 0 ? (
          <ul className="priority-brief__vars">
            {representativeVars.map((name) => <li key={name}><code>{name}</code></li>)}
          </ul>
        ) : (
          variablesFact && <p>{variablesFact.value} <EvidenceStateBadge state={variablesFact.state} /></p>
        )}
        {profile.dictionaryUrl ? (
          <a data-dictionary-link href={profile.dictionaryUrl} target="_blank" rel="noreferrer">{profile.dictionaryLabel ?? 'Open variable dictionary'} <ExternalLink aria-hidden="true" /></a>
        ) : (
          <p className="priority-brief__nodict">No retained variable dictionary. Confirm field definitions at the publisher discovery route before analysis.</p>
        )}
      </section>
      <section className="priority-brief__section" data-brief-section="access" aria-label="Access">
        <h4>4 · Access</h4>
        <p><strong>Next action:</strong> {profile.nextAction}</p>
        {accessFact && <p>{accessFact.value} <EvidenceStateBadge state={accessFact.state} /></p>}
      </section>
      <section className="priority-brief__section" data-brief-section="limits" aria-label="Limits">
        <h4>5 · Limits</h4>
        <ul>
          {limitBullets(profile).map((bullet) => <li key={bullet}>{bullet}</li>)}
        </ul>
      </section>
      <section className="priority-brief__section" data-brief-section="evidence" aria-label="Evidence">
        <h4>6 · Evidence</h4>
        <ReadableEvidenceLinks profile={profile} />
        <TechnicalIdentifiers profile={profile} />
      </section>
      <details className="priority-brief__full-facts">
        <summary>Show all evidence-bound facts</summary>
        <FactList profile={profile} />
      </details>
      <div className="priority-source__actions">
        {profile.catalogRecordId && <Link data-navigator-details to={detailsHref()} onClick={openDetails}>View source details</Link>}
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
          <p className="eyebrow">Research question</p>
          <h2 id="priority-brief-title">Research brief</h2>
          <p className="priority-brief__question">{question.question}</p>
        </div>
        <button className="priority-packet-button" data-priority-packet type="button" title={question.packetFilename} onClick={() => downloadJsonPacket(packet, question.packetFilename)}><Download aria-hidden="true" /> Download evidence packet</button>
      </div>
      <div className="priority-brief__summary">
        <p><strong>Why this matches:</strong> {question.matchExplanation}</p>
        <p><strong>Decision it supports:</strong> {question.decision}</p>
        <p><strong>Next action:</strong> {question.nextAction}</p>
      </div>
      <p className="priority-brief__catalog">Evidence is scoped to the {ACTIVE_CATALOG.displayLabel}. The packet is metadata and routing evidence; it does not contain source payload rows.</p>
      <EvidenceStateLegend />
      <div className="priority-brief__sources">
        {question.sourceProfileIds.map((profileId) => <PriorityResearchSource key={profileId} profileId={profileId} decision={question.decision} />)}
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
          <p className="eyebrow">Research navigator · {PRIORITY_RESEARCH_QUESTIONS.length} example questions</p>
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
                <h3><Link to={'/search?q=' + encodeURIComponent(question.question)}>{question.question}</Link></h3>
                <p>{source?.coverageLabel ?? 'Evidence-bound source route'}</p>
                <Link className="priority-question-card__action" to={'/search?q=' + encodeURIComponent(question.question)}>View brief →</Link>
              </article>
            </li>
          )
        })}
      </ol>
      <p className="priority-catalog__footnote">Question set {RESEARCH_QUESTION_SET_VERSION} · {new Set(PRIORITY_RESEARCH_QUESTIONS.flatMap((question) => question.familyIds)).size} source families · candidate-only records remain explicitly labeled and are not part of the published baseline.</p>
    </section>
  )
}
