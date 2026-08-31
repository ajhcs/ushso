import { deepFreeze } from './canonical.mjs';
import { classifyIpAddress } from './network-policy.mjs';

export const REGULATOR_SOURCE_CLASSES = deepFreeze([
  'hospital_licensing_inspection', 'health_department', 'cost_report_rate_setting',
  'discharge_data_regulator', 'apcd_agency_council', 'hospital_oversight_other',
]);

const COVERAGE_STATES = new Set(['integrated', 'candidate', 'navigation_only', 'evidence_gap', 'inaccessible', 'unknown', 'not_assessed']);
const DISPOSITIONS = new Set(['connector_candidate', 'manual_review', 'navigation_only', 'evidence_gap', 'inaccessible', 'unknown', 'not_assessed']);
const ASSESSMENT_OUTCOMES = new Set(['source_identified', 'no_source_identified', 'not_assessed', 'transport_failure', 'source_absent', 'inaccessible']);
const WORKFLOW_KINDS = new Set(['public_navigation', 'application', 'login', 'agreement', 'identity_check', 'payment', 'licensed_transfer', 'contact_authority']);
const PROHIBITED_AUTOMATION = deepFreeze(['application', 'login', 'agreement', 'identity_check', 'payment', 'licensed_transfer', 'credential_submission', 'form_submission']);
const ENTRY_KEYS = new Set(['registry_id', 'jurisdiction', 'source_class', 'responsible_organization', 'disposition', 'coverage_cell_state', 'assessment_outcome', 'descriptor_id', 'workflow']);
const WORKFLOW_KEYS = new Set(['workflow_kind', 'public_locator', 'steps', 'prohibited_automation']);
const STEP_KEYS = new Set(['sequence', 'action', 'requires_human', 'execution_authorized', 'stop_conditions']);

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const keys = Object.keys(value);
  const unexpected = keys.filter((key) => !allowed.has(key));
  const missing = [...allowed].filter((key) => !Object.hasOwn(value, key));
  if (unexpected.length || missing.length) throw new TypeError(`${label} has an invalid property set.`);
}

function publicLocator(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\\]/.test(value)) throw new TypeError('Registry workflow locator is invalid.');
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const address = classifyIpAddress(host);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !host.includes('.') || address.family !== null || /(?:^|\.)(?:local|localhost|internal|home|lan|intranet)$/.test(host) || url.search) {
    throw new TypeError('Registry workflow locator must be a public, credential-free HTTPS documentation locator.');
  }
  return url.toString();
}

function validateWorkflow(workflow) {
  if (workflow === null) return;
  exactKeys(workflow, WORKFLOW_KEYS, 'Registry workflow');
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow) || !WORKFLOW_KINDS.has(workflow.workflow_kind)) throw new TypeError('Registry workflow is invalid.');
  publicLocator(workflow.public_locator);
  if (!Array.isArray(workflow.steps) || workflow.steps.length < 1 || workflow.steps.length > 20) throw new TypeError('Registry workflow steps are invalid.');
  if (!Array.isArray(workflow.prohibited_automation) || PROHIBITED_AUTOMATION.some((value) => !workflow.prohibited_automation.includes(value))) throw new TypeError('Registry workflow omits a prohibited automation class.');
  workflow.steps.forEach((step, index) => {
    exactKeys(step, STEP_KEYS, 'Registry workflow step');
    if (step.sequence !== index + 1 || typeof step.action !== 'string' || step.action.length > 500 || step.requires_human !== true || step.execution_authorized !== false || !Array.isArray(step.stop_conditions)) {
      throw new TypeError('Registry workflow steps must remain ordered, human-only, and non-executable.');
    }
  });
}

function workflow(kind, locator, actions) {
  return {
    workflow_kind: kind,
    public_locator: locator,
    steps: actions.map((action, index) => ({
      sequence: index + 1,
      action,
      requires_human: true,
      execution_authorized: false,
      stop_conditions: ['login', 'application', 'agreement', 'identity_check', 'payment', 'licensed_transfer', 'credential_request', 'unexpected_form'],
    })),
    prohibited_automation: [...PROHIBITED_AUTOMATION],
  };
}

export const REGULATOR_APCD_REGISTRY = deepFreeze([
  {
    registry_id: 'registry_us_pa_hospital_licensing', jurisdiction: 'US-PA', source_class: 'hospital_licensing_inspection',
    responsible_organization: 'Pennsylvania Department of Health', disposition: 'navigation_only', coverage_cell_state: 'navigation_only',
    assessment_outcome: 'source_identified', descriptor_id: null,
    workflow: workflow('public_navigation', 'https://www.pa.gov/agencies/health/facilities/hospitals.html', ['Review the public authority documentation and record an evidence receipt.', 'Stop before any form, login, or application boundary.']),
  },
  {
    registry_id: 'registry_us_pa_discharge_regulator', jurisdiction: 'US-PA', source_class: 'discharge_data_regulator',
    responsible_organization: 'Pennsylvania Health Care Cost Containment Council', disposition: 'navigation_only', coverage_cell_state: 'navigation_only',
    assessment_outcome: 'source_identified', descriptor_id: null,
    workflow: workflow('application', 'https://www.phc4.org/services/datarequests/', ['Review public eligibility and application documentation.', 'A researcher completes any application, agreement, identity, or payment step outside USHSO.']),
  },
  {
    registry_id: 'registry_us_ma_apcd', jurisdiction: 'US-MA', source_class: 'apcd_agency_council',
    responsible_organization: 'Massachusetts Center for Health Information and Analysis', disposition: 'navigation_only', coverage_cell_state: 'navigation_only',
    assessment_outcome: 'source_identified', descriptor_id: null,
    workflow: workflow('agreement', 'https://www.chiamass.gov/chia-data/', ['Review public APCD access documentation.', 'A researcher completes agreements, identity checks, and licensed transfers outside USHSO.']),
  },
  {
    registry_id: 'registry_us_co_apcd_candidate', jurisdiction: 'US-CO', source_class: 'apcd_agency_council',
    responsible_organization: 'Center for Improving Value in Health Care', disposition: 'manual_review', coverage_cell_state: 'candidate',
    assessment_outcome: 'source_identified', descriptor_id: null,
    workflow: workflow('contact_authority', 'https://civhc.org/get-data/', ['Review public inventory and access documentation.', 'Request a human evidence review before any source is classified or integrated.']),
  },
  {
    registry_id: 'registry_us_xx_evidence_gap_fixture', jurisdiction: 'US-XX', source_class: 'cost_report_rate_setting',
    responsible_organization: 'Bounded assessment fixture', disposition: 'evidence_gap', coverage_cell_state: 'evidence_gap',
    assessment_outcome: 'no_source_identified', descriptor_id: null, workflow: null,
  },
  {
    registry_id: 'registry_us_xy_not_assessed_fixture', jurisdiction: 'US-XY', source_class: 'hospital_oversight_other',
    responsible_organization: 'Not-assessed fixture', disposition: 'not_assessed', coverage_cell_state: 'not_assessed',
    assessment_outcome: 'not_assessed', descriptor_id: null, workflow: null,
  },
  {
    registry_id: 'registry_us_xz_transport_failure_fixture', jurisdiction: 'US-XZ', source_class: 'health_department',
    responsible_organization: 'Transport-failure fixture', disposition: 'unknown', coverage_cell_state: 'unknown',
    assessment_outcome: 'transport_failure', descriptor_id: null, workflow: null,
  },
  {
    registry_id: 'registry_us_xw_source_absent_fixture', jurisdiction: 'US-XW', source_class: 'hospital_oversight_other',
    responsible_organization: 'Source-absence fixture', disposition: 'unknown', coverage_cell_state: 'unknown',
    assessment_outcome: 'source_absent', descriptor_id: null, workflow: null,
  },
]);

export function validateRegulatorApcdRegistry(entries = REGULATOR_APCD_REGISTRY) {
  if (!Array.isArray(entries)) throw new TypeError('Registry entries must be an array.');
  const ids = new Set();
  for (const entry of entries) {
    exactKeys(entry, ENTRY_KEYS, 'Registry entry');
    if (!/^registry_[a-z0-9_]{3,120}$/.test(entry.registry_id) || ids.has(entry.registry_id)) throw new TypeError('Registry identifiers must be unique bounded opaque IDs.');
    ids.add(entry.registry_id);
    if (!/^US-[A-Z]{2}$/.test(entry.jurisdiction) || !REGULATOR_SOURCE_CLASSES.includes(entry.source_class)) throw new TypeError('Registry jurisdiction or source class is invalid.');
    if (!DISPOSITIONS.has(entry.disposition) || !COVERAGE_STATES.has(entry.coverage_cell_state) || !ASSESSMENT_OUTCOMES.has(entry.assessment_outcome)) throw new TypeError('Registry assessment state is invalid.');
    if ((entry.disposition === 'navigation_only') !== (entry.coverage_cell_state === 'navigation_only')) throw new TypeError('Navigation-only disposition must remain navigation_only in coverage accounting.');
    if (entry.assessment_outcome === 'no_source_identified' && entry.coverage_cell_state !== 'evidence_gap') throw new TypeError('No-source evidence must remain distinct from absence and not-assessed states.');
    if (entry.assessment_outcome === 'not_assessed' && entry.coverage_cell_state !== 'not_assessed') throw new TypeError('Not-assessed evidence must remain not_assessed.');
    if (['transport_failure', 'source_absent'].includes(entry.assessment_outcome) && entry.coverage_cell_state !== 'unknown') throw new TypeError('Transport failure and source absence must remain unknown rather than becoming absence evidence.');
    if (entry.descriptor_id !== null && !/^descriptor_[A-Za-z0-9._:-]{2,126}$/.test(entry.descriptor_id)) throw new TypeError('Registry descriptor reference is invalid.');
    validateWorkflow(entry.workflow);
  }
  return { entries: ids.size, source_classes: new Set(entries.map((entry) => entry.source_class)).size };
}

export class RegulatorApcdRegistryDispatcher {
  constructor(entries = REGULATOR_APCD_REGISTRY) {
    validateRegulatorApcdRegistry(entries);
    this.entries = structuredClone(entries);
  }

  enumerate({ jurisdiction = null, sourceClass = null } = {}) {
    return this.entries.filter((entry) => (!jurisdiction || entry.jurisdiction === jurisdiction) && (!sourceClass || entry.source_class === sourceClass)).map((entry) => structuredClone(entry));
  }

  dispatch(registryId) {
    const entry = this.entries.find((candidate) => candidate.registry_id === registryId);
    if (!entry) return { outcome: 'not_found_in_versioned_registry', registry_id: registryId, execution_authorized: false };
    if (!entry.workflow) return { outcome: 'assessment_state', entry: structuredClone(entry), execution_authorized: false };
    return { outcome: 'human_workflow', entry: structuredClone(entry), execution_authorized: false, transport_calls: 0, form_submissions: 0 };
  }
}
