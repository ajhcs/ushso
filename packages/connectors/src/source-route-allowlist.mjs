const FIXTURE_SOURCE_IDS = new Set(['source_fixture_catalog']);

export const SECRET_QUERY_DENYLIST_ACTIVE = true;

export const FIXTURE_METADATA_ROUTE_ALLOWLIST = Object.freeze([
  {
    "host": "catalog.example.gov",
    "method": "GET",
    "purpose": "catalog_metadata",
    "path_template": "/data.json"
  },
  {
    "host": "catalog.example.gov",
    "method": "GET",
    "purpose": "catalog_metadata",
    "path_template": "/items/{id}"
  },
  {
    "host": "catalog.example.gov",
    "method": "GET",
    "purpose": "schema",
    "path_template": "/schemas/{id}"
  },
  {
    "host": "catalog.example.gov",
    "method": "GET",
    "purpose": "documentation",
    "path_template": "/docs/{slug}"
  },
  {
    "host": "catalog.example.gov",
    "method": "GET",
    "purpose": "documentation",
    "path_template": "/inventory"
  },
  {
    "host": "catalog.example.gov",
    "method": "HEAD",
    "purpose": "access_probe",
    "path_template": "/files/{id}"
  },
  {
    "host": "catalog.example.gov",
    "method": "GET",
    "purpose": "schema",
    "path_template": "/data/{year}/{dataset_family}/{dataset}/variables.json"
  }
].map((entry) => Object.freeze(entry)));

export const SOURCE_METADATA_ROUTE_ALLOWLIST = Object.freeze(Object.fromEntries(
  Object.entries({
  "source_ahrq_family_inventory": [
    {
      "host": "www.ahrq.gov",
      "method": "GET",
      "purpose": "documentation",
      "path_template": "/data/data-resources/index.html"
    }
  ],
  "source_ca_ckan_canary": [
    {
      "host": "data.ca.gov",
      "method": "GET",
      "purpose": "catalog_metadata",
      "path_template": "/api/3/action/package_search"
    }
  ],
  "source_cdc_non_socrata": [
    {
      "host": "www.cdc.gov",
      "method": "GET",
      "purpose": "documentation",
      "path_template": "/{program}/data-and-statistics/{slug}.html"
    },
    {
      "host": "www.cdc.gov",
      "method": "GET",
      "purpose": "catalog_metadata",
      "path_template": "/data.json"
    }
  ],
  "source_cdc_socrata": [
    {
      "host": "data.cdc.gov",
      "method": "GET",
      "purpose": "schema",
      "path_template": "/api/views/{id}"
    },
    {
      "host": "data.cdc.gov",
      "method": "GET",
      "purpose": "catalog_metadata",
      "path_template": "/api/views/metadata/v1"
    }
  ],
  "source_cdc_stacks_oai": [
    {
      "host": "stacks.cdc.gov",
      "method": "GET",
      "purpose": "catalog_metadata",
      "path_template": "/oai"
    }
  ],
  "source_census_metadata": [
    {
      "host": "api.census.gov",
      "method": "GET",
      "purpose": "catalog_metadata",
      "path_template": "/data.json"
    },
    {
      "host": "api.census.gov",
      "method": "GET",
      "purpose": "schema",
      "path_template": "/data/{year}/{dataset_family}/{dataset}/variables.json"
    }
  ],
  "source_cms_provider_data": [
    {
      "host": "data.cms.gov",
      "method": "GET",
      "purpose": "catalog_metadata",
      "path_template": "/provider-data/api/1/metastore/schemas/dataset/items"
    },
    {
      "host": "data.cms.gov",
      "method": "GET",
      "purpose": "catalog_metadata",
      "path_template": "/provider-data/api/1/metastore/schemas/dataset/items/{id}"
    },
    {
      "host": "data.cms.gov",
      "method": "GET",
      "purpose": "documentation",
      "path_template": "/provider-data/docs"
    },
    {
      "host": "data.cms.gov",
      "method": "HEAD",
      "purpose": "access_probe",
      "path_template": "/provider-data/sites/default/files/{distribution}"
    }
  ],
  "source_data_cms_catalog": [
    {
      "host": "data.cms.gov",
      "method": "GET",
      "purpose": "catalog_metadata",
      "path_template": "/data.json"
    },
    {
      "host": "data.cms.gov",
      "method": "GET",
      "purpose": "documentation",
      "path_template": "/resources/{slug}"
    }
  ],
  "source_data_gov_v4": [
    {
      "host": "api.gsa.gov",
      "method": "GET",
      "purpose": "catalog_metadata",
      "path_template": "/technology/datagov/v4/search"
    }
  ],
  "source_datacite": [
    {
      "host": "api.datacite.org",
      "method": "GET",
      "purpose": "catalog_metadata",
      "path_template": "/dois"
    }
  ],
  "source_harvard_dataverse": [
    {
      "host": "dataverse.harvard.edu",
      "method": "GET",
      "purpose": "catalog_metadata",
      "path_template": "/api/search"
    }
  ],
  "source_hrsa_inventory": [
    {
      "host": "data.hrsa.gov",
      "method": "GET",
      "purpose": "catalog_metadata",
      "path_template": "/data.json"
    },
    {
      "host": "data.hrsa.gov",
      "method": "GET",
      "purpose": "documentation",
      "path_template": "/topics/health-workforce/"
    }
  ],
  "source_irs_form990_manifest": [
    {
      "host": "apps.irs.gov",
      "method": "GET",
      "purpose": "documentation",
      "path_template": "/pub/epostcard/990/xml/2026/"
    },
    {
      "host": "apps.irs.gov",
      "method": "GET",
      "purpose": "schema",
      "path_template": "/pub/epostcard/990/xml/2026/{schema_name}.xsd"
    }
  ],
  "source_irs_soi_inventory": [
    {
      "host": "www.irs.gov",
      "method": "GET",
      "purpose": "documentation",
      "path_template": "/statistics/soi-tax-stats-statistical-data-files"
    }
  ],
  "source_irs_teos_eobmf": [
    {
      "host": "www.irs.gov",
      "method": "GET",
      "purpose": "documentation",
      "path_template": "/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf"
    },
    {
      "host": "www.irs.gov",
      "method": "GET",
      "purpose": "documentation",
      "path_template": "/charities-non-profits/tax-exempt-organization-search-bulk-data-downloads"
    }
  ],
  "source_pa_arcgis_canary": [
    {
      "host": "www.arcgis.com",
      "method": "GET",
      "purpose": "catalog_metadata",
      "path_template": "/sharing/rest/search"
    }
  ],
  "source_pa_socrata": [
    {
      "host": "data.pa.gov",
      "method": "GET",
      "purpose": "schema",
      "path_template": "/api/views/{id}"
    },
    {
      "host": "data.pa.gov",
      "method": "GET",
      "purpose": "catalog_metadata",
      "path_template": "/api/views/metadata/v1"
    }
  ],
  "source_pa_static_canary": [
    {
      "host": "www.pa.gov",
      "method": "GET",
      "purpose": "documentation",
      "path_template": "/agencies/health/facilities/hospitals.html"
    }
  ]
}).map(([sourceId, routes]) => [
    sourceId,
    Object.freeze(routes.map((entry) => Object.freeze(entry))),
  ]),
));

function normalizedHost(value) {
  return String(value).toLowerCase().replace(/\.$/u, '');
}

function routeKey(entry) {
  return [normalizedHost(entry.host), entry.method, entry.purpose, entry.path_template].join('|');
}

const FIXTURE_HOST_ALLOWLIST = new Set(['catalog.example.gov', 'mirror.example.gov']);

// Fixture descriptors may use either fixture host, but only the fixture
// path_template/method/purpose tuples — never a union of production shapes.
const FIXTURE_ROUTE_KEY_ALLOWLIST = new Set(
  [...FIXTURE_HOST_ALLOWLIST].flatMap((host) => FIXTURE_METADATA_ROUTE_ALLOWLIST.map((entry) => routeKey({ ...entry, host }))),
);

export function isFixtureSourceId(sourceId) {
  return typeof sourceId === 'string' && FIXTURE_SOURCE_IDS.has(sourceId);
}

export function allowlistedRoutesFor(descriptor) {
  if (isFixtureSourceId(descriptor.source_id)) {
    return FIXTURE_METADATA_ROUTE_ALLOWLIST;
  }
  return SOURCE_METADATA_ROUTE_ALLOWLIST[descriptor.source_id] ?? null;
}

function descriptorRouteKeys(descriptor) {
  return descriptor.endpoints.flatMap((endpoint) => {
    const host = normalizedHost(new URL(endpoint.base_url).hostname);
    return endpoint.routes.map((route) => routeKey({
      host,
      method: route.method,
      purpose: route.purpose,
      path_template: route.path_template,
    }));
  });
}

export function assertPositiveMetadataRouteAllowlist(descriptor) {
  if (isFixtureSourceId(descriptor.source_id)) {
    const actualKeys = descriptorRouteKeys(descriptor);
    if (actualKeys.some((key) => !FIXTURE_ROUTE_KEY_ALLOWLIST.has(key))) {
      throw new TypeError(`Descriptor routes are not the positive allowlist for ${descriptor.source_id}.`);
    }
    return;
  }
  const expected = SOURCE_METADATA_ROUTE_ALLOWLIST[descriptor.source_id];
  if (!expected) {
    throw new TypeError(`No positive metadata-route allowlist for ${descriptor.source_id}.`);
  }
  const expectedKeys = expected.map(routeKey).sort();
  const actualKeys = descriptorRouteKeys(descriptor).sort();
  if (expectedKeys.length !== actualKeys.length || expectedKeys.some((key, index) => key !== actualKeys[index])) {
    throw new TypeError(`Descriptor routes are not the positive allowlist for ${descriptor.source_id}.`);
  }
}
