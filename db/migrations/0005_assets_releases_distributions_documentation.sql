-- 0005: typed asset, release, distribution, and documentation revisions.

set local timezone = 'UTC';
set local role ushso_catalog_owner;

create table catalog.assets (
  asset_revision_id text primary key references catalog.object_revisions(revision_id) on delete restrict,
  asset_id text not null references catalog.objects(entity_id) on delete restrict,
  source_id text not null references catalog.objects(entity_id) on delete restrict,
  responsible_organization_id text not null references catalog.objects(entity_id) on delete restrict,
  title text not null check (length(title) between 1 and 1000),
  asset_kind text not null check (asset_kind in ('dataset', 'product', 'report_series', 'registry', 'collection', 'crosswalk', 'methodology', 'other')),
  summary text not null check (length(summary) between 1 and 5000),
  identity_resolution_state text not null check (identity_resolution_state in ('source_scoped', 'authoritatively_resolved', 'review_pending', 'conflicted', 'unknown')),
  family_resolution_state text not null check (family_resolution_state in ('not_grouped', 'candidate', 'accepted', 'conflicted', 'unknown')),
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  unique (asset_id, asset_revision_id)
);

create index assets_source_idx on catalog.assets (source_id, asset_id);
create index assets_identity_review_idx on catalog.assets (identity_resolution_state, asset_id)
  where identity_resolution_state in ('review_pending', 'conflicted');

create table catalog.releases (
  release_revision_id text primary key references catalog.object_revisions(revision_id) on delete restrict,
  release_id text not null references catalog.objects(entity_id) on delete restrict,
  asset_id text not null references catalog.objects(entity_id) on delete restrict,
  release_label text not null check (length(release_label) between 1 and 500),
  release_kind text not null check (release_kind in ('edition', 'vintage', 'snapshot', 'filing_period', 'api_version', 'rolling_current', 'other')),
  publisher_version text,
  cadence text not null check (cadence in ('continuous', 'daily', 'weekly', 'monthly', 'quarterly', 'annual', 'irregular', 'one_time', 'unknown')),
  immutable boolean not null check (immutable),
  coverage_intervals jsonb not null check (jsonb_typeof(coverage_intervals) = 'array'),
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  unique (release_id, release_revision_id)
);

create index releases_asset_idx on catalog.releases (asset_id, release_id);

create table catalog.distributions (
  distribution_revision_id text primary key references catalog.object_revisions(revision_id) on delete restrict,
  distribution_id text not null references catalog.objects(entity_id) on delete restrict,
  release_id text not null references catalog.objects(entity_id) on delete restrict,
  title text not null check (length(title) between 1 and 1000),
  distribution_kind text not null check (distribution_kind in ('download', 'api', 'query_service', 'web_interface', 'document', 'other')),
  format text not null check (length(format) between 1 and 120),
  media_type text,
  access_route_ids text[] not null check (cardinality(access_route_ids) > 0),
  machine_readiness jsonb not null check (jsonb_typeof(machine_readiness) = 'object'),
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  unique (distribution_id, distribution_revision_id)
);

create index distributions_release_idx on catalog.distributions (release_id, distribution_id);

create table catalog.documentation (
  documentation_revision_id text primary key references catalog.object_revisions(revision_id) on delete restrict,
  documentation_id text not null references catalog.objects(entity_id) on delete restrict,
  subject_id text not null references catalog.objects(entity_id) on delete restrict,
  documentation_type text not null check (documentation_type in ('codebook', 'methodology', 'schema', 'data_dictionary', 'license', 'landing_page', 'access_guide', 'change_log', 'other')),
  title text not null check (length(title) between 1 and 1000),
  locator text not null check (locator ~ '^https?://'),
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  unique (documentation_id, documentation_revision_id)
);

create index documentation_subject_idx on catalog.documentation (subject_id, documentation_type, documentation_id);

create trigger assets_append_only before update or delete on catalog.assets
for each statement execute function ops.reject_history_mutation();
create trigger releases_append_only before update or delete on catalog.releases
for each statement execute function ops.reject_history_mutation();
create trigger distributions_append_only before update or delete on catalog.distributions
for each statement execute function ops.reject_history_mutation();
create trigger documentation_append_only before update or delete on catalog.documentation
for each statement execute function ops.reject_history_mutation();

reset role;

grant select on catalog.assets, catalog.releases, catalog.distributions,
  catalog.documentation to ushso_projector, ushso_ops;
revoke all on catalog.assets, catalog.releases, catalog.distributions,
  catalog.documentation from ushso_public, ushso_scheduler, ushso_harvest;

