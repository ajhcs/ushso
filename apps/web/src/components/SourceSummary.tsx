import { ExternalLink, Info } from 'lucide-react'
import type { DatasetFamily } from '../types/catalog'
import { safeExternalHttpsUrl } from '../lib/externalUrls'

export function nextSourceAction(dataset: DatasetFamily) {
  const record = dataset.canonicalResult.record
  const metadata = dataset.canonicalResult.metadata
  const payloadState = !dataset.verification.payloadCheckState || dataset.verification.payloadCheckState === 'not_attempted'
    ? 'not attempted'
    : dataset.verification.payloadCheckState.replaceAll('_', ' ')
  const route = metadata?.retrieval_plan?.access_routes?.find((step) => safeExternalHttpsUrl(step.url))
    ?? record.retrieval.instructions.find((step) => step.action !== 'stop_and_report' && safeExternalHttpsUrl(step.url))
  const url = safeExternalHttpsUrl(route?.url) ?? safeExternalHttpsUrl(record.authoritative_url)
  if (url) {
    return {
      label: 'Open the publisher page for this exact product. That page is a reachable documentation page, not proven payload or browser access.',
      href: url,
      linkText: 'Open publisher documentation',
    }
  }
  return {
    label: `No verified publisher URL is bound for this record. Payload check: ${payloadState}. Catalog membership is not payload access.`,
    href: null,
    linkText: null,
  }
}

export function SourceSummary({ dataset }: { dataset: DatasetFamily }) {
  const record = dataset.canonicalResult.record
  const metadata = dataset.canonicalResult.metadata
  const cost = metadata?.access?.cost_state ?? 'unknown'
  const quota = 'unknown'
  const lastSuccessful = dataset.verification.lastSuccessfulMetadataCheck
  const payloadState = !dataset.verification.payloadCheckState || dataset.verification.payloadCheckState === 'not_attempted'
    ? 'Not attempted'
    : dataset.verification.payloadCheckState
  const payloadNote = dataset.verification.payloadCheckNote ?? 'Catalog metadata observation is not a payload-access check.'
  const action = nextSourceAction(dataset)
  return (
    <section className="source-summary" aria-labelledby="source-summary-heading">
      <p className="section-eyebrow">Source decision</p>
      <h2 id="source-summary-heading">What this source is, how to use it, and what was tested</h2>
      <dl>
        <div><dt>Purpose</dt><dd>{dataset.description}</dd></div>
        <div><dt>Exact product / release</dt><dd>{record.identity.asset.asset_type} · publisher release {metadata?.dates?.publisher_release_date ?? 'unknown'}</dd></div>
        <div><dt>Observed coverage / grain</dt><dd>{dataset.geographicApplicability} · {dataset.grain} · {dataset.availableYears}</dd></div>
        <div><dt>Access requirements</dt><dd>{dataset.accessStatusLabel}. Cost: {cost}. Usage limits: {quota}.</dd></div>
        <div><dt>Last successful metadata check</dt><dd>{lastSuccessful ?? 'Unknown'}. Payload check: {payloadState}. {payloadNote}</dd></div>
      </dl>
      <div className="source-summary__action">
        <p><strong>Clear source action:</strong> {action.label}</p>
        {action.href ? <a href={action.href} target="_blank" rel="noreferrer">{action.linkText} <ExternalLink aria-hidden="true" /></a> : <p>Stay on this page and inspect the documented access route, schema, and join limitations.</p>}
      </div>
      <p className="source-summary__boundary"><Info aria-hidden="true" />Unknown cost and usage limits remain visible. A catalog membership check is not payload access.</p>
    </section>
  )
}
