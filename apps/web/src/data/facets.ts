import type { DatasetFamily, FacetSectionConfig } from '../types/catalog'

export const DEFAULT_FILTER = 'geography:pennsylvania'

const facetDefinitions: FacetSectionConfig[] = [
  {
    id: 'data-category',
    label: 'Data category',
    expandable: true,
    options: [
      { value: 'financial', label: 'Financial', count: 0 },
      { value: 'utilization', label: 'Utilization', count: 0 },
      { value: 'quality', label: 'Quality', count: 0 },
      { value: 'hospital-characteristics', label: 'Hospital characteristics', count: 0 },
      { value: 'costs-charges', label: 'Costs & charges', count: 0 },
      { value: 'ownership', label: 'Ownership', count: 0 },
      { value: 'workforce', label: 'Workforce', count: 0 },
    ],
  },
  {
    id: 'geography',
    label: 'Geography',
    options: [
      { value: 'national', label: 'National', count: 0 },
      { value: 'pennsylvania', label: 'Pennsylvania', count: 0 },
      { value: 'other-states', label: 'Other states', count: 0 },
    ],
  },
  {
    id: 'access',
    label: 'Access and requirements',
    options: [
      { value: 'public-report', label: 'Public report', count: 0 },
      { value: 'open-data-api', label: 'Open data/API', count: 0 },
      { value: 'application-required', label: 'Application required', count: 0 },
      { value: 'fee-license', label: 'Fee or license', count: 0 },
      { value: 'data-use-agreement', label: 'Data use agreement', count: 0 },
      { value: 'unavailable', label: 'Unavailable', count: 0, disabled: true },
      { value: 'access-unresolved', label: 'Access unresolved', count: 0, disabled: true },
    ],
  },
  {
    id: 'reporting-unit',
    label: 'Reporting unit',
    options: [
      { value: 'hospital', label: 'Hospital', count: 0 },
      { value: 'health-system', label: 'Health system', count: 0 },
      { value: 'provider', label: 'Provider', count: 0 },
      { value: 'facility-period', label: 'Facility-period', count: 0 },
    ],
  },
  { id: 'years', label: 'Years', collapsed: true, options: [] },
  { id: 'variables-codebook', label: 'Variables/codebook', collapsed: true, options: [] },
  { id: 'record-type', label: 'Record type', collapsed: true, options: [] },
]

export function buildFacetSections(items: DatasetFamily[]) {
  return facetDefinitions.map((section) => ({
    ...section,
    options: section.options.map((option) => {
      const count = items.filter((item) => item.facetValues[section.id]?.includes(option.value)).length
      return { ...option, count, disabled: count === 0 }
    }),
  }))
}
