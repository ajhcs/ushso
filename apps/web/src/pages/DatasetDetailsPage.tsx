import { AlertTriangle, Clock3, ExternalLink, Flag, Info, ShieldCheck } from 'lucide-react'
import { type ReactNode, lazy, Suspense, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { downloadJsonPacket } from '../lib/searchReceipt'
import { ObservatoryFooter } from '../components/ObservatoryFooter'
import { ObservatoryHeader } from '../components/ObservatoryHeader'
import { ResearcherDecisionSummary } from '../components/ResearcherDecisionSummary'
import { SourceSummary } from '../components/SourceSummary'
import { VariableBrowser } from '../components/VariableBrowser'
import { DictionaryReviewPanel } from '../components/DictionaryReviewPanel'
import { SHORTLIST_CHANGED_EVENT, addShortlistItem, isOnShortlist, rememberLastSeenGeneration, removeShortlistItem } from '../lib/shortlist'
import { findDatasetInResponse } from '../lib/catalogAdapter'
import { datasetDocumentTitle, setDocumentTitle } from '../lib/documentTitle'
import { safeExternalHttpsUrl } from '../lib/externalUrls'
import { parseReturnContext, resultAnchorId, safeReturnDestination } from '../lib/returnContext'
import { assessmentGeneration, readSearchAssessment } from '../lib/searchAssessment'
import { useDatasetResult } from '../providers/DiscoveryProviderContext'
import type { DatasetFamily } from '../types/catalog'
import type { ObservatoryRecord } from '../types/discovery'
const ScientificReviewPanel = lazy(() => import('../components/ScientificReviewPanel'))

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short' }).format(date)
}

function sentenceCase(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function evidenceAnchor(evidenceId: string) {
  return `evidence-${encodeURIComponent(evidenceId)}`
}

function ClaimValue({ children, evidenceIds = [] }: { children: ReactNode; evidenceIds?: string[] }) {
  return <span>{children}{evidenceIds.length > 0
    ? <> <a className="claim-evidence-link" href={`#${evidenceAnchor(evidenceIds[0])}`}>Evidence<span className="sr-only"> for this claim</span></a></>
    : <small className="claim-unresolved">No claim-level evidence linked</small>}</span>
}

function descriptionHasEncodingDamage(value: string) {
  return /\uFFFD|(?:Ã.|Â.|â€|â€™|â€œ|â€)/u.test(value)
}

function payloadCheckStateLabel(state: string | undefined) {
  if (!state || state === 'not_attempted') return 'Not attempted'
  return sentenceCase(state)
}

export function freshnessPresentation(dataset: DatasetFamily) {
  const projected = dataset.canonicalResult.metadata?.freshness
  const overdue = projected?.freshness_state === 'overdue' || dataset.verification.freshnessState === 'overdue'
  const due = projected?.next_review_due ?? dataset.verification.nextReviewDue
  const label = overdue
    ? `Review overdue${due ? ` since ${formatDate(due)}` : ''}`
    : projected?.freshness_state === 'within_review_window' && due
      ? `Next review due ${formatDate(due)}`
      : 'Review schedule not published'
  return {
    label,
    overdue,
    note: projected?.note,
    lastSuccessful: dataset.verification.lastSuccessfulMetadataCheck,
    latestAttempt: dataset.verification.latestAttemptAt,
    latestAttemptOutcome: dataset.verification.latestAttemptOutcome ?? 'unknown',
    payloadState: payloadCheckStateLabel(dataset.verification.payloadCheckState ?? projected?.payload_check?.state),
    payloadNote: dataset.verification.payloadCheckNote ?? projected?.payload_check?.note ?? 'Catalog metadata observation is not a payload-access check.',
    stale: dataset.verification.staleStatus === 'stale_historical_success' || dataset.verification.status === 'stale' || projected?.stale_status === 'stale_historical_success',
  }
}

function relationshipSummary(record: ObservatoryRecord, siblingCount: number) {
  const family = record.identity.family
  const supported = siblingCount > 0 && family.evidence_ids.length > 0 && ['exact', 'source_asserted'].includes(family.resolution_state)
  if (supported) return `${siblingCount + 1} evidence-linked records in this related set`
  if (family.candidate_family_ids.length > 0) return 'Possible relationships are recorded but not confirmed'
  return 'No evidence-backed dataset-family relationship is established'
}

const HOSPITAL_PROVIDER_COST_REPORT_ID = 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17'
const NHIS_ADULT_SUMMARY_ID = 'obs:asset:cdc-socrata:25m4-6qqq-0c32f3a6fa05807f'

export function sourceGuidance(record: ObservatoryRecord) {
  if (record.record_id === HOSPITAL_PROVIDER_COST_REPORT_ID) return {
    heading: 'CMS Hospital Provider Cost Report decision notes',
    points: [
      'This product presents selected hospital-level measures drawn from HCRIS; it is not the complete raw HCRIS file set.',
      'CMS documents the public-use file as free and annually updated. Confirm the reporting period and measure definition before analysis.',
      'Use the methodology and data dictionary below to inspect aggregation and field definitions.',
    ],
    links: [
      ['CMS product page', 'https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report'],
      ['CMS methodology', 'https://data.cms.gov/sites/default/files/2024-10/aba118b3-4f1f-45a4-8c61-b392d96b1b12/Hospital%20Provider%20Cost%20Report%20Methodology_2024_508%20Approved.pdf'],
    ],
  }
  if (record.record_id === NHIS_ADULT_SUMMARY_ID) return {
    heading: 'NHIS decision notes',
    points: [
      'This indexed product contains summary estimates; it must not be described as respondent-level NHIS microdata.',
      'Estimate suppression follows applicable NCHS presentation standards. Review the source methodology, denominators, and reliability rules before comparing estimates.',
    ],
    links: [['CDC NHIS source notes', 'https://www.cdc.gov/vision-health-data/data-sources/national-health-interview-survey.html']],
  }
  return null
}

function DetailsShortlist({ recordId, title, sourceName, detailsPath, generation }: { recordId: string; title: string; sourceName: string; detailsPath: string; generation: string }) {
  const [saved, setSaved] = useState(() => isOnShortlist(recordId))
  useEffect(() => {
    const refresh = () => setSaved(isOnShortlist(recordId))
    refresh()
    if (typeof window === 'undefined') return
    window.addEventListener(SHORTLIST_CHANGED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(SHORTLIST_CHANGED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [recordId])
  const toggle = () => {
    if (saved) removeShortlistItem(recordId)
    else addShortlistItem({ record_id: recordId, title, source_name: sourceName, details_path: detailsPath, generation })
    setSaved(isOnShortlist(recordId))
  }
  return <button type="button" className="details-shortlist" onClick={toggle}>{saved ? 'Remove from local shortlist' : 'Save to local shortlist'}</button>
}

export function DatasetDetailsPage() {
  const { datasetId = '' } = useParams()
  const location = useLocation()
  const discovery = useDatasetResult(datasetId)

  useEffect(() => {
    if (discovery.status === 'loading') setDocumentTitle(datasetDocumentTitle(null, 'loading'))
    else if (discovery.status === 'error') setDocumentTitle(datasetDocumentTitle(null, discovery.error.code === 'record_not_found' ? 'not_found' : 'error'))
    else {
      const dataset = findDatasetInResponse(discovery.result, datasetId)
      setDocumentTitle(datasetDocumentTitle(dataset?.title, dataset ? 'ready' : 'unavailable'))
    }
  }, [datasetId, discovery])
  useEffect(() => {
    if (discovery.status !== 'ready') return
    rememberLastSeenGeneration(discovery.result.corpus.publication?.generation ?? discovery.result.corpus.generation ?? `${discovery.result.corpus.corpus_id} ${discovery.result.corpus.corpus_version}`)
  }, [discovery])

  if (discovery.status === 'loading') return <div className="standard-page"><ObservatoryHeader compact /><main id="main-content" className="standard-page__main discovery-state" aria-busy="true"><span className="discovery-state__spinner" aria-hidden="true" /><h1>Loading source details…</h1><p>Dereferencing the stable published record and its evidence boundary.</p></main><ObservatoryFooter /></div>

  if (discovery.status === 'error') {
    const missing = discovery.error.code === 'record_not_found'
    return <div className="standard-page"><ObservatoryHeader compact /><main id="main-content" className="standard-page__main discovery-state discovery-state--error" role="alert"><h1>{missing ? 'Dataset record not found' : 'Source details are unavailable'}</h1><p>{discovery.error.message}</p><Link className="button-link" to="/search">Browse published sources</Link></main><ObservatoryFooter /></div>
  }

  const dataset = findDatasetInResponse(discovery.result, datasetId)
  if (!dataset) {
    return <div className="standard-page"><ObservatoryHeader compact /><main id="main-content" className="standard-page__main discovery-state discovery-state--error" role="alert"><h1>Dataset record not found</h1><p>No published record has this identifier in the current catalog generation. A missing record is not replaced with a silent stale-context page.</p><Link className="button-link" to="/search">Browse published sources</Link></main><ObservatoryFooter /></div>
  }

  const record = dataset.canonicalResult.record
  const metadata = dataset.canonicalResult.metadata
  const freshness = freshnessPresentation(dataset)
  const guidance = sourceGuidance(record)
  const rawAccessRoutes = metadata?.retrieval_plan?.access_routes ?? record.retrieval.instructions.filter((step) => step.action !== 'stop_and_report' && step.url)
  const accessRoutes = rawAccessRoutes.flatMap((step) => {
    const url = safeExternalHttpsUrl(step.url)
    return url ? [{ ...step, url }] : []
  })
  const unresolvedRoutes = [
    ...(metadata?.retrieval_plan?.unresolved_routes ?? record.retrieval.instructions.filter((step) => step.action !== 'stop_and_report' && !step.url)),
    ...rawAccessRoutes.filter((step) => safeExternalHttpsUrl(step.url) === null).map((step) => ({ ...step, original_url: step.url, url: null })),
  ]
  const stopConditions = metadata?.retrieval_plan?.stop_conditions ?? record.retrieval.instructions.filter((step) => step.action === 'stop_and_report')
  const routeParams = new URLSearchParams(location.search)
  const returnContext = parseReturnContext(routeParams.get('return'))
  const contextualQuestion = returnContext?.selected_record_id.replace(/^obs:asset:/, '') === record.record_id.replace(/^obs:asset:/, '') ? new URLSearchParams(returnContext.search).get('q') : null
  const searchAssessment = contextualQuestion ? readSearchAssessment(location.state?.searchAssessment, record.record_id, contextualQuestion, assessmentGeneration(discovery.result)) : null
  const safeBackDestination = `${safeReturnDestination(routeParams.get('return'))}${returnContext ? `#${resultAnchorId(returnContext.selected_record_id)}` : ''}`
  const sourceDocuments = [
    ...accessRoutes.map((step) => ({ label: 'Verified navigation route', url: step.url })),
    ...(record.authoritative_url ? [{ label: 'Authoritative source', url: record.authoritative_url }] : []),
    ...record.provenance.map((source) => ({ label: source.kind === 'documentation' ? 'Publisher documentation' : 'Preserved source locator', url: source.locator })),
    ...(record.variable_documentation?.codebook ? [{ label: record.variable_documentation.codebook.title, url: record.variable_documentation.codebook.url }] : []),
  ].map((item) => ({ ...item, url: safeExternalHttpsUrl(item.url) }))
    .filter((item): item is { label: string; url: string } => item.url !== null)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.url === item.url) === index)
  const catalogGeneration = discovery.result.corpus.publication?.generation ?? discovery.result.corpus.generation ?? `${discovery.result.corpus.corpus_id} ${discovery.result.corpus.corpus_version}`
  const pageUrl = typeof window === 'undefined' ? `/datasets/${encodeURIComponent(datasetId)}` : window.location.href.split('?')[0]
  const correctionBody = [`Record ID: ${record.record_id}`, `Catalog generation: ${discovery.result.corpus.corpus_id} ${discovery.result.corpus.corpus_version}`, `Page URL: ${pageUrl}`, 'Affected field: ', '', 'Authoritative supporting link: ', '', 'Correction description: ', '', 'Do not include the originating search question or protected health information.'].join('\n')
  const correctionHref = `mailto:info@ushso.org?subject=${encodeURIComponent(`Metadata correction: ${record.record_id}`)}&body=${encodeURIComponent(correctionBody)}`
  const displayedDescription = metadata?.description_quality?.display_description ?? record.description
  const corrupted = metadata?.description_quality?.state === 'suspected_encoding_corruption' || (!metadata?.description_quality && descriptionHasEncodingDamage(record.description))
  const dimensions = metadata?.dimensions

  return (
    <div className="details-page">
      <ObservatoryHeader compact />
      <main id="main-content" className="details-page__main">
        <Link className="back-link" to={safeBackDestination} state={returnContext ? { searchReturn: routeParams.get('return') } : undefined}>← <span>{returnContext ? 'Return to these search results' : 'Browse published sources'}</span></Link>
        <header className="details-page__heading">
          <p>{record.identity.source.name} · {sentenceCase(record.identity.asset.asset_type)}</p>
          <h1>{dataset.title}</h1>
          <p>{displayedDescription}</p>
          {corrupted && <div className="text-quality-notice" role="note"><AlertTriangle aria-hidden="true" /><p><strong>Source text may contain encoding damage.</strong> The captured wording is preserved without guessing at missing symbols. {metadata?.description_quality?.authoritative_url && <a href={metadata.description_quality.authoritative_url} target="_blank" rel="noreferrer">Check the publisher’s current page <ExternalLink aria-hidden="true" /></a>}</p></div>}
        </header>

         {contextualQuestion && <section className="context-relevance" aria-label="Search relevance context"><strong>{searchAssessment ? `${searchAssessment.relevance} relevance in the originating search` : 'Originating search context'}</strong><p>Question: “{contextualQuestion}”</p>{searchAssessment ? <><p>Ranking version: {searchAssessment.ranking_version}. Catalog generation: {searchAssessment.generation}.</p><ul>{searchAssessment.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul><p>This is the assessment saved from the originating search, not a scientific-quality or fitness rating.</p></> : <p>No matching search assessment is available on this record lookup. Return to the search results to inspect relevance; no relevance rating is inferred.</p>}</section>}

        <p className="details-learn-link"><Link to="/learn#read-source">How to read a source page</Link>. Finding a source is not obtaining the data.</p>
        <SourceSummary dataset={dataset} />
        <p className="details-packet"><button className="receipt-button" type="button" onClick={() => downloadJsonPacket({
          format: 'ushso.source-evidence-packet.v1',
          record_id: record.record_id,
          title: dataset.title,
          publisher: record.identity.source.name,
          generation: discovery.result.corpus.publication?.generation ?? discovery.result.corpus.generation ?? null,
          access: metadata?.access ?? record.access,
          geography: dataset.geographicApplicability,
          grain: dataset.grain,
          time: dataset.availableYears,
          payload_check: freshness.payloadState,
          join_routes: dataset.joinRoutes,
          evidence_ids: record.evidence.map((item) => item.evidence_id),
          limitation: 'Catalog membership is not payload access. This packet is the displayed source facts, not scientific acceptance.',
        }, `ushso-source-packet-${record.record_id.replace(/[^a-z0-9.-]+/gi, '-').slice(0, 48)}.json`)}>Download source evidence packet</button></p>
        <DetailsShortlist recordId={record.record_id} title={dataset.title} sourceName={record.identity.source.name} detailsPath={dataset.detailsUrl} generation={discovery.result.corpus.publication?.generation ?? discovery.result.corpus.generation ?? `${discovery.result.corpus.corpus_id} ${discovery.result.corpus.corpus_version}`} />
        <ResearcherDecisionSummary dataset={dataset} />

        <div className="details-grid details-grid--decision">
          <section aria-labelledby="details-content-heading">
            <p className="section-eyebrow">Preliminary inclusion decision</p>
            <h2 id="details-content-heading">Purpose, content, and coverage</h2>
            <dl className="details-list details-list--decision">
              <div><dt>Publisher</dt><dd><ClaimValue evidenceIds={record.evidence.map((item) => item.evidence_id).slice(0, 1)}>{record.identity.source.name}</ClaimValue></dd></div>
              <div><dt>Observation grain</dt><dd><ClaimValue>{dataset.grain}</ClaimValue></dd></div>
              <div><dt>Sampled entity</dt><dd><ClaimValue>{dimensions?.sampled_entity.values.map(sentenceCase).join(', ') || 'Unknown'}</ClaimValue></dd></div>
              <div><dt>Population universe</dt><dd><ClaimValue>{dimensions?.population_universe.values.join(', ') || 'Unknown'}</ClaimValue></dd></div>
              <div><dt>Reporting organization</dt><dd><ClaimValue>{dimensions?.reporting_organization.values.join(', ') || 'Unknown'}</ClaimValue></dd></div>
              <div><dt>Geography</dt><dd><ClaimValue evidenceIds={record.geography.evidence_ids}>{dataset.geographicApplicability}</ClaimValue></dd></div>
              <div><dt>Observation period</dt><dd><ClaimValue evidenceIds={record.time_coverage.evidence_ids}>{dataset.availableYears}</ClaimValue></dd></div>
              <div><dt>Publisher release</dt><dd>{metadata?.dates?.publisher_release_date ?? 'Unknown'}</dd></div>
              <div><dt>Publisher revision</dt><dd>{metadata?.dates?.publisher_revision_date ?? 'Unknown'}</dd></div>
              <div><dt>Projection horizon</dt><dd>{metadata?.dates?.projection_horizon ?? 'Not documented'}</dd></div>
              <div><dt>Access</dt><dd><ClaimValue evidenceIds={record.access.evidence_ids}>{dataset.accessStatusLabel}</ClaimValue></dd></div>
              <div><dt>Relationship</dt><dd>{relationshipSummary(record, dataset.familySiblingCount)}</dd></div>
            </dl>
          </section>

          <aside className="details-access" aria-labelledby="details-access-heading">
            <p className="section-eyebrow">Publisher routes and boundaries</p>
            <h2 id="details-access-heading">Access and requirements</h2>
            <p className="details-access__summary">Documented status: <strong>{dataset.accessStatusLabel}</strong>. {record.access.restriction_note ?? 'No source-specific restriction note was captured.'}</p>
            {metadata?.access && <dl className="access-dimensions"><div><dt>Catalog visibility</dt><dd>{sentenceCase(metadata.access.catalog_visibility)}</dd></div><div><dt>Payload access</dt><dd>{sentenceCase(metadata.access.payload_access)}</dd></div><div><dt>Cost</dt><dd>{sentenceCase(metadata.access.cost_state)}</dd></div></dl>}
            {record.access.requirements.length > 0 && <p className="access-requirements"><strong>Requirements:</strong> {record.access.requirements.join(', ')}</p>}
            <h3 className="details-access__subheading">Access routes</h3>
            {accessRoutes.length === 0 && unresolvedRoutes.length === 0 ? <p className="route-state">No access route is documented.</p> : accessRoutes.map((step) => <div className="details-access__path" key={`${record.record_id}:${step.sequence}`}><h4>{sentenceCase(step.action)}</h4><p>{step.instruction}</p><a href={step.url!} target="_blank" rel="noreferrer">Open source route <ExternalLink aria-hidden="true" /></a></div>)}
            {unresolvedRoutes.map((step) => <div className="details-access__path" key={`${record.record_id}:unresolved:${step.sequence}`}><h4>{sentenceCase(step.action)}</h4><p>{step.instruction}</p><p className="unresolved-link"><Info aria-hidden="true" />This route’s source URL is unresolved.</p></div>)}
            {stopConditions.length > 0 && <div className="stop-conditions"><h3>Stop conditions and limitations</h3><ul>{stopConditions.map((step) => <li key={`${record.record_id}:stop:${step.sequence}`}>{step.instruction}</li>)}</ul></div>}
            <p className="access-boundary">Publisher-documented availability is separate from a download or endpoint successfully tested by USHSO.</p>
          </aside>
        </div>

        {guidance ? <section className="decision-guidance" aria-labelledby="decision-guidance-heading"><div><Info aria-hidden="true" /><h2 id="decision-guidance-heading">{guidance.heading}</h2></div><ul>{guidance.points.map((point) => <li key={point}>{point}</li>)}</ul><p>{guidance.links.map(([label, url], index) => <span key={url}>{index > 0 && ' · '}<a href={url} target="_blank" rel="noreferrer">{label} <ExternalLink aria-hidden="true" /></a></span>)}</p></section> : <section className="decision-guidance decision-guidance--unresolved" aria-labelledby="decision-guidance-heading"><div><Info aria-hidden="true" /><h2 id="decision-guidance-heading">Research-use guidance is unresolved</h2></div><p>No source-specific scientific decision card has been reviewed for this record. Inspect the publisher documents and evidence below before deciding whether to use it.</p></section>}

        <div className="details-evidence-grid">
          <section className="details-panel" aria-labelledby="documentation-heading">
            <div className="details-panel__heading"><ExternalLink aria-hidden="true" /><div><p className="details-panel__eyebrow">Publisher and captured locators</p><h2 id="documentation-heading">Source documentation</h2></div></div>
            {sourceDocuments.length > 0 ? <ul className="source-document-list">{sourceDocuments.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label} <ExternalLink aria-hidden="true" /></a></li>)}</ul> : <p>No source or documentation URL is resolved.</p>}
            <dl className="details-list"><div><dt>Update frequency</dt><dd><ClaimValue>{sentenceCase(record.freshness_verification.update_frequency)}</ClaimValue></dd></div><div><dt>Variable documentation</dt><dd><ClaimValue evidenceIds={record.variable_documentation?.evidence_ids}>{sentenceCase(dataset.variableDetails.status)}{dataset.variableDetails.variableCount !== null ? ` · ${dataset.variableDetails.variableCount} fields` : ''}</ClaimValue></dd></div></dl>
          </section>

          <section className={`details-panel freshness-panel${freshness.overdue ? ' freshness-panel--overdue' : ''}`} aria-labelledby="verification-heading">
            <div className="details-panel__heading"><Clock3 aria-hidden="true" /><div><p className="details-panel__eyebrow">Freshness is separate from historical evidence</p><h2 id="verification-heading">Verification and review</h2></div></div>
            <p className="freshness-state"><strong>{freshness.label}</strong>{freshness.note && <span>{freshness.note}</span>}{freshness.stale && <span> Historical metadata success is stale.</span>}</p>
            <dl className="details-list">
              <div><dt>Last successful metadata check</dt><dd>{freshness.lastSuccessful ? <time dateTime={freshness.lastSuccessful}>{formatDate(freshness.lastSuccessful)}</time> : 'Unknown'}</dd></div>
              <div><dt>Latest catalog-metadata attempt</dt><dd>{freshness.latestAttempt ? <time dateTime={freshness.latestAttempt}>{formatDate(freshness.latestAttempt)}</time> : 'Unknown'} · {sentenceCase(freshness.latestAttemptOutcome)}</dd></div>
              <div><dt>Historical status</dt><dd>{sentenceCase(metadata?.freshness?.verification_status ?? record.freshness_verification.verification_status)}</dd></div>
              <div><dt>Failed refresh</dt><dd>{sentenceCase(metadata?.freshness?.failed_refresh_state ?? 'None recorded')}</dd></div>
              <div><dt>Payload check</dt><dd>{freshness.payloadState}. {freshness.payloadNote}</dd></div>
              <div><dt>Data through</dt><dd>{record.freshness_verification.data_through ?? 'Unknown'}</dd></div>
            </dl>
            <p className="freshness-boundary">An overdue review does not imply that the captured metadata is false. Catalog metadata success is not payload access. A failed refresh, when recorded, must remain distinct from the earlier successful observation.</p>
          </section>
        </div>

        <section className="details-panel evidence-dossier" aria-labelledby="evidence-heading">
          <div className="details-panel__heading"><ShieldCheck aria-hidden="true" /><div><p className="details-panel__eyebrow">Claim-level audit trail</p><h2 id="evidence-heading">Evidence dossier</h2></div></div>
          {record.evidence.length === 0 ? <p>No claim evidence is linked; substantive facts remain unresolved.</p> : record.evidence.map((evidence) => {
            const sources = record.provenance.filter((source) => evidence.provenance_ids.includes(source.provenance_id))
            return <details className="evidence-claim" id={evidenceAnchor(evidence.evidence_id)} key={evidence.evidence_id}><summary><span>{evidence.claim}</span><small>{sentenceCase(evidence.state)}</small></summary><dl><div><dt>Evidence ID</dt><dd>{evidence.evidence_id}</dd></div>{sources.map((source) => <div className="evidence-source" key={source.provenance_id}><dt>{sentenceCase(source.kind)}</dt><dd><a href={source.locator} target="_blank" rel="noreferrer">Open source locator <ExternalLink aria-hidden="true" /></a><span>Captured: <time dateTime={source.observed_at}>{formatDate(source.observed_at)}</time></span><span>Capture: {sentenceCase(source.capture_state)}</span><span>Evidence hash: {source.content_sha256 ?? 'No content hash captured'}</span><span>Provenance ID: {source.provenance_id}</span></dd></div>)}</dl>{sources.length === 0 && <p>No specific source passage is linked. A broader claim reference is preserved without fabricating an excerpt.</p>}{evidence.limitations.length > 0 && <p className="evidence-limit"><b>Evidence boundary:</b> {evidence.limitations.join(' ')}</p>}</details>
          })}
        </section>

        <VariableBrowser dataset={dataset} />
        <details className="technical-details"><summary>Machine fields, identity, variables, and join routes</summary><div className="technical-details__content"><section aria-labelledby="technical-identity-heading"><h2 id="technical-identity-heading">Technical identity</h2><dl><div><dt>Record ID</dt><dd>{record.record_id}</dd></div><div><dt>Family resolution</dt><dd>{sentenceCase(record.identity.family.resolution_state)} · {relationshipSummary(record, dataset.familySiblingCount)}</dd></div><div><dt>Retrieval interface</dt><dd>{sentenceCase(record.retrieval.preferred_interface)}</dd></div><div><dt>Catalog generation</dt><dd>{discovery.result.corpus.corpus_id} · {discovery.result.corpus.corpus_version}</dd></div></dl></section><section aria-labelledby="technical-variable-heading"><h2 id="technical-variable-heading">Variables</h2>{dataset.variableDetails.variables.length === 0 ? <p>No variable list is captured.</p> : <dl className="variable-list">{dataset.variableDetails.variables.map((variable) => <div key={variable.name}><dt>{variable.label ?? variable.name}</dt><dd><p>{variable.description}</p><small>{[variable.data_type, variable.unit].filter(Boolean).join(' · ') || 'Source-defined field'}</small></dd></div>)}</dl>}</section><section aria-labelledby="technical-joins-heading"><h2 id="technical-joins-heading">Join routes</h2>{dataset.joinRoutes.length === 0 ? <p>No join route is documented for this record. An unresolved join is not a confirmed merge.</p> : dataset.joinRoutes.map((route) => <article className="join-route" key={route.route_id}><h3>{route.entity}: {route.compatibility_state}</h3><p className="join-unconfirmed">An unresolved or candidate join is not a confirmed merge.</p><dl><div><dt>Route</dt><dd>{route.from_record_id} → {route.to_record_id}</dd></div><div><dt>Strategy</dt><dd>{route.match_strategy}</dd></div><div><dt>Cardinality</dt><dd>{route.cardinality}</dd></div><div><dt>Prerequisites</dt><dd>{route.preconditions.join(' · ') || 'None documented.'}</dd></div><div><dt>Caveats</dt><dd>{route.caveats.join(' · ') || 'None documented.'}</dd></div></dl></article>)}</section></div></details>

        <DictionaryReviewPanel key={record.record_id} recordId={record.record_id} />
        {new URLSearchParams(location.search).get('scientific_review') === '1' && typeof discovery.result.corpus.publication?.generation === 'string' ? <Suspense fallback={<p role="status">Loading scientific review panel…</p>}><ScientificReviewPanel key={record.record_id} recordId={record.record_id} generation={discovery.result.corpus.publication.generation} /></Suspense> : null}
        <section className="record-correction" aria-labelledby="record-correction-heading"><Flag aria-hidden="true" /><div><h2 id="record-correction-heading">See a metadata problem?</h2><p>The correction email includes this record and catalog generation, but not your research question. Do not include protected health information or sensitive security details.</p><a href={correctionHref} target="_blank" rel="noreferrer">Report a metadata issue <ExternalLink aria-hidden="true" /></a></div></section>
      </main>
      <ObservatoryFooter results />
    </div>
  )
}
