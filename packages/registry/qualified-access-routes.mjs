export const QUALIFIED_ACCESS_ROUTES_VERSION = 'ushso.qualified-access-routes.v1';
export const HCRIS_HOSPITAL_COST_REPORT_ID = 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17';
export const CENSUS_ABSCB_2023_ID = 'obs:asset:census-api:api.census.gov-data-id-abscb2023-ec8bee5f048e6e3f';
export const HCUP_FIXTURE_ID = 'asset.hcup.restricted.fixture';
export const VERIFIED_AT = '2026-09-03T22:22:33.908Z';

function freeze(value) {
  return Object.freeze(value);
}

function requirement({ requirement_id, kind, state, description, human_gate, evidence_ids }) {
  return freeze({ requirement_id, kind, state, description, human_gate, evidence_ids: freeze([...evidence_ids]) });
}

function parameter({ name, location, required, description, example_value }) {
  return freeze({ name, location, required, description, example_value });
}

const CMS = freeze({
  kind: 'public_cms',
  record_id: HCRIS_HOSPITAL_COST_REPORT_ID,
  release_id: 'release.cms.hcris.documentation',
  distribution_id: 'distribution.cms.hcris.landing-page',
  access_route_id: 'access.cms.hcris.public-docs',
  evidence_ids: freeze(['evidence:cms-data-catalog:bf696c5e94f4146abe7ad61b']),
  access_class: 'public',
  next_step: 'Open the CMS Hospital Provider Cost Report landing page and review current publisher terms. USHSO does not retrieve the cost-report payload.',
  human_process: 'A researcher opens the first-party CMS product page, confirms the reporting period, and follows CMS download terms outside USHSO.',
  process_steps: freeze([
    'Call get_asset on the HCRIS catalog record and retain documented locator IDs.',
    'Open https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report',
    'Stop before any bulk file acquisition; catalog membership is not payload access.',
  ]),
  turnaround_category: 'immediate_if_eligible',
  authoritative_links: freeze(['https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report']),
  human_authorization_gate: false,
  interface: 'web_interface',
  request_method: 'GET',
  request_template: 'https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report',
  authentication_type: 'none',
  credential_name: null,
  pagination: freeze({ kind: 'none', page_parameter: null, page_size_parameter: null, maximum_page_size: null }),
  response_formats: freeze(['text.html']),
  compression: 'none',
  size_category: 'small',
  update_behavior: 'Rolling CMS catalog landing page; not an exact annual release.',
  parser_hints: freeze(['HTML documentation page', 'Not a bounded cost-report row sample']),
  cost: 'unknown',
  quota: 'unknown',
});

const CENSUS = freeze({
  kind: 'keyed_census',
  record_id: CENSUS_ABSCB_2023_ID,
  release_id: 'release.census.abscb.2023',
  distribution_id: 'distribution.census.variables.json',
  access_route_id: 'access.census.keyed-metadata',
  evidence_ids: freeze(['evidence:census-api:7fc87283de48cd3575920c57']),
  access_class: 'registration',
  next_step: 'Request Census variables metadata with a named Census API key held by the caller. USHSO does not supply, store, or embed the key.',
  human_process: 'A researcher registers for a Census API key at the publisher and substitutes that named credential locally. Observation queries remain out of scope.',
  process_steps: freeze([
    'Call get_asset on the Census catalog record and retain documented locator IDs.',
    'Obtain a Census API key from the publisher; name it only as Census API key.',
    'Call the variables.json metadata template. Do not run observation queries through USHSO.',
  ]),
  turnaround_category: 'immediate_if_eligible',
  authoritative_links: freeze(['https://api.census.gov/data/id/ABSCB2023', 'https://api.census.gov/data.json']),
  human_authorization_gate: false,
  interface: 'api',
  request_method: 'GET',
  request_template: 'https://api.census.gov/data/2023/abscb/variables.json',
  authentication_type: 'api_key',
  credential_name: 'Census API key',
  pagination: freeze({ kind: 'none', page_parameter: null, page_size_parameter: null, maximum_page_size: null }),
  response_formats: freeze(['application.json']),
  compression: 'none',
  size_category: 'small',
  update_behavior: 'Annual survey vintage is pinned in the path; the catalog record remains rolling.',
  parser_hints: freeze(['JSON variables dictionary', 'Not an observation table']),
  cost: 'unknown',
  quota: 'unknown',
});

const HCUP = freeze({
  kind: 'restricted_hcup',
  record_id: HCUP_FIXTURE_ID,
  release_id: 'release.hcup.nis.application',
  distribution_id: 'distribution.hcup.central-distributor',
  access_route_id: 'access.hcup.restricted-manual',
  evidence_ids: freeze(['evidence.hcup.documentation']),
  access_class: 'application',
  next_step: 'Follow AHRQ HCUP Central Distributor documentation. This is a restricted research-file route, not a public download.',
  human_process: 'A researcher identifies the exact restricted HCUP database on the publisher site and follows the documented application/DUA process outside USHSO. USHSO does not collect eligibility or credentials.',
  process_steps: freeze([
    'Call get_asset if a catalog record exists; otherwise open publisher documentation directly.',
    'Open https://hcup-us.ahrq.gov/databases.jsp and identify the exact database product.',
    'Do not treat public MEPS files as this restricted HCUP route.',
  ]),
  turnaround_category: 'source_determined',
  authoritative_links: freeze(['https://hcup-us.ahrq.gov/databases.jsp']),
  human_authorization_gate: true,
  interface: 'application',
  request_method: 'SOURCE_DEFINED',
  request_template: 'https://hcup-us.ahrq.gov/databases.jsp',
  authentication_type: 'application_approval',
  credential_name: 'HCUP Central Distributor application',
  pagination: freeze({ kind: 'source_defined', page_parameter: null, page_size_parameter: null, maximum_page_size: null }),
  response_formats: freeze(['application.pdf']),
  compression: 'none',
  size_category: 'source_determined',
  update_behavior: 'Restricted research files are not indexed as public samples.',
  parser_hints: freeze(['Human application workflow', 'No machine payload recipe']),
  cost: 'unknown',
  quota: 'unknown',
});

export const QUALIFIED_ROUTES = freeze([CMS, CENSUS, HCUP]);

export function matchQualifiedRoute(input = {}) {
  return QUALIFIED_ROUTES.find((route) => (
    route.record_id === input.record_id
    && route.release_id === input.release_id
    && route.distribution_id === input.distribution_id
    && route.access_route_id === input.access_route_id
  )) ?? null;
}

function sharedRequirements(route) {
  const evidence = route.evidence_ids;
  const rows = [
    requirement({
      requirement_id: `req.${route.kind}.publisher-terms`,
      kind: 'authorization',
      state: 'external',
      description: 'Source-side authorization and publisher terms remain outside USHSO metadata inspection.',
      human_gate: route.human_authorization_gate,
      evidence_ids: evidence,
    }),
    requirement({
      requirement_id: `req.${route.kind}.cost`,
      kind: 'fee',
      state: 'unknown',
      description: 'Documented credential/cost requirements are unknown unless a publisher receipt names them. Unknown cost is not guessed.',
      human_gate: false,
      evidence_ids: evidence,
    }),
    requirement({
      requirement_id: `req.${route.kind}.quota`,
      kind: 'other',
      state: 'unknown',
      description: 'Documented quota is unknown unless a publisher receipt names it. Unknown quota is not guessed.',
      human_gate: false,
      evidence_ids: evidence,
    }),
  ];
  if (route.credential_name) {
    rows.push(requirement({
      requirement_id: `req.${route.kind}.credential-name`,
      kind: 'identity_verification',
      state: 'external',
      description: `Required credential is named only as ${route.credential_name}. USHSO does not embed, collect, or proxy the secret.`,
      human_gate: route.human_authorization_gate,
      evidence_ids: evidence,
    }));
  }
  return freeze(rows);
}

export function buildAccessPlan(route) {
  return freeze({
    asset_id: route.record_id,
    release_id: route.release_id,
    distribution_id: route.distribution_id,
    access_route_id: route.access_route_id,
    access_class: route.access_class,
    requester_eligibility: 'not_assessed',
    eligibility_criteria: freeze([route.next_step]),
    requirements: sharedRequirements(route),
    human_process: route.human_process,
    process_steps: route.process_steps,
    turnaround_category: route.turnaround_category,
    authoritative_links: route.authoritative_links,
    verified_at: VERIFIED_AT,
    human_authorization_gate: route.human_authorization_gate,
    execution_authorized_by_ushso: false,
    access_workflow_submitted: false,
    evidence_ids: route.evidence_ids,
  });
}

function sampleRequests(route) {
  if (route.kind === 'keyed_census') {
    const curl = "curl --get 'https://api.census.gov/data/2023/abscb/variables.json' --data-urlencode 'key=[REDACTED]'";
    const python = [
      'import urllib.parse, urllib.request',
      "params = {'key': '[REDACTED]'}",
      "url = 'https://api.census.gov/data/2023/abscb/variables.json?' + urllib.parse.urlencode(params)",
      'print(url)',
    ].join('\n');
    return freeze([curl, python]);
  }
  if (route.kind === 'public_cms') {
    return freeze([
      "curl --get 'https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report'",
      "python3 -c \"import urllib.request; print(urllib.request.Request('https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report').full_url)\"",
    ]);
  }
  return freeze([
    "Open https://hcup-us.ahrq.gov/databases.jsp in a browser. No machine payload request is generated.",
  ]);
}

export function buildRetrievalRecipe(route) {
  const parameters = route.kind === 'keyed_census'
    ? freeze([parameter({
      name: 'key',
      location: 'query',
      required: true,
      description: 'Named Census API key held by the caller. Example value is a placeholder, not a secret.',
      example_value: '[REDACTED]',
    })])
    : freeze([]);
  return freeze({
    asset_id: route.record_id,
    release_id: route.release_id,
    distribution_id: route.distribution_id,
    access_route_id: route.access_route_id,
    interface: route.interface,
    request_method: route.request_method,
    request_template: route.request_template,
    parameters,
    authentication_type: route.authentication_type,
    pagination: route.pagination,
    response_formats: route.response_formats,
    compression: route.compression,
    size_category: route.size_category,
    update_behavior: route.update_behavior,
    parser_hints: route.parser_hints,
    sample_requests: sampleRequests(route),
    expected_artifacts: freeze([
      'publisher documentation or metadata dictionary',
      'typed access outcome',
      'no source payload',
    ]),
    checks: freeze([
      'Recipe inspection does not execute retrieval.',
      'HTTP 200 is not a tested-example badge.',
      `Cost remains ${route.cost}; quota remains ${route.quota}.`,
    ]),
    stop_conditions: freeze([
      'Stop at authentication, application, agreement, payment, restricted-data, or unexpected payload boundaries.',
      'Do not acquire dataset rows through USHSO.',
    ]),
    retrieval_executed: false,
    payloads_acquired: false,
    evidence_ids: route.evidence_ids,
  });
}

export function routeNotDocumentedGuidance() {
  return 'Call get_asset for documented collection IDs, or inspect the publisher documentation. Do not retry the same undocumented identifiers.';
}
