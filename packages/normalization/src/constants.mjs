export const NORMALIZER_NAME = 'legacy-corpus-normalizer';
export const NORMALIZER_VERSION = '1.0.0';
export const IMPORT_CONTRACT_VERSION = 'ushso-normalization-import.v1.0.0';
export const IMPORT_PLAN_VERSION = 'ushso-normalization-import-plan.v1.0.0';
export const INCREMENTAL_IMPORT_CONTRACT_VERSION = 'ushso-normalization-incremental-import.v1.0.0';
export const INCREMENTAL_IMPORT_PLAN_VERSION = 'ushso-normalization-incremental-plan.v1.0.0';
export const INCREMENTAL_ENVELOPE_VERSION = 'ushso-normalization-incremental-envelope.v1.0.0';
export const APPEND_ONLY_PERSISTENCE_PROFILE_VERSION = 'ushso-normalization-append-only-persistence.v1.0.0';
export const IMPORT_RECEIPT_VERSION = 'ushso-normalization-import-receipt.v1.1.0';
export const SOURCE_CORPUS_VERSION = '1.1.0';
export const SOURCE_MANIFEST_FILE_SHA256 = '23f704ce3e421a6eb26c2b3677d616a1ae6b4f45226233257b9a1ff676caba2b';
export const SOURCE_CONTENT_FINGERPRINT = 'adcfb56babc981a4c7dfc787af86d56f5fb2a31e84de02f9db8c93f0548b5d03';
export const SOURCE_CORPUS_SHA256 = '4eaeffdcbb3db324f51485f38f915e392724b80c5372358933681c003eb5f864';
export const SOURCE_RECORDS_SHA256 = '458c8e7ec15e059e60bc908fc98f6b94f8deafd9bd1862d1dc0b576ac830f046';
export const SOURCE_SEARCH_DOCUMENTS_SHA256 = '8c7913596353d4ea2c6f5b763d3711aa77d97a457bb91b4cbce990bbf301e633';
export const SOURCE_JOIN_ROUTES_SHA256 = 'f712c73fdfb78cf95c7ce29c68819c353a2ae2192a6feef78b8e6da38db4a0dc';
export const EXPECTED_RECORD_COUNT = 157;
export const EXPECTED_SEARCH_DOCUMENT_COUNT = 157;
export const EXPECTED_JOIN_ROUTE_COUNT = 14;
export const RECORDED_AT = '2026-08-30T18:15:36.295Z';

export const COLLECTIONS = Object.freeze([
  'organizations', 'sources', 'assets', 'releases', 'distributions',
  'documentation', 'schema_snapshots', 'schema_fields', 'access_routes',
  'access_observations', 'evidence', 'assertions', 'relationships'
]);

export const COLLECTION_TO_ID_FIELD = Object.freeze({
  organizations: 'organization_id',
  sources: 'source_id',
  assets: 'asset_id',
  releases: 'release_id',
  distributions: 'distribution_id',
  documentation: 'documentation_id',
  schema_snapshots: 'schema_snapshot_id',
  schema_fields: 'schema_field_id',
  access_routes: 'access_route_id',
  access_observations: 'observation_id',
  evidence: 'evidence_id',
  assertions: 'assertion_id',
  relationships: 'relationship_id'
});
