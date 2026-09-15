export const LEARN_GENERATION = 'live-2026-09-03-85b50522b420'
export const HCRIS_HOSPITAL_COST_REPORT_ID = 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17'
export const CENSUS_ABSCB_2023_ID = 'obs:asset:census-api:api.census.gov-data-id-abscb2023-ec8bee5f048e6e3f'
export const HCUP_FIXTURE_ID = 'asset.hcup.restricted.fixture'
export const CMS_LANDING = 'https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report'
export const CENSUS_VARIABLES = 'https://api.census.gov/data/2023/abscb/variables.json'
export const HCUP_DOCS = 'https://hcup-us.ahrq.gov/databases.jsp'
export const CMS_CURL = "curl --get 'https://data.cms.gov/provider-compliance/cost-reports/hospital-provider-cost-report'"
export const CENSUS_CURL = "curl --get 'https://api.census.gov/data/2023/abscb/variables.json' --data-urlencode 'key=[REDACTED]'"
export const CENSUS_PYTHON = [
  'import urllib.parse, urllib.request',
  "params = {'key': '[REDACTED]'}",
  "url = 'https://api.census.gov/data/2023/abscb/variables.json?' + urllib.parse.urlencode(params)",
  'print(url)',
].join('\n')
export const HCUP_EXAMPLE = 'Open https://hcup-us.ahrq.gov/databases.jsp in a browser. No machine payload request is generated.'

export interface LearnGuide {
  id: string
  title: string
  nextHref: string
  nextLabel: string
  paragraphs: string[]
  terms?: Array<{ term: string; definition: string }>
  steps?: string[]
  examples?: Array<{ label: string; language: 'bash' | 'python' | 'text'; code: string; status: string }>
}

export const beginnerGuides: LearnGuide[] = [
  {
    id: 'what-ushso-does',
    title: 'What USHSO does',
    nextHref: '/learn#first-search',
    nextLabel: 'Your first source search',
    paragraphs: [
      'USHSO is a discovery and routing layer. It helps you find published United States health-systems sources, inspect documented coverage, and see the access route the publisher already published.',
      'Finding a source is not obtaining the data. A successful page load, search result, or tool envelope is not a completed research task. HTTP 200 is not acceptance, payload access, schema completeness, or scientific approval.',
      'Verified next action: search CMS HCRIS hospital cost reports in Explore. The reviewed identity is the CMS Hospital Provider Cost Report catalog record on generation live-2026-09-03-85b50522b420. Opening that result is metadata inspection, not a cost-report download.',
    ],
    terms: [
      { term: 'Dataset / source', definition: 'A publisher product USHSO indexed as catalog metadata. Catalog membership is not payload access.' },
      { term: 'API', definition: 'A publisher machine interface. Calling it, if allowed, happens at the publisher, not inside USHSO.' },
      { term: 'File', definition: 'A publisher download or research file. USHSO does not retrieve restricted files.' },
      { term: 'Release', definition: 'An exact publisher vintage, documentation page, or distribution. Rolling catalog pages are not exact annual releases.' },
      { term: 'Variable', definition: 'A named field in a selected release or distribution. Unapproved dictionary text is not a canonical schema.' },
      { term: 'Grain', definition: 'The unit a source reports on, such as a hospital cost-report period. Inferred search tags are not source-asserted grain.' },
      { term: 'Access', definition: 'The documented route to the publisher. Public, keyed, and restricted routes stay distinct.' },
    ],
  },
  {
    id: 'first-search',
    title: 'Your first source search',
    nextHref: '/learn#read-source',
    nextLabel: 'How to read a source page',
    paragraphs: [
      'Use Explore to inspect catalog metadata. Do not treat the first card as proof that a file is in your possession.',
      'The reviewed HCRIS identity is obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17 on generation live-2026-09-03-85b50522b420.',
      'This example is not a bulk HCRIS file, not a complete HCRIS schema, not source-asserted inferred units, and not a completed research task.',
    ],
    steps: [
      'Open Explore with the question CMS HCRIS hospital cost reports, or browse with a blank question.',
      'Open the CMS Hospital Provider Cost Report card. Unknown geography is not a confirmed match. Contextual sources stay visibly separated.',
      'On the source page, read purpose, exact product/release, observed coverage/grain, access requirements, and last tested metadata check.',
    ],
  },
  {
    id: 'read-source',
    title: 'How to read a source page',
    nextHref: '/learn#access-routes',
    nextLabel: 'Access routes',
    paragraphs: [
      'A source page answers what the product is, how to use it, and what USHSO actually tested.',
      'Read purpose, exact product/release, observed coverage/grain/time, access requirements, and the last successful metadata check first. Unknown cost and usage limits remain visible. A catalog check is not a payload check.',
      'The CMS Hospital Provider Cost Report landing page is a reachable documentation page, not proven payload or browser access. Accepted Worksheet G-3 wire mappings are not a complete HCRIS schema. Inferred unit tags are search aids only.',
      'Clear source action: open the CMS Hospital Provider Cost Report landing page and stop before any bulk file acquisition. An unresolved join is not a confirmed merge. CCN and NPI are never interchangeable.',
    ],
  },
]

export const accessGuides: LearnGuide[] = [
  {
    id: 'access-routes',
    title: 'Access routes: public, keyed, and restricted',
    nextHref: '/learn#developer-quick-start',
    nextLabel: 'Developer and MCP quick start',
    paragraphs: [
      'USHSO shows documented routes. The publisher still owns download, key issuance, applications, and data-use agreements.',
      'Public CMS HCRIS uses release.cms.hcris.documentation and distribution.cms.hcris.landing-page. There is no credential. Cost and quota remain unknown. HTTP 200 on the documentation page is not a tested-example badge and is not payload access.',
      'Census variables.json uses wire parameter key. The required credential is named only as Census API key. The example value is [REDACTED]. This path is credential-blocked in USHSO. Observation queries remain out of scope. Cost remains unknown; quota remains unknown.',
      'HCUP remains a restricted application route. Identify the exact restricted HCUP database on the publisher site and follow the documented application/DUA process outside USHSO. No machine payload request is generated. Do not treat public MEPS files as this restricted HCUP route.',
    ],
    examples: [
      { label: 'Public CMS documentation inspect', language: 'bash', code: CMS_CURL, status: 'Recipe inspection only. Retrieval is not executed. HTTP 200 is not a tested-example badge.' },
      { label: 'Census variables.json with named key placeholder', language: 'bash', code: CENSUS_CURL, status: 'Credential-blocked. Substitute a Census API key you hold; USHSO does not embed the secret.' },
      { label: 'Census variables.json Python placeholder', language: 'python', code: CENSUS_PYTHON, status: 'Credential-blocked. Exact wire name is key. Example value remains [REDACTED].' },
      { label: 'Restricted HCUP application', language: 'text', code: HCUP_EXAMPLE, status: 'Untested machine payload path. Follow the publisher application process. No machine payload request is generated.' },
    ],
  },
  {
    id: 'developer-quick-start',
    title: 'Developer and MCP quick start',
    nextHref: '/agents',
    nextLabel: 'Developers page',
    paragraphs: [
      'Agents and people use the same eight read-only inspection tools. plan_research stays disabled.',
      'Send a bounded JSON question to /api/discover. Requests are limited to 20 KiB. The Agents page response excerpt is generated from the versioned 3,434-record production corpus and checked against its reviewed leading record. A zero-result response is not evidence that no source exists.',
      'Versioned machine routes live under /api/machine/v1. Preserve index_generation from the first successful response. If a generation pin fails, restart without the old cursor.',
      'A clean MCP install is a copy of plugins/ushso-research/ plus Node. There are no npm dependencies. Do not import the development checkout. Marketplace UI installation is not claimed. Native WebMCP is untested in unsupported browsers; use stdio MCP or HTTP. Expect exactly eight advertised tools. plan_research must not appear. A successful tool envelope is not a completed research task.',
    ],
    examples: [
      {
        label: 'Discovery curl',
        language: 'bash',
        code: [
          'curl -sS https://ushso.org/api/discover \\',
          '  -H "content-type: application/json" \\',
          '  --data \'{"question":"CMS HCRIS hospital cost reports by state","limit":10}\'',
        ].join('\n'),
        status: 'Same-origin discovery example from the Developers page. Not payload access.',
      },
      {
        label: 'MCP clean install',
        language: 'bash',
        code: 'mkdir -p /tmp/ushso-research-mcp\ncp -R plugins/ushso-research/. /tmp/ushso-research-mcp/\nnode /tmp/ushso-research-mcp/scripts/mcp.mjs',
        status: 'Stdio MCP is the tested install path. Marketplace UI installation is not claimed.',
      },
    ],
  },
]

export const allGuides = [...beginnerGuides, ...accessGuides]
