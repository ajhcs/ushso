import type { DiscoveryFacetSection, DiscoveryResultItem, ObservatoryRecord } from '../types/discovery'
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

export type CanonicalFacetSectionId = 'source' | 'geography' | 'access_status' | 'unit_of_analysis' | 'capability'

const canonicalSectionLabels: Record<CanonicalFacetSectionId, string> = {
  source: 'Source',
  geography: 'Geography',
  access_status: 'Access status',
  unit_of_analysis: 'Inferred unit tag',
  capability: 'Research concept',
}

const canonicalOrder: CanonicalFacetSectionId[] = ['source', 'geography', 'access_status', 'unit_of_analysis', 'capability']
const fallbackOnlySections = new Set(['years', 'variables-codebook', 'record-type', 'verification'])
const legacySectionAliases: Record<string, CanonicalFacetSectionId> = {
  'data-category': 'capability',
  access: 'access_status',
  'reporting-unit': 'unit_of_analysis',
}

const ACCESS_STATUS_LABELS: Record<string, string> = {
  public_direct: 'Public direct',
  public_catalog: 'Public catalog metadata; payload access unresolved',
  registration_required: 'Registration required',
  application_required: 'Application required',
  dua_required: 'Data-use agreement required',
  licensed_paid: 'Licensed / paid',
  controlled: 'Controlled access',
  temporarily_unavailable: 'Temporarily unavailable',
  unavailable: 'Unavailable',
  unknown: 'Access unresolved',
}

const GEOGRAPHY_LEVEL_LABELS: Record<string, string> = {
  national: 'National coverage',
  multi_state: 'Multi-state coverage',
  state: 'State coverage',
  county: 'County coverage',
  facility: 'Facility coverage',
  mixed: 'Mixed coverage',
  unknown: 'Include records with unresolved geography (if present)',
}

const UNIT_LABELS: Record<string, string> = {
  county_equivalent: 'County equivalent',
  facility_period: 'Facility-period',
  health_system: 'Health system',
  survey_response: 'Survey response',
  unknown: 'Observation unit unresolved',
}

const SOURCE_LABELS: Record<string, string> = {
  'cdc-socrata': 'Centers for Disease Control and Prevention Data Catalog',
  'census-api': 'U.S. Census Bureau API Catalog',
  'cms-data-catalog': 'Centers for Medicare & Medicaid Services Data Catalog',
}

const CAPABILITY_LABELS: Record<string, string> = {
  behavioral_health: 'Behavioral health and substance use',
  claims: 'Claims and encounters',
  costs_prices: 'Costs, prices, and transparency',
  facility_licensure: 'Facility licensure and certification',
  geography_access: 'Geography, rurality, and access context',
  hospital_capacity: 'Hospital capacity and operations',
  hospital_financials: 'Hospital financials',
  maternal_child_health: 'Maternal and child health',
  ownership: 'Ownership and organizational relationships',
  public_health: 'Public health surveillance',
  quality: 'Quality and outcomes',
  payer: 'Payer and coverage',
  utilization: 'Hospital and provider utilization',
  workforce: 'Healthcare workforce',
  'use-case-metadata-discovery': 'Metadata discovery and source routing',
  'use-case-access-routing': 'Access routing',
  'topic:hospital-financials': 'Hospital financials',
  'topic-hospital-financials': 'Hospital financials',
  'topic:utilization': 'Hospital and provider utilization',
  'topic-utilization': 'Hospital and provider utilization',
  'topic:claims': 'Claims and encounters',
  'topic-claims': 'Claims and encounters',
  'topic:quality': 'Quality and outcomes',
  'topic-quality': 'Quality and outcomes',
  'topic:workforce': 'Healthcare workforce',
  'topic-workforce': 'Healthcare workforce',
  'topic:public-health': 'Public health surveillance',
  'topic-public-health': 'Public health surveillance',
  'topic:payer': 'Payer and coverage',
  'topic-payer': 'Payer and coverage',
  'topic:ownership': 'Ownership and organizational relationships',
  'topic-ownership': 'Ownership and organizational relationships',
  'topic:costs-prices': 'Costs, prices, and transparency',
  'topic-costs-prices': 'Costs, prices, and transparency',
  'topic:opioid-related': 'Opioid related',
  'topic-opioid-related': 'Opioid related',
}

const US_STATE_LABELS: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}

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

type FacetInput = DatasetFamily | DiscoveryResultItem | ObservatoryRecord

function recordFromFacetInput(item: FacetInput): ObservatoryRecord {
  if ('canonicalResult' in item) return item.canonicalResult.record
  if ('record' in item) return item.record
  return item
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]
}

export function canonicalFacetValues(record: ObservatoryRecord): Record<CanonicalFacetSectionId, string[]> {
  return {
    source: unique([record.identity?.source?.source_id]),
    geography: unique([record.geography?.coverage_level, ...(record.geography?.jurisdictions ?? [])]),
    access_status: unique([record.access?.status]),
    unit_of_analysis: unique(record.unit_of_analysis ?? []),
    capability: unique([
      ...(record.capabilities?.topics ?? []).map((value) => value.id),
      ...(record.capabilities?.use_cases ?? []).map((value) => value.id),
    ]),
  }
}

export function canonicalFacetValuesForItem(item: FacetInput) {
  return canonicalFacetValues(recordFromFacetInput(item))
}

function capturedFacetLabels(sectionId: string, value: string, items: FacetInput[]) {
  const labels = new Set<string>()
  for (const item of items) {
    const record = recordFromFacetInput(item)
    const values = canonicalFacetValues(record)[sectionId as CanonicalFacetSectionId] ?? []
    if (!values.includes(value)) continue
    if (sectionId === 'source' && record.identity?.source?.name) labels.add(record.identity.source.name)
    if (sectionId === 'capability') {
      for (const capability of [...(record.capabilities?.topics ?? []), ...(record.capabilities?.use_cases ?? [])]) {
        if (capability.id === value && capability.label) labels.add(capability.label)
      }
    }
  }
  return [...labels]
}

export function facetSectionLabel(sectionId: string) {
  return canonicalSectionLabels[sectionId as CanonicalFacetSectionId] ?? preferredSections[sectionId]?.label ?? sentenceCase(sectionId)
}

function geographyOptionLabel(value: string) {
  const normalized = value.trim()
  const level = GEOGRAPHY_LEVEL_LABELS[normalized.toLowerCase()]
  if (level) return level
  if (normalized.toUpperCase() === 'US') return 'United States jurisdiction'
  if (/^US-[A-Z]{2}$/i.test(normalized)) return US_STATE_LABELS[normalized.slice(3).toUpperCase()] ?? ('United States jurisdiction ' + normalized.slice(3).toUpperCase())
  return sentenceCase(normalized)
}

function capabilityOptionLabel(value: string) {
  const direct = CAPABILITY_LABELS[value]
  if (direct) return direct
  const normalized = normalizeFacetValue(value)
  if (CAPABILITY_LABELS[normalized]) return CAPABILITY_LABELS[normalized]
  if (/^use[-:]/i.test(value)) return 'Unresolved research concept'
  return sentenceCase(value.replace(/^topic[:-]/i, ''))
}

function defaultCanonicalOptionLabel(sectionId: string, value: string) {
  if (sectionId === 'source') return SOURCE_LABELS[value] ?? sentenceCase(value.replace(/^obs:source:/, ''))
  if (sectionId === 'geography') return geographyOptionLabel(value)
  if (sectionId === 'access_status') return ACCESS_STATUS_LABELS[value] ?? sentenceCase(value)
  if (sectionId === 'unit_of_analysis') return UNIT_LABELS[value] ?? sentenceCase(value)
  if (sectionId === 'capability') return capabilityOptionLabel(value)
  return sentenceCase(value)
}

/**
 * Presents canonical facet labels from captured record evidence when it is
 * consistent. A response label equal to the ID is treated as an old/raw
 * projection and is resolved again from the current page or static vocabulary.
 */
export function facetOptionLabel(
  sectionId: string,
  value: string,
  items: FacetInput[] = [],
  capturedLabel?: string,
) {
  if (capturedLabel && capturedLabel !== value) return capturedLabel
  const captured = capturedFacetLabels(sectionId, value, items)
  if (captured.length === 1) return captured[0]
  return defaultCanonicalOptionLabel(sectionId, value)
}

export function presentFacetOptionLabel(sectionId: string, value: string, capturedLabel?: string, items: FacetInput[] = []) {
  return facetOptionLabel(sectionId, value, items, capturedLabel)
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

function selectedBySection(selected: string[]) {
  return selected.reduce<Record<string, string[]>>((result, filter) => {
    const separator = filter.indexOf(':')
    if (separator < 1 || separator === filter.length - 1) return result
    const section = legacySectionAliases[filter.slice(0, separator)] ?? filter.slice(0, separator)
    const value = filter.slice(separator + 1)
    result[section] = [...(result[section] ?? []), value]
    return result
  }, {})
}

function sectionAvailability(sectionId: string, values: Map<string, number | undefined>, total: number) {
  if (total <= 0) {
    return {
      availability: 'unavailable' as const,
      availabilityReason: 'No records are in the current response scope, so this facet cannot be assessed.',
    }
  }
  const counted = [...values.values()].filter((count): count is number => typeof count === 'number')
  if (counted.some((count) => count < total)) return { availability: 'available' as const }
  if (sectionId === 'geography' && values.get('unknown') === total) {
    return {
      availability: 'unavailable' as const,
      availabilityReason: 'All matching records have unresolved geography in this catalog scope; no geography-specific narrowing is available.',
    }
  }
  if (sectionId === 'access_status' && values.get('public_catalog') === total) {
    return {
      availability: 'unavailable' as const,
      availabilityReason: 'All matching records expose catalog metadata only in this catalog scope; payload access remains unresolved.',
    }
  }
  return {
    availability: 'unavailable' as const,
    availabilityReason: 'The available values do not narrow this catalog scope; counts describe the current matching records before pagination.',
  }
}

function canonicalSection(
  sectionId: CanonicalFacetSectionId,
  values: Map<string, number | undefined>,
  items: FacetInput[],
  total: number,
): FacetSectionConfig {
  const availability = sectionAvailability(sectionId, values, total)
  return {
    id: sectionId,
    label: facetSectionLabel(sectionId),
    availability: availability.availability,
    ...(availability.availabilityReason ? { availabilityReason: availability.availabilityReason } : {}),
    expandable: values.size > 5,
    options: [...values.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([value, count]) => ({
        value,
        label: facetOptionLabel(sectionId, value, items),
        ...(typeof count === 'number' ? { count } : {}),
      })),
  }
}

function addCanonicalUnknownControls(valuesBySection: Map<string, Map<string, number | undefined>>) {
  for (const sectionId of ['geography', 'access_status']) {
    const values = valuesBySection.get(sectionId) ?? new Map<string, number | undefined>()
    if (!values.has('unknown')) values.set('unknown', undefined)
    valuesBySection.set(sectionId, values)
  }
}

function addSelectedValues(valuesBySection: Map<string, Map<string, number | undefined>>, selected: string[]) {
  for (const [sectionId, values] of Object.entries(selectedBySection(selected))) {
    const section = valuesBySection.get(sectionId) ?? new Map<string, number | undefined>()
    for (const value of values) if (!section.has(value)) section.set(value, undefined)
    valuesBySection.set(sectionId, section)
  }
}

export function buildCanonicalFacetSections(
  items: DatasetFamily[],
  totalScope = items.length,
  selected: string[] = [],
): FacetSectionConfig[] {
  const records = items as FacetInput[]
  const valuesBySection = new Map<string, Map<string, number | undefined>>()
  for (const sectionId of canonicalOrder) valuesBySection.set(sectionId, new Map())
  for (const item of records) {
    const values = canonicalFacetValuesForItem(item)
    for (const sectionId of canonicalOrder) {
      const counts = valuesBySection.get(sectionId)!
      for (const value of values[sectionId]) counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }
  addCanonicalUnknownControls(valuesBySection)
  addSelectedValues(valuesBySection, selected)

  const canonicalSections = canonicalOrder.map((sectionId) => canonicalSection(
    sectionId,
    valuesBySection.get(sectionId)!,
    records,
    totalScope,
  ))
  const metadataSections = buildFacetSections(items)
    .filter((section) => fallbackOnlySections.has(section.id))
  return [...canonicalSections, ...metadataSections]
}

export function normalizeDiscoveryFacetSections(
  sections: DiscoveryFacetSection[],
  items: DatasetFamily[],
  totalScope: number,
  selected: string[] = [],
): FacetSectionConfig[] {
  const records = items as FacetInput[]
  const valuesBySection = new Map<string, Map<string, number | undefined>>()
  const sectionIds: string[] = []
  for (const section of sections) {
    if (sectionIds.includes(section.id)) continue
    sectionIds.push(section.id)
    const values = new Map<string, number | undefined>()
    for (const option of section.options) values.set(option.value, option.count)
    valuesBySection.set(section.id, values)
  }
  for (const sectionId of canonicalOrder) {
    if (!sectionIds.includes(sectionId)) sectionIds.push(sectionId)
    if (!valuesBySection.has(sectionId)) valuesBySection.set(sectionId, new Map())
  }
  addCanonicalUnknownControls(valuesBySection)
  addSelectedValues(valuesBySection, selected)

  return sectionIds.map((sectionId) => {
    const values = valuesBySection.get(sectionId) ?? new Map<string, number | undefined>()
    const availability = sectionAvailability(sectionId, values, totalScope)
    return {
      id: sectionId,
      label: facetSectionLabel(sectionId),
      availability: availability.availability,
      ...(availability.availabilityReason ? { availabilityReason: availability.availabilityReason } : {}),
      expandable: values.size > 5,
      options: [...values.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([value, count]) => {
          const sourceOption = sections.find((section) => section.id === sectionId)?.options.find((option) => option.value === value)
          return {
            value,
            label: facetOptionLabel(sectionId, value, records, sourceOption?.label),
            ...(typeof count === 'number' ? { count } : {}),
          }
        }),
    }
  })
}

export function facetFilterLabel(filter: string, items: DatasetFamily[] = []) {
  const separator = filter.indexOf(':')
  if (separator < 1) return filter
  const rawSection = filter.slice(0, separator)
  const sectionId = legacySectionAliases[rawSection] ?? rawSection
  return facetOptionLabel(sectionId, filter.slice(separator + 1), items as FacetInput[])
}

export function matchesFacetFilter(record: ObservatoryRecord, sectionId: string, value: string) {
  const canonicalSection = legacySectionAliases[sectionId] ?? sectionId
  const values = canonicalFacetValues(record)[canonicalSection as CanonicalFacetSectionId] ?? []
  if (values.includes(value)) return true
  if (canonicalSection === 'capability' && values.some((candidate) => normalizeFacetValue(candidate) === normalizeFacetValue(value))) return true
  if (canonicalSection === 'geography' && value === 'pennsylvania') return values.includes('US-PA')
  if (canonicalSection === 'access_status' && value === 'catalog-metadata-only') return values.includes('public_catalog')
  if (canonicalSection === 'unit_of_analysis' && values.some((candidate) => normalizeFacetValue(candidate) === normalizeFacetValue(value))) return true
  return false
}
