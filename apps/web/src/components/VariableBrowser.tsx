import { useMemo, useState } from 'react'
import type { DatasetFamily } from '../types/catalog'

const HCRIS_HOSPITAL_COST_REPORT_ID = 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17'
const HCRIS_RELEASE_ID = 'release.cms.hcris.documentation'
const HCRIS_DISTRIBUTION_ID = 'distribution.cms.hcris.landing-page'
const HCRIS_SCHEMA_ID = 'schema.cms.hcris.worksheet-g3.accepted'

const HCRIS_FIELDS = [
  { native_name: 'PROVNUM', label: 'Provider number', definition: 'CMS Certification Number / provider number on the hospital cost report.', unit: 'identifier', example_kind: 'synthetic' as const, example: 'synthetic CCN pattern only; not a live row' },
  { native_name: 'NET_PATIENT_REVENUE', label: 'Net patient revenue', definition: 'Net patient revenue from HCRIS Worksheet G-3 as used in the accepted example packet.', unit: 'unknown', example_kind: 'synthetic' as const, example: 'numeric measure; not a live value' },
]

export function VariableBrowser({ dataset, selectedReleaseId = HCRIS_RELEASE_ID, selectedDistributionId = HCRIS_DISTRIBUTION_ID }: { dataset: DatasetFamily; selectedReleaseId?: string; selectedDistributionId?: string }) {
  const record = dataset.canonicalResult.record
  const [query, setQuery] = useState('')
  const contextMatches = record.record_id === HCRIS_HOSPITAL_COST_REPORT_ID && selectedReleaseId === HCRIS_RELEASE_ID && selectedDistributionId === HCRIS_DISTRIBUTION_ID
  const fields = useMemo(() => {
    if (!contextMatches) return []
    const needle = query.trim().toLowerCase()
    return HCRIS_FIELDS.filter((field) => !needle || field.native_name.toLowerCase().includes(needle) || field.label.toLowerCase().includes(needle))
  }, [contextMatches, query])
  return (
    <section className="variable-browser" aria-labelledby="variable-browser-heading" data-release-id={selectedReleaseId} data-distribution-id={selectedDistributionId} data-schema-id={HCRIS_SCHEMA_ID}>
      <p className="section-eyebrow">Selected release / distribution</p>
      <h2 id="variable-browser-heading">Fields for this exact context</h2>
      <p>Preview is bound to {selectedReleaseId} / {selectedDistributionId}. Changing context cannot retain an incompatible cached dictionary.</p>
      {!contextMatches ? <p role="status">No qualified field list is bound to this release/distribution pair.</p> : (
        <>
          <label className="variable-browser__search">Search wire names or labels<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <ul>
            {fields.map((field) => (
              <li key={field.native_name}>
                <code>{field.native_name}</code>
                <strong>{field.label}</strong>
                <p>{field.definition}</p>
                <small>Unit: {field.unit}. Example: {field.example_kind} — {field.example}</small>
              </li>
            ))}
          </ul>
        </>
      )}
      <aside className="variable-browser__proposals" aria-label="Pending dictionary proposals">
        <h3>Pending dictionary proposals</h3>
        <p>Unapproved dictionary documentation is not a canonical schema. Proposals stay in this distinct review region.</p>
      </aside>
    </section>
  )
}
