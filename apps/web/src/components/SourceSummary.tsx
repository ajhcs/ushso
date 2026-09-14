import { ExternalLink, Info } from 'lucide-react'
import type { DatasetFamily } from '../types/catalog'

const HCRIS_HOSPITAL_COST_REPORT_ID = 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17'
const CMS_LANDING = 'https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report'

export function SourceSummary({ dataset }: { dataset: DatasetFamily }) {
  const record = dataset.canonicalResult.record
  const metadata = dataset.canonicalResult.metadata
  const hcris = record.record_id === HCRIS_HOSPITAL_COST_REPORT_ID
  const cost = metadata?.access?.cost_state ?? 'unknown'
  const quota = metadata?.access?.usage_limit_state ?? 'unknown'
  const lastSuccessful = dataset.verification.lastSuccessfulMetadataCheck
  const payloadState = !dataset.verification.payloadCheckState || dataset.verification.payloadCheckState === 'not_attempted'
    ? 'Not attempted'
    : dataset.verification.payloadCheckState
  const payloadNote = dataset.verification.payloadCheckNote ?? 'Catalog metadata observation is not a payload-access check.'
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
      {hcris && (
        <div className="source-summary__action">
          <p><strong>Clear source action:</strong> Open the CMS Hospital Provider Cost Report landing page. This is a reachable documentation page, not proven payload or browser access.</p>
          <p>Accepted Worksheet G-3 wire mappings are not a complete HCRIS schema. Inferred unit tags are search aids only and are not source-asserted observation grain.</p>
          <a href={CMS_LANDING} target="_blank" rel="noreferrer">Open CMS documentation <ExternalLink aria-hidden="true" /></a>
        </div>
      )}
      <p className="source-summary__boundary"><Info aria-hidden="true" />Unknown cost and usage limits remain visible. A catalog membership check is not payload access.</p>
    </section>
  )
}
