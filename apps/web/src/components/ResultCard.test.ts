import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { loadAcceptedDiscoveryFixture } from '../data/acceptedDiscoveryFixture'
import { adaptDiscoveryResponse } from '../lib/catalogAdapter'
import { assertDiscoveryResult } from '../providers/discoveryProvider'
import { ResultCard } from './ResultCard'

const acceptedResponse = await loadAcceptedDiscoveryFixture()
assertDiscoveryResult(acceptedResponse)

describe('result card six-region presentation contract', () => {
  it('shows exactly the six required scanning regions while keeping rich evidence one click down', () => {
    const result = adaptDiscoveryResponse(acceptedResponse).records[0]
    const markup = renderToStaticMarkup(createElement(
      MemoryRouter,
      {},
      createElement(ResultCard, { result, displayRank: 1 }),
    ))

    expect(markup.match(/data-result-region=/g)).toHaveLength(6)
    expect(markup).toContain(`aria-label="Result 1: ${result.title}"`)
    expect(markup).toContain('data-result-region="title"')
    expect(markup).toContain('data-result-region="description"')
    expect(markup).toContain('data-result-region="why-match"')
    expect(markup).toContain('data-result-region="geo-grain-time"')
    expect(markup).toContain('data-result-region="access-evidence"')
    expect(markup).toContain('data-result-region="details-action"')
    expect(markup).toContain('<aside class="result-card__summary" aria-label="Verification and access status">')
    expect(markup).toContain('<dl class="result-card__coverage" data-result-region="geo-grain-time">')
    expect(markup).toContain('Scoped metadata route checked')
    expect(markup).toContain('Question match')
    expect(markup).toContain('Documented match')
    expect(markup).toContain('Access')
    expect(markup).toContain('Geography')
    expect(markup).toContain('Grain')
    expect(markup).toContain('Time')
    expect(markup).toContain('View evidence and access')
    expect(markup).not.toContain('Evidence source')
    expect(markup).not.toContain('What the fields tell you:')
    expect(markup).not.toContain('Relationship:')
    expect(markup).not.toContain('Relevance:')
    expect(markup).not.toContain('Variables documented')
    expect(markup).toContain('Why it matched')
    expect(markup).toContain(result.canonicalResult.relevance.why_relevant[0] ?? 'No evidence-backed match explanation is available.')
    expect(markup).not.toContain('Live verified')
    expect(markup).toContain('Last successful metadata check')
    expect(markup).toContain('Latest catalog-metadata attempt')
    expect(markup).toContain('Payload check not attempted')
  })

  it('keeps HCRIS-style grain unresolved while inferred unit tags stay search aids', () => {
    const result = adaptDiscoveryResponse(acceptedResponse).records[0]
    const markup = renderToStaticMarkup(createElement(
      MemoryRouter,
      {},
      createElement(ResultCard, { result, displayRank: 1 }),
    ))
    expect(result.grain).toBe('Observation grain unresolved')
    expect(markup).toContain('Grain')
    expect(markup).toContain('Observation grain unresolved')
    expect(markup).not.toMatch(/<dt>Grain<\/dt><dd>Hospital/)
    expect(result.canonicalResult.record.unit_of_analysis.length).toBeGreaterThan(0)
  })

  it('changes overdue status from an advanced clock without altering evidence hashes', () => {
    const before = adaptDiscoveryResponse(acceptedResponse).records[0]
    const afterResponse = structuredClone(acceptedResponse)
    const evidenceHash = JSON.stringify(before.canonicalResult.record.evidence)
    afterResponse.results[0].metadata = {
      ...afterResponse.results[0].metadata,
      freshness: {
        verification_status: before.verification.status,
        last_checked: before.verification.metadataObservedAt,
        next_review_due: '2026-09-05T00:00:00.000Z',
        freshness_state: 'overdue',
        failed_refresh_state: 'none_recorded',
        note: 'Review is overdue; this does not by itself mean the preserved metadata is false.',
        evaluated_at: '2026-09-10T12:00:00.000Z',
        last_successful_metadata_check: before.verification.metadataObservedAt,
        latest_attempt: { at: before.verification.metadataObservedAt, outcome: 'succeeded', scope: 'catalog_metadata' },
        catalog_metadata_check: { state: before.verification.status, at: before.verification.metadataObservedAt, scope: 'catalog_metadata' },
        payload_check: { state: 'not_attempted', at: null, scope: 'payload', note: 'Catalog metadata observation is not a payload-access check.' },
        stale_status: 'review_overdue',
      },
    } as (typeof afterResponse.results)[0]['metadata']
    const after = adaptDiscoveryResponse(afterResponse).records[0]
    const beforeMarkup = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ResultCard, { result: before })))
    const afterMarkup = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ResultCard, { result: after })))
    expect(beforeMarkup).not.toContain('Review overdue')
    expect(afterMarkup).toContain('Review overdue')
    expect(JSON.stringify(after.canonicalResult.record.evidence)).toBe(evidenceHash)
  })
})
