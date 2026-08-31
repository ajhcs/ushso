import { BoundedHttpClient } from '../bounded-http-client.mjs';
import { asBytes } from '../canonical.mjs';
import { R2CaptureProtocol } from '../capture-protocol.mjs';
import { MemoryOriginGovernor } from '../origin-governor.mjs';
import { DeterministicConnectorRunner } from '../runner.mjs';
import {
  FixtureDnsResolver, FixtureTransport, MemoryCaptureReferenceStore,
  MemoryObjectStore, MemoryRequestLedger, MemoryRunRepository,
} from './memory-ports.mjs';

const forbidden = [
  'source_data_payload', 'query_execution', 'data_download', 'archive_member',
  'form_submission', 'login', 'payment', 'authorization_workflow',
];

function route(templateId, purpose, method, pathTemplate, allowedParameters, expectedContentClasses) {
  return {
    template_id: templateId, purpose, method, path_template: pathTemplate,
    allowed_parameters: allowedParameters, expected_content_classes: expectedContentClasses,
    forbidden_route_classes: [...forbidden],
  };
}

export function makeFixtureDescriptor({
  connectorName = 'dcat-data-json',
  sourceId = 'source_fixture_catalog',
  sourceState = 'active',
  redirectPolicy = 'same_origin',
  maximumPages = 10,
  maximumResponseBytes = 100_000,
  maximumDecompressedBytes = 200_000,
  maximumRedirects = 2,
  credentialSecretLocator = null,
} = {}) {
  return {
    contract_version: 'ingestion.v1.1.0', descriptor_id: `descriptor_${sourceId.slice(7)}_v1`, source_id: sourceId,
    connector_name: connectorName, connector_version: '1.0.0', configuration_revision: 1,
    authority_type: 'federal_agency', responsible_organization: { organization_id: 'organization_fixture', name: 'Fixture Public Agency' },
    allowed_hosts: ['catalog.example.gov'], redirect_policy: redirectPolicy,
    endpoints: [
      { endpoint_id: 'endpoint_fixture_catalog', base_url: 'https://catalog.example.gov', target_class: 'collection', routes: [
        route('route_fixture_catalog', 'catalog_metadata', 'GET', '/data.json', ['cursor', 'start', 'rows', 'limit', 'offset'], ['catalog_collection', 'catalog_item_record']),
      ] },
      { endpoint_id: 'endpoint_fixture_item', base_url: 'https://catalog.example.gov', target_class: 'exact_item', routes: [
        route('route_fixture_item', 'catalog_metadata', 'GET', '/items/{id}', ['id'], ['catalog_item_record']),
      ] },
      { endpoint_id: 'endpoint_fixture_schema', base_url: 'https://catalog.example.gov', target_class: 'exact_item', routes: [
        route('route_fixture_schema', 'schema', 'GET', '/schemas/{id}', ['id'], ['schema_description', 'data_dictionary']),
      ] },
      { endpoint_id: 'endpoint_fixture_docs', base_url: 'https://catalog.example.gov', target_class: 'documentation', routes: [
        route('route_fixture_docs', 'documentation', 'GET', '/docs/{slug}', ['slug'], ['documentation_page']),
      ] },
      { endpoint_id: 'endpoint_fixture_html_inventory', base_url: 'https://catalog.example.gov', target_class: 'collection', routes: [
        route('route_fixture_html_inventory', 'documentation', 'GET', '/inventory', [], ['documentation_page']),
      ] },
      { endpoint_id: 'endpoint_fixture_access', base_url: 'https://catalog.example.gov', target_class: 'exact_distribution', routes: [
        route('route_fixture_access', 'access_probe', 'HEAD', '/files/{id}', ['id'], ['access_status_headers']),
      ] },
    ],
    scopes: [{
      scope_id: 'scope_fixture_catalog', unit: 'source_scope',
      description: 'Every source-native item in the complete fixture catalog enumeration.',
      endpoint_ids: ['endpoint_fixture_catalog', 'endpoint_fixture_item', 'endpoint_fixture_schema', 'endpoint_fixture_docs', 'endpoint_fixture_html_inventory', 'endpoint_fixture_access'],
      denominator: { unit: 'enumerated_item', inclusion_rule: 'Count each unique item in a complete sealed fixture traversal.', unknown_handling: 'preserve_unknown', exclusions_visible: true },
      completeness_evidence_strategy: 'configured_enumeration', keyword_search_is_denominator: false,
    }],
    native_identifier: { namespace: 'fixture.catalog', case_behavior: 'sensitive' },
    checkpoint_policy: { strategy: 'modified_at_native_id', opaque_cursor_durability: 'run_local', overlap_seconds: 3600, full_enumeration_interval_seconds: 86400 },
    refresh_policy: { interval_seconds: 3600, jitter_seconds: 60, stale_after_seconds: 7200, policy_version: 'refresh.fixture.v1' },
    bounds: { maximum_pages: maximumPages, maximum_response_bytes: maximumResponseBytes, maximum_decompressed_bytes: maximumDecompressedBytes, maximum_run_seconds: 300, maximum_redirects: maximumRedirects },
    origin_policy: { maximum_concurrency: 2, requests_per_second: 100, burst: 100, minimum_retry_delay_seconds: 1, maximum_retry_delay_seconds: 60, circuit_policy_version: 'origin.fixture.v1' },
    credential_secret_locator: credentialSecretLocator,
    supported_object_roles: ['asset', 'release', 'distribution', 'documentation', 'schema', 'access_route'],
    capabilities: { schema_metadata: true, documentation: true, access_probe: true },
    exclusion_policy: { policy_version: 'exclusion.fixture.v1', rules: [], exclusions_visible_upstream: true },
    legal_review: { state: 'approved', reviewed_at: '2026-08-30T00:00:00.000Z', reviewer_role: 'fixture-reviewer', terms_locator: 'https://catalog.example.gov/terms' },
    capture_retention_policy: { policy_version: 'capture-retention.fixture.v1', active_days: 90, override_rationale: null, review_at: null },
    source_state: sourceState,
  };
}

export function jsonResponse(value, options = {}) {
  const text = JSON.stringify(value);
  return {
    status: options.status ?? 200,
    bodyBytes: options.bodyBytes ?? text,
    wireBytes: options.wireBytes,
    connectedAddress: options.connectedAddress,
    headers: {
      'content-type': options.contentType ?? 'application/json',
      'content-length': String(options.contentLength ?? asBytes(options.bodyBytes ?? text).byteLength),
      ...(options.etag ? { etag: options.etag } : {}),
      ...(options.lastModified ? { 'last-modified': options.lastModified } : {}),
      ...(options.location ? { location: options.location } : {}),
      ...(options.headers ?? {}),
    },
  };
}

export function makeHarness({
  descriptor = makeFixtureDescriptor(),
  transport = new FixtureTransport(),
  resolver = new FixtureDnsResolver(),
  runRepository = new MemoryRunRepository(),
  clock = () => new Date('2026-08-30T00:00:00.000Z'),
  captureCrashInjector = null,
  runnerCrashInjector = null,
  credentialProvider = null,
  governor = new MemoryOriginGovernor({ clock: () => clock().getTime() }),
} = {}) {
  const objectStore = new MemoryObjectStore();
  const referenceStore = new MemoryCaptureReferenceStore();
  const requestLedger = new MemoryRequestLedger();
  const captureProtocol = new R2CaptureProtocol({ objectStore, referenceStore, clock, crashInjector: captureCrashInjector });
  const client = new BoundedHttpClient({
    transport, resolver, captureProtocol, requestLedger, clock,
    governor, credentialProvider,
  });
  const runner = new DeterministicConnectorRunner({ httpClient: client, runRepository, clock, crashInjector: runnerCrashInjector });
  return { descriptor, transport, resolver, runRepository, objectStore, referenceStore, requestLedger, captureProtocol, client, runner, clock, governor };
}
