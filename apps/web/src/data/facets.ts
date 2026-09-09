import type { DatasetFamily, FacetSectionConfig } from '../types/catalog'

export const DEFAULT_FILTER = 'geography:pennsylvania'

const preferredSections: Record<string, { label: string; collapsed?: boolean }> = {
  'data-category': { label: 'Data category' },
  geography: { label: 'Geography' },
  access: { label: 'Access and requirements' },
  'reporting-unit': { label: 'Reporting unit' },
  years: { label: 'Years', collapsed: true },
  'variables-codebook': { label: 'Variables/codebook', collapsed: true },
  'record-type': { label: 'Record type', collapsed: true },
  source: { label: 'Source', collapsed: true },
  verification: { label: 'Verification status', collapsed: true },
}

const preferredOrder = Object.keys(preferredSections)

export function normalizeFacetValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^topic[:-]/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function sentenceCase(value: string) {
  const words = value.replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value
}

function optionLabel(sectionId: string, value: string, items: DatasetFamily[]) {
  if (sectionId === 'data-category') {
    for (const item of items) {
      const topic = item.canonicalResult.record.capabilities.topics.find(
        (candidate) => normalizeFacetValue(candidate.id || candidate.label) === value,
      )
      if (topic) return topic.label
    }
  }

  if (sectionId === 'source') {
    const source = items.find((item) => normalizeFacetValue(item.canonicalResult.record.identity.source.source_id) === value)
    if (source) return source.canonicalResult.record.identity.source.name
  }

  const labels: Record<string, string> = {
    pennsylvania: 'Pennsylvania',
    'other-states': 'Other states',
    'public-report': 'Public report',
    'catalog-metadata-only': 'Catalog metadata only',
    'open-data-api': 'Open data/API',
    'application-required': 'Application required',
    'fee-license': 'Fee or license',
    'data-use-agreement': 'Data use agreement',
    'access-unresolved': 'Access unresolved',
    'health-system': 'Health system',
    'facility-period': 'Facility-period',
    'current-verified': 'Current — metadata observed live',
    'not-live-verified': 'Not live verified',
  }
  return labels[value] ?? sentenceCase(value)
}

function sectionLabel(sectionId: string) {
  return preferredSections[sectionId]?.label ?? sentenceCase(sectionId)
}

/**
 * Builds the complete filter model from the returned records. Backend-added
 * topic IDs, labels, and facet keys therefore appear without a frontend list
 * update. Empty placeholder sections are intentionally omitted.
 */
export function buildFacetSections(items: DatasetFamily[]): FacetSectionConfig[] {
  const valuesBySection = new Map<string, string[]>()

  for (const item of items) {
    for (const [sectionId, values] of Object.entries(item.facetValues)) {
      const sectionValues = valuesBySection.get(sectionId) ?? []
      for (const value of values) {
        if (value && !sectionValues.includes(value)) sectionValues.push(value)
      }
      if (sectionValues.length > 0) valuesBySection.set(sectionId, sectionValues)
    }
  }

  return [...valuesBySection.entries()]
    .sort(([left], [right]) => {
      const leftIndex = preferredOrder.indexOf(left)
      const rightIndex = preferredOrder.indexOf(right)
      if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right)
      if (leftIndex === -1) return 1
      if (rightIndex === -1) return -1
      return leftIndex - rightIndex
    })
    .map(([sectionId, values]) => ({
      id: sectionId,
      label: sectionLabel(sectionId),
      collapsed: preferredSections[sectionId]?.collapsed,
      expandable: values.length > 5,
      options: values.map((value) => ({
        value,
        label: optionLabel(sectionId, value, items),
        count: items.filter((item) => item.facetValues[sectionId]?.includes(value)).length,
      })),
    }))
}
