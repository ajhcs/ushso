import { deepFreeze } from './canonical.mjs';

const forbidden = Object.freeze([
  'source_data_payload', 'query_execution', 'data_download', 'archive_member',
  'form_submission', 'login', 'payment', 'authorization_workflow',
]);

function route(templateId, purpose, method, pathTemplate, allowedParameters, expectedContentClasses) {
  return {
    template_id: templateId,
    purpose,
    method,
    path_template: pathTemplate,
    allowed_parameters: allowedParameters,
    expected_content_classes: expectedContentClasses,
    forbidden_route_classes: [...forbidden],
  };
}

function descriptor({
  slug, sourceId, connectorName, organizationId, organizationName, authorityType = 'federal_agency',
  hosts, endpoints, namespace, strategy = 'full_snapshot', schemaMetadata = false,
  documentation = false, accessProbe = false, credentialSecretLocator = null,
}) {
  return {
    contract_version: 'ingestion.v1.1.0',
    descriptor_id: `descriptor_${slug}_fixture_v1`,
    source_id: sourceId,
    connector_name: connectorName,
    connector_version: '1.0.0',
    configuration_revision: 1,
    authority_type: authorityType,
    responsible_organization: { organization_id: organizationId, name: organizationName },
    allowed_hosts: hosts,
    redirect_policy: 'same_origin',
    endpoints,
    scopes: [{
      scope_id: `scope_${slug}_catalog`,
      unit: 'source_scope',
      description: `Every unique source-native metadata item returned by a complete configured ${organizationName} catalog enumeration.`,
      endpoint_ids: endpoints.map((endpoint) => endpoint.endpoint_id),
      denominator: {
        unit: 'enumerated_item',
        inclusion_rule: 'Count each unique source-native item from a complete sealed traversal of only the declared metadata routes.',
        unknown_handling: 'preserve_unknown',
        exclusions_visible: true,
      },
      completeness_evidence_strategy: 'configured_enumeration',
      keyword_search_is_denominator: false,
    }],
    native_identifier: { namespace, case_behavior: 'source_defined' },
    checkpoint_policy: {
      strategy,
      opaque_cursor_durability: 'run_local',
      overlap_seconds: strategy === 'modified_at_native_id' ? 3600 : 0,
      full_enumeration_interval_seconds: 604800,
    },
    refresh_policy: { interval_seconds: 86400, jitter_seconds: 1800, stale_after_seconds: 172800, policy_version: 'refresh.fixture.v1' },
    bounds: { maximum_pages: 1000, maximum_response_bytes: 5_242_880, maximum_decompressed_bytes: 10_485_760, maximum_run_seconds: 7200, maximum_redirects: 1 },
    origin_policy: { maximum_concurrency: 2, requests_per_second: 1, burst: 2, minimum_retry_delay_seconds: 5, maximum_retry_delay_seconds: 900, circuit_policy_version: 'origin.fixture.v1' },
    credential_secret_locator: credentialSecretLocator,
    supported_object_roles: ['asset', 'release', 'distribution', 'documentation', 'schema', 'access_route'],
    capabilities: { schema_metadata: schemaMetadata, documentation, access_probe: accessProbe },
    exclusion_policy: { policy_version: 'exclusion.fixture.v1', rules: [], exclusions_visible_upstream: true },
    legal_review: { state: 'pending', reviewed_at: null, reviewer_role: null, terms_locator: null },
    capture_retention_policy: { policy_version: 'capture-retention.fixture.v1', active_days: 90, override_rationale: null, review_at: null },
    source_state: 'paused',
  };
}

export const DATA_GOV_V4_DESCRIPTOR = descriptor({
  slug: 'data_gov_v4', sourceId: 'source_data_gov_v4', connectorName: 'data-gov-v4-catalog',
  organizationId: 'organization_gsa', organizationName: 'U.S. General Services Administration',
  // Catalog API v4 `after` tokens are traversal-local. A globally committed
  // opaque checkpoint would overstate their durability, so successful runs
  // advance only by sealing a complete snapshot.
  hosts: ['api.gsa.gov'], namespace: 'gov.data.catalog.v4', strategy: 'full_snapshot',
  credentialSecretLocator: 'cloudflare-secret://ushso/staging/data-gov-v4-api-key',
  endpoints: [{
    endpoint_id: 'endpoint_data_gov_v4_search', base_url: 'https://api.gsa.gov', target_class: 'collection',
    routes: [route('route_data_gov_v4_inventory', 'catalog_metadata', 'GET', '/technology/datagov/v4/search', ['per_page', 'after'], ['catalog_collection', 'catalog_item_record'])],
  }],
});

export const DATA_CMS_DATA_JSON_DESCRIPTOR = descriptor({
  slug: 'data_cms_data_json', sourceId: 'source_data_cms_catalog', connectorName: 'dcat-data-json',
  organizationId: 'organization_cms', organizationName: 'Centers for Medicare & Medicaid Services',
  hosts: ['data.cms.gov'], namespace: 'cms.data.catalog', documentation: true, schemaMetadata: true,
  endpoints: [
    { endpoint_id: 'endpoint_data_cms_data_json', base_url: 'https://data.cms.gov', target_class: 'catalog_root', routes: [
      route('route_data_cms_data_json', 'catalog_metadata', 'GET', '/data.json', [], ['catalog_collection', 'catalog_item_record']),
    ] },
    { endpoint_id: 'endpoint_data_cms_docs', base_url: 'https://data.cms.gov', target_class: 'documentation', routes: [
      route('route_data_cms_docs', 'documentation', 'GET', '/resources/{slug}', ['slug'], ['documentation_page']),
    ] },
  ],
});

export const CMS_PROVIDER_DATA_DESCRIPTOR = descriptor({
  slug: 'cms_provider_data', sourceId: 'source_cms_provider_data', connectorName: 'dcat-data-json',
  organizationId: 'organization_cms', organizationName: 'Centers for Medicare & Medicaid Services',
  hosts: ['data.cms.gov'], namespace: 'cms.provider-data.metastore', documentation: true, schemaMetadata: true, accessProbe: true,
  endpoints: [
    { endpoint_id: 'endpoint_cms_provider_metastore', base_url: 'https://data.cms.gov', target_class: 'collection', routes: [
      route('route_cms_provider_dataset_items', 'catalog_metadata', 'GET', '/provider-data/api/1/metastore/schemas/dataset/items', [], ['catalog_collection', 'catalog_item_record']),
    ] },
    { endpoint_id: 'endpoint_cms_provider_item', base_url: 'https://data.cms.gov', target_class: 'exact_item', routes: [
      route('route_cms_provider_dataset_item', 'catalog_metadata', 'GET', '/provider-data/api/1/metastore/schemas/dataset/items/{id}', ['id'], ['catalog_item_record']),
    ] },
    { endpoint_id: 'endpoint_cms_provider_docs', base_url: 'https://data.cms.gov', target_class: 'documentation', routes: [
      route('route_cms_provider_docs', 'documentation', 'GET', '/provider-data/docs', [], ['documentation_page']),
    ] },
    { endpoint_id: 'endpoint_cms_provider_access', base_url: 'https://data.cms.gov', target_class: 'exact_distribution', routes: [
      route('route_cms_provider_access_probe', 'access_probe', 'HEAD', '/provider-data/sites/default/files/{distribution}', ['distribution'], ['access_status_headers']),
    ] },
  ],
});

export const CDC_SOCRATA_DESCRIPTOR = descriptor({
  slug: 'cdc_socrata', sourceId: 'source_cdc_socrata', connectorName: 'socrata-catalog',
  organizationId: 'organization_cdc', organizationName: 'Centers for Disease Control and Prevention',
  hosts: ['data.cdc.gov'], namespace: 'cdc.socrata.views', strategy: 'modified_at_native_id', schemaMetadata: true,
  endpoints: [
    { endpoint_id: 'endpoint_cdc_socrata_metadata', base_url: 'https://data.cdc.gov', target_class: 'collection', routes: [
      route('route_cdc_socrata_inventory', 'catalog_metadata', 'GET', '/api/views/metadata/v1', ['limit', 'offset'], ['catalog_collection', 'catalog_item_record']),
    ] },
    { endpoint_id: 'endpoint_cdc_socrata_schema', base_url: 'https://data.cdc.gov', target_class: 'exact_item', routes: [
      route('route_cdc_socrata_view_schema', 'schema', 'GET', '/api/views/{id}', ['id'], ['schema_description', 'data_dictionary']),
    ] },
  ],
});

export const CDC_NON_SOCRATA_DESCRIPTOR = descriptor({
  slug: 'cdc_non_socrata', sourceId: 'source_cdc_non_socrata', connectorName: 'dcat-data-json',
  organizationId: 'organization_cdc', organizationName: 'Centers for Disease Control and Prevention',
  hosts: ['www.cdc.gov'], namespace: 'cdc.public-data.inventory', documentation: true,
  endpoints: [
    { endpoint_id: 'endpoint_cdc_non_socrata_inventory', base_url: 'https://www.cdc.gov', target_class: 'catalog_root', routes: [
      route('route_cdc_non_socrata_data_json', 'catalog_metadata', 'GET', '/data.json', [], ['catalog_collection', 'catalog_item_record']),
    ] },
    { endpoint_id: 'endpoint_cdc_non_socrata_docs', base_url: 'https://www.cdc.gov', target_class: 'documentation', routes: [
      route('route_cdc_non_socrata_docs', 'documentation', 'GET', '/{program}/data-and-statistics/{slug}.html', ['program', 'slug'], ['documentation_page']),
    ] },
  ],
});

export const CENSUS_METADATA_DESCRIPTOR = descriptor({
  slug: 'census_metadata', sourceId: 'source_census_metadata', connectorName: 'dcat-data-json',
  organizationId: 'organization_census', organizationName: 'U.S. Census Bureau',
  hosts: ['api.census.gov'], namespace: 'census.api.metadata', schemaMetadata: true,
  endpoints: [
    { endpoint_id: 'endpoint_census_metadata', base_url: 'https://api.census.gov', target_class: 'collection', routes: [
      route('route_census_dataset_inventory', 'catalog_metadata', 'GET', '/data.json', [], ['catalog_collection', 'catalog_item_record']),
    ] },
    { endpoint_id: 'endpoint_census_variables', base_url: 'https://api.census.gov', target_class: 'exact_item', routes: [
      route('route_census_variables_metadata', 'schema', 'GET', '/data/{year}/{dataset_family}/{dataset}/variables.json', ['year', 'dataset_family', 'dataset'], ['schema_description', 'data_dictionary']),
    ] },
  ],
});

export const HRSA_INVENTORY_DESCRIPTOR = descriptor({
  slug: 'hrsa_inventory', sourceId: 'source_hrsa_inventory', connectorName: 'dcat-data-json',
  organizationId: 'organization_hrsa', organizationName: 'Health Resources and Services Administration',
  hosts: ['data.hrsa.gov'], namespace: 'hrsa.product.inventory', documentation: true, schemaMetadata: true,
  endpoints: [
    { endpoint_id: 'endpoint_hrsa_data_json', base_url: 'https://data.hrsa.gov', target_class: 'catalog_root', routes: [
      route('route_hrsa_data_json', 'catalog_metadata', 'GET', '/data.json', [], ['catalog_collection', 'catalog_item_record']),
    ] },
    { endpoint_id: 'endpoint_hrsa_inventory_docs', base_url: 'https://data.hrsa.gov', target_class: 'documentation', routes: [
      route('route_hrsa_inventory_docs', 'documentation', 'GET', '/topics/health-workforce/', [], ['documentation_page']),
    ] },
  ],
});

export const AHRQ_FAMILY_INVENTORY_DESCRIPTOR = descriptor({
  slug: 'ahrq_family_inventory', sourceId: 'source_ahrq_family_inventory', connectorName: 'html-release-inventory',
  organizationId: 'organization_ahrq', organizationName: 'Agency for Healthcare Research and Quality',
  hosts: ['www.ahrq.gov'], namespace: 'ahrq.product.family', documentation: true,
  endpoints: [{
    endpoint_id: 'endpoint_ahrq_family_inventory', base_url: 'https://www.ahrq.gov', target_class: 'collection', routes: [
      route('route_ahrq_family_inventory', 'documentation', 'GET', '/data/data-resources/index.html', [], ['documentation_page']),
    ],
  }],
});

export const IRS_TEOS_EOBMF_INVENTORY_DESCRIPTOR = descriptor({
  slug: 'irs_teos_eobmf_inventory', sourceId: 'source_irs_teos_eobmf', connectorName: 'html-release-inventory',
  organizationId: 'organization_irs', organizationName: 'Internal Revenue Service',
  hosts: ['www.irs.gov'], namespace: 'irs.exempt-organization.inventory', documentation: true,
  endpoints: [
    { endpoint_id: 'endpoint_irs_teos_inventory', base_url: 'https://www.irs.gov', target_class: 'collection', routes: [
      route('route_irs_teos_inventory', 'documentation', 'GET', '/charities-non-profits/tax-exempt-organization-search-bulk-data-downloads', [], ['documentation_page']),
    ] },
    { endpoint_id: 'endpoint_irs_eobmf_inventory', base_url: 'https://www.irs.gov', target_class: 'collection', routes: [
      route('route_irs_eobmf_inventory', 'documentation', 'GET', '/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf', [], ['documentation_page']),
    ] },
  ],
});

export const IRS_FORM990_MANIFEST_DESCRIPTOR = descriptor({
  slug: 'irs_form990_manifest', sourceId: 'source_irs_form990_manifest', connectorName: 'html-release-inventory',
  organizationId: 'organization_irs', organizationName: 'Internal Revenue Service',
  hosts: ['apps.irs.gov'], namespace: 'irs.form990.manifest', documentation: true, schemaMetadata: true,
  endpoints: [
    { endpoint_id: 'endpoint_irs_form990_index', base_url: 'https://apps.irs.gov', target_class: 'collection', routes: [
      route('route_irs_form990_index', 'documentation', 'GET', '/pub/epostcard/990/xml/2026/', [], ['documentation_page']),
    ] },
    { endpoint_id: 'endpoint_irs_form990_xsd', base_url: 'https://apps.irs.gov', target_class: 'exact_item', routes: [
      route('route_irs_form990_xsd', 'schema', 'GET', '/pub/epostcard/990/xml/2026/{schema_name}.xsd', ['schema_name'], ['schema_description']),
    ] },
  ],
});

export const IRS_SOI_INVENTORY_DESCRIPTOR = descriptor({
  slug: 'irs_soi_inventory', sourceId: 'source_irs_soi_inventory', connectorName: 'html-release-inventory',
  organizationId: 'organization_irs', organizationName: 'Internal Revenue Service',
  hosts: ['www.irs.gov'], namespace: 'irs.soi.inventory', documentation: true,
  endpoints: [{
    endpoint_id: 'endpoint_irs_soi_inventory', base_url: 'https://www.irs.gov', target_class: 'collection', routes: [
      route('route_irs_soi_inventory', 'documentation', 'GET', '/statistics/soi-tax-stats-statistical-data-files', [], ['documentation_page']),
    ],
  }],
});

export const PENNSYLVANIA_SOCRATA_DESCRIPTOR = descriptor({
  slug: 'pa_socrata', sourceId: 'source_pa_socrata', connectorName: 'socrata-catalog',
  organizationId: 'organization_pa_commonwealth', organizationName: 'Commonwealth of Pennsylvania', authorityType: 'state_agency',
  hosts: ['data.pa.gov'], namespace: 'pa.socrata.views', strategy: 'modified_at_native_id', schemaMetadata: true,
  endpoints: [
    { endpoint_id: 'endpoint_pa_socrata_inventory', base_url: 'https://data.pa.gov', target_class: 'collection', routes: [
      route('route_pa_socrata_inventory', 'catalog_metadata', 'GET', '/api/views/metadata/v1', ['limit', 'offset'], ['catalog_collection', 'catalog_item_record']),
    ] },
    { endpoint_id: 'endpoint_pa_socrata_schema', base_url: 'https://data.pa.gov', target_class: 'exact_item', routes: [
      route('route_pa_socrata_schema', 'schema', 'GET', '/api/views/{id}', ['id'], ['schema_description', 'data_dictionary']),
    ] },
  ],
});

export const CALIFORNIA_CKAN_CANARY_DESCRIPTOR = descriptor({
  slug: 'ca_ckan_canary', sourceId: 'source_ca_ckan_canary', connectorName: 'ckan-catalog',
  organizationId: 'organization_ca_state', organizationName: 'State of California', authorityType: 'state_agency',
  hosts: ['data.ca.gov'], namespace: 'ca.ckan.package', strategy: 'modified_at_native_id', schemaMetadata: true,
  endpoints: [{
    endpoint_id: 'endpoint_ca_ckan_search', base_url: 'https://data.ca.gov', target_class: 'collection', routes: [
      route('route_ca_ckan_search', 'catalog_metadata', 'GET', '/api/3/action/package_search', ['rows', 'start'], ['catalog_collection', 'catalog_item_record']),
    ],
  }],
});

export const PENNSYLVANIA_ARCGIS_CANARY_DESCRIPTOR = descriptor({
  slug: 'pa_arcgis_canary', sourceId: 'source_pa_arcgis_canary', connectorName: 'arcgis-catalog',
  organizationId: 'organization_pa_geospatial', organizationName: 'Pennsylvania geospatial authority candidate', authorityType: 'state_agency',
  hosts: ['www.arcgis.com'], namespace: 'pa.arcgis.item', strategy: 'modified_at_native_id', schemaMetadata: true,
  endpoints: [{
    endpoint_id: 'endpoint_pa_arcgis_search', base_url: 'https://www.arcgis.com', target_class: 'collection', routes: [
      route('route_pa_arcgis_search', 'catalog_metadata', 'GET', '/sharing/rest/search', ['f', 'q', 'num', 'start', 'sortField', 'sortOrder'], ['catalog_collection', 'catalog_item_record']),
    ],
  }],
});

export const PENNSYLVANIA_STATIC_CANARY_DESCRIPTOR = descriptor({
  slug: 'pa_static_canary', sourceId: 'source_pa_static_canary', connectorName: 'html-release-inventory',
  organizationId: 'organization_pa_health', organizationName: 'Pennsylvania Department of Health', authorityType: 'state_agency',
  hosts: ['www.pa.gov'], namespace: 'pa.health.static.inventory', documentation: true,
  endpoints: [{
    endpoint_id: 'endpoint_pa_static_inventory', base_url: 'https://www.pa.gov', target_class: 'collection', routes: [
      route('route_pa_static_inventory', 'documentation', 'GET', '/agencies/health/facilities/hospitals.html', [], ['documentation_page']),
    ],
  }],
});

export const HARVARD_DATAVERSE_DESCRIPTOR = descriptor({
  slug: 'harvard_dataverse', sourceId: 'source_harvard_dataverse', connectorName: 'dataverse-catalog',
  organizationId: 'organization_harvard_dataverse', organizationName: 'Harvard Dataverse', authorityType: 'academic_repository',
  hosts: ['dataverse.harvard.edu'], namespace: 'harvard.dataverse.dataset', strategy: 'full_snapshot', documentation: true,
  endpoints: [{
    endpoint_id: 'endpoint_harvard_dataverse_search', base_url: 'https://dataverse.harvard.edu', target_class: 'collection', routes: [
      route('route_harvard_dataverse_search', 'catalog_metadata', 'GET', '/api/search', ['q', 'type', 'per_page', 'start', 'subtree', 'show_relevance'], ['catalog_collection', 'catalog_item_record']),
    ],
  }],
});

export const DATACITE_DESCRIPTOR = descriptor({
  slug: 'datacite', sourceId: 'source_datacite', connectorName: 'datacite-catalog',
  organizationId: 'organization_datacite', organizationName: 'DataCite', authorityType: 'nonprofit_repository',
  hosts: ['api.datacite.org'], namespace: 'datacite.doi', strategy: 'full_snapshot', documentation: true,
  endpoints: [{
    endpoint_id: 'endpoint_datacite_dois', base_url: 'https://api.datacite.org', target_class: 'collection', routes: [
      route('route_datacite_dois', 'catalog_metadata', 'GET', '/dois', ['page[number]', 'page[size]', 'query', 'client-id', 'provider-id'], ['catalog_collection', 'catalog_item_record']),
    ],
  }],
});

export const CDC_STACKS_OAI_DESCRIPTOR = descriptor({
  slug: 'cdc_stacks_oai', sourceId: 'source_cdc_stacks_oai', connectorName: 'oai-pmh-catalog',
  organizationId: 'organization_cdc', organizationName: 'Centers for Disease Control and Prevention',
  hosts: ['stacks.cdc.gov'], namespace: 'cdc.stacks.oai', strategy: 'full_snapshot',
  endpoints: [{
    endpoint_id: 'endpoint_cdc_stacks_oai', base_url: 'https://stacks.cdc.gov', target_class: 'collection', routes: [
      route('route_cdc_stacks_oai', 'catalog_metadata', 'GET', '/oai', ['verb', 'metadataPrefix', 'set', 'resumptionToken'], ['catalog_collection', 'catalog_item_record']),
    ],
  }],
});

export const APPROVED_SOURCE_DESCRIPTOR_TEMPLATES = deepFreeze([
  DATA_GOV_V4_DESCRIPTOR,
  DATA_CMS_DATA_JSON_DESCRIPTOR,
  CMS_PROVIDER_DATA_DESCRIPTOR,
  CDC_SOCRATA_DESCRIPTOR,
  CDC_NON_SOCRATA_DESCRIPTOR,
  CENSUS_METADATA_DESCRIPTOR,
  HRSA_INVENTORY_DESCRIPTOR,
  AHRQ_FAMILY_INVENTORY_DESCRIPTOR,
  IRS_TEOS_EOBMF_INVENTORY_DESCRIPTOR,
  IRS_FORM990_MANIFEST_DESCRIPTOR,
  IRS_SOI_INVENTORY_DESCRIPTOR,
  PENNSYLVANIA_SOCRATA_DESCRIPTOR,
  CALIFORNIA_CKAN_CANARY_DESCRIPTOR,
  PENNSYLVANIA_ARCGIS_CANARY_DESCRIPTOR,
  PENNSYLVANIA_STATIC_CANARY_DESCRIPTOR,
  HARVARD_DATAVERSE_DESCRIPTOR,
  DATACITE_DESCRIPTOR,
  CDC_STACKS_OAI_DESCRIPTOR,
]);

export const DISABLED_SOURCE_DESCRIPTOR_TEMPLATES = APPROVED_SOURCE_DESCRIPTOR_TEMPLATES;

export const DESCRIPTOR_TEMPLATE_ACTIVATION = deepFreeze({
  lifecycle: 'fixture_only',
  external_authorization_gate: 'AUTH-04',
  activation_authorized: false,
  live_network_permitted: false,
  source_state: 'paused',
  requirements_before_live_shadow: [
    'source-specific legal and terms review',
    'credential provisioning where required',
    'live route-manifest confirmation',
    'two complete shadow reconciliations and one incremental cycle',
    'explicit external authorization',
  ],
});
