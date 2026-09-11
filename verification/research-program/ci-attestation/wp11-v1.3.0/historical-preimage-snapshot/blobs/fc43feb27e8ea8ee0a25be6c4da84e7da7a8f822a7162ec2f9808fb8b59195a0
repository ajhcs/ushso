import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CoveragePositioning } from '../components/CoveragePositioning'
import { coveragePositioning } from './coveragePositioning'

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const wp9ViewPath = `${repositoryRoot}packages/coverage/accounting/v1.0.0/artifacts/public-coverage-view.json`

describe('WP9 public coverage browser projection', () => {
  it('is byte-for-field pinned to the sealed service artifact and remains unapproved', async () => {
    const source = JSON.parse(await readFile(wp9ViewPath, 'utf8')) as Record<string, any>

    expect(coveragePositioning.coverageSnapshotId).toBe(source.coverage_snapshot_id)
    expect(coveragePositioning.coverageSnapshotDigest).toBe(source.coverage_snapshot_digest)
    expect(coveragePositioning.matrixMembershipDigest).toBe(source.matrix_summary.membership_manifest_hash)
    expect(coveragePositioning.asOf).toBe(source.as_of)
    expect(coveragePositioning.headline).toBe(source.positioning.headline)
    expect(coveragePositioning.federalBackbone).toBe(source.positioning.federal_backbone)
    expect(coveragePositioning.jurisdictionBoundary).toBe(source.positioning.jurisdiction_boundary)
    expect(coveragePositioning.corpusBoundary).toBe(source.positioning.corpus_boundary)
    expect(coveragePositioning.zeroResultBoundary).toBe(source.positioning.zero_result_boundary)
    expect(coveragePositioning.nonAdditivity).toBe(source.positioning.non_additivity)
    expect(coveragePositioning.ownerReview.status).toBe(source.positioning.product_owner_review_status)
    expect(coveragePositioning.ownerReview.publicationAuthorized).toBe(false)
    expect(coveragePositioning.ownerReview.authorizationRequirementId).toBe('AUTH-15')
    expect(coveragePositioning.concepts.federalSourceScopes).toMatchObject({
      count: source.federal_applicability.denominator_count,
      direct: source.federal_applicability.direct,
      crosswalkRequired: source.federal_applicability.crosswalk_required,
      unknown: source.federal_applicability.unknown,
    })
    expect(coveragePositioning.concepts.jurisdictions.count).toBe(51)
    expect(coveragePositioning.concepts.assessmentCells.count).toBe(source.matrix_summary.denominator_count)
    expect(coveragePositioning.concepts.assessmentCells.notAssessed).toBe(source.matrix_summary.coverage_cell_state_distribution.not_assessed)
    expect(coveragePositioning.concepts.corpusRecords.count).toBe(157)
    expect(coveragePositioning.revisions.registry).toBe(source.revisions.registry_revision.value)
    expect(coveragePositioning.revisions.sourceScope).toBe(source.revisions.source_scope_revision.value)
    expect(coveragePositioning.revisions.policy).toBe(source.revisions.policy_revision.value)
    expect(coveragePositioning.revisions.indexGeneration).toBe(source.revisions.index_generation.value)
  })

  it('renders units, snapshot, as-of, non-additivity, and pending review accessibly', () => {
    const markup = renderToStaticMarkup(createElement(CoveragePositioning))
    expect(markup).toContain('aria-labelledby="coverage-positioning-heading"')
    expect(markup).toContain('data-owner-review-status="pending_product_owner_review"')
    expect(markup).toContain('product-owner approval is pending')
    expect(markup).toContain(coveragePositioning.coverageSnapshotId)
    expect(markup).toContain(`dateTime="${coveragePositioning.asOf}"`)
    expect(markup).toContain(coveragePositioning.nonAdditivity)
    expect(markup).toContain('11 direct · 2 crosswalk-required · 1 unknown')
    expect(markup).toContain('all 306 are honestly not assessed')
  })
})
