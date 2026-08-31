-- 0007: assertions, orthogonal relationship semantics, temporal revision
-- history, atomic canonical import, exact legacy v1 projection, and
-- non-destructive batch rejection.

set local timezone = 'UTC';

-- Selection is authorized by an operations audit event but remains owned by
-- the catalog maintenance role.  Read-only access is the minimum cross-schema
-- privilege required by the SECURITY DEFINER selector below.
grant usage on schema ops to ushso_catalog_owner;
grant select, references on ops.audit_events to ushso_catalog_owner;
grant select on ops.environment_fence to ushso_catalog_owner;

set local role ushso_catalog_owner;

alter table catalog.import_batches
  add constraint import_batches_rejection_audit_event_fk
  foreign key (rejection_audit_event_id, rejection_audit_event_occurred_at)
  references ops.audit_events(audit_event_id, occurred_at) on delete restrict;
alter table catalog.import_batch_events
  add constraint import_batch_events_audit_event_fk
  foreign key (audit_event_id, audit_event_occurred_at)
  references ops.audit_events(audit_event_id, occurred_at) on delete restrict;

-- Canonical JSON exactly mirrors contracts/core/v2.0.0/tools/common.mjs:
-- UTF-8 byte ordered object keys, preserved array order, JSON string escaping,
-- booleans/null, and safe integers only.  PostgreSQL's jsonb::text ordering is
-- deliberately not used as a digest domain.
create function catalog.canonical_json(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, catalog
as $function$
declare
  v_type text := jsonb_typeof(p_value);
  v_number numeric;
  v_result text;
begin
  if v_type = 'null' then return 'null'; end if;
  if v_type = 'boolean' then return p_value::text; end if;
  if v_type = 'string' then return to_jsonb(p_value #>> '{}')::text; end if;
  if v_type = 'number' then
    v_number := (p_value #>> '{}')::numeric;
    if v_number <> trunc(v_number) or abs(v_number) > 9007199254740991 then
      raise exception using errcode = '22023', message = 'CANONICAL_JSON_NUMBER_MUST_BE_SAFE_INTEGER';
    end if;
    return trunc(v_number)::text;
  end if;
  if v_type = 'array' then
    select '[' || coalesce(string_agg(catalog.canonical_json(item.value), ',' order by item.ordinality), '') || ']'
      into v_result
    from jsonb_array_elements(p_value) with ordinality item(value, ordinality);
    return v_result;
  end if;
  if v_type = 'object' then
    select '{' || coalesce(string_agg(
      to_jsonb(item.key)::text || ':' || catalog.canonical_json(item.value),
      ',' order by convert_to(item.key, 'UTF8')
    ), '') || '}' into v_result
    from jsonb_each(p_value) item;
    return v_result;
  end if;
  raise exception using errcode = '22023', message = 'CANONICAL_JSON_UNSUPPORTED_TYPE';
end
$function$;

create function catalog.content_fingerprint(p_value jsonb)
returns text
language sql
immutable
strict
set search_path = pg_catalog, catalog
as $function$
  select 'sha256:' || encode(sha256(convert_to(catalog.canonical_json(p_value), 'UTF8')), 'hex');
$function$;

create function catalog.normalization_opaque_id(p_kind text, p_immutable_key text)
returns text
language sql
immutable
strict
set search_path = pg_catalog, catalog
as $function$
  select 'urn:ushso:' || p_kind || ':' || left(substr(catalog.content_fingerprint(
    jsonb_build_object('kind', p_kind, 'immutable_key', p_immutable_key)
  ), 8), 40);
$function$;

create table catalog.assertions (
  assertion_revision_id text primary key references catalog.object_revisions(revision_id) on delete restrict,
  assertion_id text not null references catalog.objects(entity_id) on delete restrict,
  subject_id text not null references catalog.objects(entity_id) on delete restrict,
  predicate text not null check (predicate ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  claim_value jsonb not null check (jsonb_typeof(claim_value) = 'object'),
  claim_class text not null check (claim_class in ('identity', 'description', 'coverage', 'publisher_time', 'access', 'schema', 'fitness', 'provenance', 'other')),
  epistemic_state text not null check (epistemic_state in ('unknown', 'candidate', 'ambiguous', 'documented', 'observed', 'proven', 'disputed')),
  effective_from timestamptz,
  effective_to timestamptz,
  evidence_ids text[] not null check (cardinality(evidence_ids) > 0),
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  check (effective_to is null or effective_from is null or effective_from <= effective_to),
  unique (assertion_id, assertion_revision_id)
);

create index assertions_subject_predicate_idx on catalog.assertions (subject_id, predicate, assertion_id);
create index assertions_effective_idx on catalog.assertions (predicate, effective_from, effective_to);

create table catalog.relationships (
  relationship_revision_id text primary key references catalog.object_revisions(revision_id) on delete restrict,
  relationship_id text not null references catalog.objects(entity_id) on delete restrict,
  subject_id text not null references catalog.objects(entity_id) on delete restrict,
  object_id text not null references catalog.objects(entity_id) on delete restrict,
  relationship_domain text not null check (relationship_domain in ('identity', 'family', 'join', 'lineage', 'provenance')),
  relationship_kind text not null check (relationship_kind in ('same_identity_candidate', 'same_identity', 'not_same_identity', 'family_member', 'mirror_of', 'successor_of', 'version_of', 'collection_member', 'join_route', 'distribution_of', 'documents', 'schema_of', 'published_by', 'maintained_by')),
  match_score_micros integer check (match_score_micros between 0 and 1000000),
  epistemic_confidence text not null check (epistemic_confidence in ('unknown', 'low', 'moderate', 'high', 'confirmed')),
  identity_semantics jsonb,
  family_semantics jsonb,
  join_semantics jsonb,
  evidence_ids text[] not null check (cardinality(evidence_ids) > 0),
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  check (
    (relationship_domain = 'identity' and identity_semantics is not null and family_semantics is null and join_semantics is null)
    or (relationship_domain = 'family' and identity_semantics is null and family_semantics is not null and join_semantics is null)
    or (relationship_domain = 'join' and identity_semantics is null and family_semantics is null and join_semantics is not null)
    or (relationship_domain in ('lineage', 'provenance') and identity_semantics is null and family_semantics is null and join_semantics is null)
  ),
  check (relationship_domain <> 'identity' or relationship_kind <> 'same_identity' or identity_semantics->>'state' = 'accepted'),
  check (relationship_domain <> 'join' or relationship_kind = 'join_route'),
  unique (relationship_id, relationship_revision_id)
);

create index relationships_subject_idx on catalog.relationships (subject_id, relationship_domain, relationship_id);
create index relationships_object_idx on catalog.relationships (object_id, relationship_domain, relationship_id);
create index relationships_identity_review_idx on catalog.relationships ((identity_semantics->>'state'), relationship_id)
  where relationship_domain = 'identity';
create index relationships_join_idx on catalog.relationships ((join_semantics->>'compatibility'), relationship_id)
  where relationship_domain = 'join';

create table catalog.temporal_revision_history (
  prior_revision_id text not null references catalog.object_revisions(revision_id) on delete restrict,
  successor_revision_id text not null references catalog.object_revisions(revision_id) on delete restrict,
  entity_id text not null references catalog.objects(entity_id) on delete restrict,
  rationale text not null check (length(rationale) between 1 and 1000),
  superseded_at timestamptz not null,
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  primary key (prior_revision_id, successor_revision_id),
  check (prior_revision_id <> successor_revision_id)
);

create unique index temporal_history_one_successor_idx on catalog.temporal_revision_history (prior_revision_id);
create unique index temporal_history_one_predecessor_idx on catalog.temporal_revision_history (successor_revision_id);
create index temporal_history_entity_idx on catalog.temporal_revision_history (entity_id, superseded_at, successor_revision_id);
create index temporal_history_successor_idx on catalog.temporal_revision_history (successor_revision_id, prior_revision_id);

create function catalog.reject_supersession_cycle()
returns trigger language plpgsql as $function$
declare
  v_prior_entity text;
  v_successor_entity text;
  v_prior_recorded_at timestamptz;
  v_successor_recorded_at timestamptz;
  v_successor_import_id text;
begin
  select entity_id, recorded_at into v_prior_entity, v_prior_recorded_at
  from catalog.object_revisions where revision_id = new.prior_revision_id;
  select entity_id, recorded_at, import_id into v_successor_entity, v_successor_recorded_at, v_successor_import_id
  from catalog.object_revisions where revision_id = new.successor_revision_id;
  if v_prior_entity is null or v_successor_entity is null or v_prior_entity <> v_successor_entity or new.entity_id <> v_prior_entity then
    raise exception using errcode = '23514', message = 'SUPERSESSION_IDENTITY_MISMATCH';
  end if;
  if v_successor_import_id <> new.import_id then
    raise exception using errcode = '23514', message = 'SUPERSESSION_IMPORT_MISMATCH';
  end if;
  if v_successor_recorded_at <= v_prior_recorded_at
     or new.superseded_at < v_successor_recorded_at then
    raise exception using errcode = '23514', message = 'SUPERSESSION_TEMPORAL_ORDER';
  end if;
  if exists (
    with recursive successors(revision_id) as (
      select new.successor_revision_id
      union
      select history.successor_revision_id
      from catalog.temporal_revision_history history
      join successors on history.prior_revision_id = successors.revision_id
    )
    select 1 from successors where revision_id = new.prior_revision_id
  ) then
    raise exception using errcode = '23514', message = 'SUPERSESSION_CYCLE';
  end if;
  return new;
end
$function$;

create trigger temporal_revision_history_reject_cycle
before insert on catalog.temporal_revision_history
for each row execute function catalog.reject_supersession_cycle();

create table catalog.object_revision_selections (
  selection_event_id bigint generated always as identity primary key,
  entity_id text not null references catalog.objects(entity_id) on delete restrict,
  previous_revision_id text references catalog.object_revisions(revision_id) on delete restrict,
  selected_revision_id text not null references catalog.object_revisions(revision_id) on delete restrict,
  action text not null check (action in ('import_initial', 'select', 'revert')),
  reason text not null check (length(reason) between 3 and 1000),
  audit_event_id text not null check (length(audit_event_id) between 3 and 240),
  audit_event_occurred_at timestamptz,
  actor text not null,
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  selected_at timestamptz not null,
  check (previous_revision_id is null or previous_revision_id <> selected_revision_id),
  check ((audit_event_id like 'import:%') = (audit_event_occurred_at is null)),
  foreign key (audit_event_id, audit_event_occurred_at)
    references ops.audit_events(audit_event_id, occurred_at) on delete restrict
);

create index object_revision_selections_entity_idx
  on catalog.object_revision_selections (entity_id, selected_at, selection_event_id);
create index object_revision_selections_previous_idx
  on catalog.object_revision_selections (previous_revision_id)
  where previous_revision_id is not null;
create index object_revision_selections_selected_idx
  on catalog.object_revision_selections (selected_revision_id, selection_event_id);

create table catalog.object_revision_heads (
  entity_id text primary key references catalog.objects(entity_id) on delete restrict,
  selected_revision_id text not null unique references catalog.object_revisions(revision_id) on delete restrict,
  selection_event_id bigint not null unique references catalog.object_revision_selections(selection_event_id) on delete restrict,
  selected_at timestamptz not null
);

create table catalog.object_revision_unavailability_events (
  unavailability_event_id bigint generated always as identity primary key,
  entity_id text not null references catalog.objects(entity_id) on delete restrict,
  selected_revision_id text not null references catalog.object_revisions(revision_id) on delete restrict,
  reason text not null check (reason = 'rejected_import_no_eligible_predecessor'),
  rejected_import_id text not null references catalog.import_batches(import_id) on delete restrict,
  audit_event_id text not null check (length(audit_event_id) between 3 and 240),
  audit_event_occurred_at timestamptz not null,
  actor text not null,
  recorded_at timestamptz not null,
  foreign key (audit_event_id, audit_event_occurred_at)
    references ops.audit_events(audit_event_id, occurred_at) on delete restrict
);

create index object_revision_unavailability_entity_idx
  on catalog.object_revision_unavailability_events (entity_id, recorded_at desc, unavailability_event_id desc);
create index object_revision_unavailability_revision_idx
  on catalog.object_revision_unavailability_events (selected_revision_id, unavailability_event_id);
create index object_revision_unavailability_import_idx
  on catalog.object_revision_unavailability_events (rejected_import_id, unavailability_event_id);

create function catalog.validate_revision_head()
returns trigger language plpgsql as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'revision head deletion is forbidden';
  end if;
  if not exists (
    select 1 from catalog.object_revision_selections selection
    where selection.selection_event_id = new.selection_event_id
      and selection.entity_id = new.entity_id
      and selection.selected_revision_id = new.selected_revision_id
      and selection.selected_at = new.selected_at
  ) then
    raise exception using errcode = '23514', message = 'revision head requires its exact audit event';
  end if;
  if not exists (
    select 1 from catalog.object_revisions revision
    where revision.revision_id = new.selected_revision_id
      and revision.entity_id = new.entity_id
  ) then
    raise exception using errcode = '23514', message = 'REVISION_HEAD_IDENTITY_MISMATCH';
  end if;
  return new;
end
$function$;

create trigger object_revision_heads_validate
before insert or update or delete on catalog.object_revision_heads
for each row execute function catalog.validate_revision_head();

create function catalog.revision_has_typed_projection(p_revision_id text, p_entity_type text)
returns boolean
language sql
stable
strict
set search_path = pg_catalog, catalog
as $function$
  select case p_entity_type
    when 'Organization' then true
    when 'Source' then true
    when 'Asset' then exists (select 1 from catalog.assets where asset_revision_id = p_revision_id)
    when 'Release' then exists (select 1 from catalog.releases where release_revision_id = p_revision_id)
    when 'Distribution' then exists (select 1 from catalog.distributions where distribution_revision_id = p_revision_id)
    when 'Documentation' then exists (select 1 from catalog.documentation where documentation_revision_id = p_revision_id)
    when 'SchemaSnapshot' then exists (select 1 from catalog.schema_snapshots where schema_snapshot_revision_id = p_revision_id)
    when 'SchemaField' then exists (select 1 from catalog.schema_fields where schema_field_revision_id = p_revision_id)
    when 'AccessRoute' then exists (select 1 from catalog.access_routes where access_route_revision_id = p_revision_id)
    when 'AccessObservation' then exists (select 1 from catalog.access_observations where observation_revision_id = p_revision_id)
    when 'Evidence' then exists (select 1 from catalog.evidence where evidence_revision_id = p_revision_id)
    when 'Assertion' then exists (select 1 from catalog.assertions where assertion_revision_id = p_revision_id)
    when 'Relationship' then exists (select 1 from catalog.relationships where relationship_revision_id = p_revision_id)
    else false
  end;
$function$;

-- Enumerate every logical catalog dependency carried by a canonical revision.
-- Evidence derivation parents are intentionally excluded because those IDs bind
-- immutable lineage anchors rather than catalog objects.  This function is used
-- by rejection to prove that an eligible selected head cannot retain a dangling
-- reference after an older import is made ineligible.
create function catalog.revision_dependency_entity_ids(p_payload jsonb)
returns table(entity_id text)
language sql
immutable
strict
set search_path = pg_catalog, catalog
as $function$
  with dependencies(entity_id) as (
    select reference.value->>'evidence_id'
    from jsonb_array_elements(coalesce(p_payload->'evidence_refs', '[]'::jsonb)) as reference(value)
    union all
    select assertion_id.value
    from jsonb_array_elements_text(coalesce(p_payload->'assertion_refs', '[]'::jsonb)) as assertion_id(value)
    union all
    select native_identifier.value->>'source_id'
    from jsonb_array_elements(coalesce(p_payload->'native_identifiers', '[]'::jsonb)) as native_identifier(value)
    union all
    select evidence_id.value
    from jsonb_array_elements(coalesce(p_payload->'native_identifiers', '[]'::jsonb)) as native_identifier(value)
    cross join lateral jsonb_array_elements_text(
      coalesce(native_identifier.value->'evidence_ids', '[]'::jsonb)
    ) as evidence_id(value)
    union all
    select parent_id.value
    from jsonb_array_elements_text(
      coalesce(p_payload->'lineage'->'derivation_parent_ids', '[]'::jsonb)
    ) as parent_id(value)
    where p_payload->>'entity_type' <> 'Evidence'
    union all select p_payload->>'operator_organization_id' where p_payload->>'entity_type' = 'Source'
    union all select p_payload->>'source_id' where p_payload->>'entity_type' in ('Asset', 'Evidence')
    union all select p_payload->>'responsible_organization_id' where p_payload->>'entity_type' = 'Asset'
    union all select p_payload->>'asset_id' where p_payload->>'entity_type' = 'Release'
    union all select p_payload->>'release_id' where p_payload->>'entity_type' in ('Distribution', 'SchemaSnapshot')
    union all select p_payload->>'subject_id' where p_payload->>'entity_type' in ('Documentation', 'Assertion', 'Relationship')
    union all select p_payload->>'object_id' where p_payload->>'entity_type' = 'Relationship'
    union all select p_payload->>'distribution_id' where p_payload->>'entity_type' in ('SchemaSnapshot', 'AccessRoute')
    union all select p_payload->>'schema_snapshot_id' where p_payload->>'entity_type' = 'SchemaField'
    union all select p_payload->>'access_route_id' where p_payload->>'entity_type' = 'AccessObservation'
    union all
    select access_route_id.value
    from jsonb_array_elements_text(coalesce(p_payload->'access_route_ids', '[]'::jsonb)) as access_route_id(value)
    where p_payload->>'entity_type' = 'Distribution'
    union all
    select field_id.value
    from jsonb_array_elements_text(coalesce(p_payload->'field_ids', '[]'::jsonb)) as field_id(value)
    where p_payload->>'entity_type' = 'SchemaSnapshot'
    union all
    select evidence_id.value
    from jsonb_array_elements_text(
      coalesce(p_payload->'machine_readiness'->'evidence_ids', '[]'::jsonb)
    ) as evidence_id(value)
    where p_payload->>'entity_type' = 'Distribution'
    union all
    select evidence_id.value
    from jsonb_array_elements(coalesce(p_payload->'requirements', '[]'::jsonb)) as requirement(value)
    cross join lateral jsonb_array_elements_text(
      coalesce(requirement.value->'evidence_ids', '[]'::jsonb)
    ) as evidence_id(value)
    where p_payload->>'entity_type' = 'AccessRoute'
    union all
    select p_payload->'join_semantics'->>'source_field_id'
    where p_payload->>'entity_type' = 'Relationship' and p_payload->>'relationship_domain' = 'join'
    union all
    select p_payload->'join_semantics'->>'target_field_id'
    where p_payload->>'entity_type' = 'Relationship' and p_payload->>'relationship_domain' = 'join'
    union all
    select evidence_id.value
    from jsonb_array_elements(
      coalesce(p_payload->'join_semantics'->'requirements', '[]'::jsonb)
    ) as requirement(value)
    cross join lateral jsonb_array_elements_text(
      coalesce(requirement.value->'evidence_ids', '[]'::jsonb)
    ) as evidence_id(value)
    where p_payload->>'entity_type' = 'Relationship' and p_payload->>'relationship_domain' = 'join'
    union all
    select evidence_id.value
    from jsonb_array_elements(
      coalesce(p_payload->'join_semantics'->'blockers', '[]'::jsonb)
    ) as blocker(value)
    cross join lateral jsonb_array_elements_text(
      coalesce(blocker.value->'evidence_ids', '[]'::jsonb)
    ) as evidence_id(value)
    where p_payload->>'entity_type' = 'Relationship' and p_payload->>'relationship_domain' = 'join'
  )
  select distinct dependencies.entity_id
  from dependencies
  where dependencies.entity_id is not null and length(dependencies.entity_id) > 0;
$function$;

create function catalog.select_object_revision(
  p_entity_id text,
  p_revision_id text,
  p_action text,
  p_reason text,
  p_audit_event_id text,
  p_import_id text,
  p_selected_at timestamptz default clock_timestamp()
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, catalog
as $function$
declare
  v_current text;
  v_current_selected_at timestamptz;
  v_event_id bigint;
  v_revision_import_id text;
  v_revision_recorded_at timestamptz;
  v_revision_entity_type text;
  v_batch_state text;
  v_projection_eligible boolean;
  v_audit_event_occurred_at timestamptz;
  v_audit_event_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('ushso-catalog-revision-head-ledger-v1', 0));
  if p_action not in ('import_initial', 'select', 'revert')
     or length(trim(p_reason)) < 3 or length(trim(p_audit_event_id)) < 3 then
    raise exception using errcode = '22023', message = 'invalid revision selection request';
  end if;
  select import_id, recorded_at, entity_type
  into v_revision_import_id, v_revision_recorded_at, v_revision_entity_type
  from catalog.object_revisions
  where revision_id = p_revision_id and entity_id = p_entity_id;
  if not found then
    raise exception using errcode = '23503', message = 'selected revision does not belong to entity';
  end if;
  if v_revision_import_id <> p_import_id then
    raise exception using errcode = '23514', message = 'REVISION_SELECTION_IMPORT_MISMATCH';
  end if;
  if p_selected_at < v_revision_recorded_at then
    raise exception using errcode = '23514', message = 'REVISION_SELECTION_BEFORE_REVISION';
  end if;
  if not catalog.revision_has_typed_projection(p_revision_id, v_revision_entity_type) then
    raise exception using errcode = '23514', message = 'REVISION_TYPED_PROJECTION_MISSING';
  end if;
  select state, projection_eligible into v_batch_state, v_projection_eligible
  from catalog.import_batches where import_id = p_import_id for update;
  if not found or v_batch_state = 'rejected' then
    raise exception using errcode = '55000', message = 'REVISION_BATCH_INELIGIBLE';
  end if;
  if v_batch_state = 'prepared' then
    if session_user <> 'ushso_normalize'
       and not pg_has_role(session_user, 'ushso_maintenance', 'MEMBER')
       or p_action not in ('import_initial', 'select')
       or p_audit_event_id <> format('import:%s', p_import_id) then
      raise exception using errcode = '42501', message = 'PREPARED_REVISION_SELECTION_FORBIDDEN';
    end if;
  elsif v_batch_state <> 'applied' or not v_projection_eligible then
    raise exception using errcode = '55000', message = 'REVISION_BATCH_INELIGIBLE';
  else
    select count(*), min(audit.occurred_at)
    into v_audit_event_count, v_audit_event_occurred_at
    from ops.audit_events audit where audit.audit_event_id = p_audit_event_id;
    if v_audit_event_count <> 1 or not exists (
      select 1 from ops.audit_events audit
      where audit.audit_event_id = p_audit_event_id
      and audit.occurred_at = v_audit_event_occurred_at
      and audit.object_type = 'catalog_entity'
      and audit.object_id = p_entity_id
      and audit.action = case when p_action = 'revert' then 'rollback' else 'promote' end
      and audit.decision in ('allowed', 'completed')
      and audit.details->>'import_id' = p_import_id
      and audit.details->>'selected_revision_id' = p_revision_id
      and audit.occurred_at <= p_selected_at
    ) then
      raise exception using errcode = '42501', message = 'REVISION_SELECTION_AUDIT_MISMATCH';
    end if;
  end if;
  select selected_revision_id, selected_at into v_current, v_current_selected_at
  from catalog.object_revision_heads where entity_id = p_entity_id for update;
  if found and v_current = p_revision_id then
    raise exception using errcode = '55000', message = 'REVISION_ALREADY_SELECTED';
  end if;
  if v_current is null and p_action <> 'import_initial' then
    raise exception using errcode = '23514', message = 'first revision selection must be import_initial';
  end if;
  if v_current is not null and p_action = 'import_initial' then
    raise exception using errcode = '23514', message = 'import_initial cannot replace an existing head';
  end if;
  if v_current is not null and p_selected_at <= v_current_selected_at then
    raise exception using errcode = '23514', message = 'REVISION_SELECTION_TIME_NOT_MONOTONIC';
  end if;
  if p_action = 'select' and not exists (
    select 1 from catalog.temporal_revision_history
    where prior_revision_id = v_current and successor_revision_id = p_revision_id and entity_id = p_entity_id
  ) then
    raise exception using errcode = '23514', message = 'revision selection requires an exact forward supersession edge';
  end if;
  if p_action = 'revert' and not exists (
    select 1 from catalog.temporal_revision_history
    where prior_revision_id = p_revision_id and successor_revision_id = v_current and entity_id = p_entity_id
  ) then
    raise exception using errcode = '23514', message = 'revision revert requires the exact prior supersession edge';
  end if;
  insert into catalog.object_revision_selections
    (entity_id, previous_revision_id, selected_revision_id, action, reason,
     audit_event_id, audit_event_occurred_at, actor, import_id, selected_at)
  values (p_entity_id, v_current, p_revision_id, p_action, p_reason,
          p_audit_event_id, v_audit_event_occurred_at, session_user, p_import_id, p_selected_at)
  returning selection_event_id into v_event_id;
  insert into catalog.object_revision_heads
    (entity_id, selected_revision_id, selection_event_id, selected_at)
  values (p_entity_id, p_revision_id, v_event_id, p_selected_at)
  on conflict (entity_id) do update
    set selected_revision_id = excluded.selected_revision_id,
        selection_event_id = excluded.selection_event_id,
        selected_at = excluded.selected_at;
  return v_event_id;
end
$function$;

create view catalog.selected_object_revisions as
select revision.*
from catalog.object_revision_heads head
join catalog.object_revisions revision on revision.revision_id = head.selected_revision_id
join catalog.import_batches batch on batch.import_id = revision.import_id
where batch.state = 'applied' and batch.projection_eligible;

create view catalog.object_revision_selection_status as
select head.entity_id, head.selected_revision_id, revision.import_id,
       case when batch.state = 'applied' and batch.projection_eligible
            then 'selected_eligible' else 'no_eligible_head' end as selection_state,
       head.selection_event_id, head.selected_at,
       unavailable.unavailability_event_id,
       unavailable.rejected_import_id,
       unavailable.audit_event_id as unavailability_audit_event_id
from catalog.object_revision_heads head
join catalog.object_revisions revision on revision.revision_id = head.selected_revision_id
join catalog.import_batches batch on batch.import_id = revision.import_id
left join lateral (
  select event.unavailability_event_id, event.rejected_import_id, event.audit_event_id
  from catalog.object_revision_unavailability_events event
  where event.entity_id = head.entity_id
    and event.selected_revision_id = head.selected_revision_id
  order by event.recorded_at desc, event.unavailability_event_id desc
  limit 1
) unavailable on true;

create table catalog.legacy_import_mappings (
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  legacy_kind text not null check (legacy_kind in ('record', 'join_route')),
  legacy_id text not null check (length(legacy_id) between 1 and 240),
  legacy_fingerprint text not null check (legacy_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  disposition text not null check (disposition in ('accepted', 'rejected')),
  rejection_code text,
  mapping_payload jsonb not null check (jsonb_typeof(mapping_payload) = 'object'),
  recorded_at timestamptz not null,
  primary key (import_id, legacy_kind, legacy_id),
  check ((disposition = 'rejected') = (rejection_code is not null)),
  check (rejection_code is null or rejection_code ~ '^[A-Z][A-Z0-9_]{2,79}$')
);

create index legacy_import_mappings_disposition_idx
  on catalog.legacy_import_mappings (import_id, legacy_kind, disposition, legacy_id);

create table catalog.legacy_v1_corpus (
  import_id text primary key references catalog.import_batches(import_id) on delete restrict,
  corpus_payload jsonb not null check (jsonb_typeof(corpus_payload) = 'object'),
  payload_fingerprint text not null check (payload_fingerprint ~ '^sha256:[a-f0-9]{64}$')
);

create table catalog.legacy_v1_records (
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  ordinal integer not null check (ordinal > 0),
  record_id text not null check (length(record_id) between 1 and 240),
  record_payload jsonb not null check (jsonb_typeof(record_payload) = 'object'),
  payload_fingerprint text not null check (payload_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  primary key (import_id, record_id),
  unique (import_id, ordinal)
);

create table catalog.legacy_v1_search_documents (
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  ordinal integer not null check (ordinal > 0),
  search_document_id text not null check (length(search_document_id) between 1 and 300),
  resource_record_id text not null check (length(resource_record_id) between 1 and 240),
  search_document_payload jsonb not null check (jsonb_typeof(search_document_payload) = 'object'),
  payload_fingerprint text not null check (payload_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  primary key (import_id, search_document_id),
  unique (import_id, ordinal),
  foreign key (import_id, resource_record_id) references catalog.legacy_v1_records(import_id, record_id) on delete restrict
);

create index legacy_v1_search_documents_resource_idx
  on catalog.legacy_v1_search_documents (import_id, resource_record_id, search_document_id);

create table catalog.legacy_v1_join_routes (
  import_id text not null references catalog.import_batches(import_id) on delete restrict,
  ordinal integer not null check (ordinal > 0),
  route_id text not null check (length(route_id) between 1 and 240),
  from_record_id text not null check (length(from_record_id) between 1 and 240),
  to_record_id text not null check (length(to_record_id) between 1 and 240),
  join_route_payload jsonb not null check (jsonb_typeof(join_route_payload) = 'object'),
  payload_fingerprint text not null check (payload_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  primary key (import_id, route_id),
  unique (import_id, ordinal),
  foreign key (import_id, from_record_id) references catalog.legacy_v1_records(import_id, record_id) on delete restrict,
  foreign key (import_id, to_record_id) references catalog.legacy_v1_records(import_id, record_id) on delete restrict
);

create index legacy_v1_join_routes_from_idx on catalog.legacy_v1_join_routes (import_id, from_record_id, route_id);
create index legacy_v1_join_routes_to_idx on catalog.legacy_v1_join_routes (import_id, to_record_id, route_id);

create trigger assertions_append_only before update or delete on catalog.assertions
for each statement execute function ops.reject_history_mutation();
create trigger relationships_append_only before update or delete on catalog.relationships
for each statement execute function ops.reject_history_mutation();
create trigger temporal_revision_history_append_only before update or delete on catalog.temporal_revision_history
for each statement execute function ops.reject_history_mutation();
create trigger object_revision_selections_append_only before update or delete on catalog.object_revision_selections
for each statement execute function ops.reject_history_mutation();
create trigger object_revision_unavailability_events_append_only before update or delete on catalog.object_revision_unavailability_events
for each statement execute function ops.reject_history_mutation();
create trigger legacy_import_mappings_append_only before update or delete on catalog.legacy_import_mappings
for each statement execute function ops.reject_history_mutation();
create trigger legacy_v1_corpus_append_only before update or delete on catalog.legacy_v1_corpus
for each statement execute function ops.reject_history_mutation();
create trigger legacy_v1_records_append_only before update or delete on catalog.legacy_v1_records
for each statement execute function ops.reject_history_mutation();
create trigger legacy_v1_search_documents_append_only before update or delete on catalog.legacy_v1_search_documents
for each statement execute function ops.reject_history_mutation();
create trigger legacy_v1_join_routes_append_only before update or delete on catalog.legacy_v1_join_routes
for each statement execute function ops.reject_history_mutation();

create function catalog.require_entity_reference(
  p_entity_id text,
  p_allowed_types text[],
  p_import_id text,
  p_path text
)
returns void
language plpgsql
stable
set search_path = pg_catalog, catalog
as $function$
declare
  v_type text;
begin
  select entity_type into v_type from catalog.objects where entity_id = p_entity_id;
  if not found then
    raise exception using errcode = '23503', message = format('REFERENCE_MISSING:%s:%s', p_path, p_entity_id);
  end if;
  if not (v_type = any(p_allowed_types)) then
    raise exception using errcode = '23514', message = format(
      'REFERENCE_TYPE_MISMATCH:%s:%s:%s', p_path, v_type, array_to_string(p_allowed_types, '|')
    );
  end if;
  if not exists (
    select 1 from catalog.object_revisions revision
    where revision.entity_id = p_entity_id and revision.import_id = p_import_id
  ) and not exists (
    select 1
    from catalog.object_revision_heads head
    join catalog.object_revisions revision on revision.revision_id = head.selected_revision_id
    join catalog.import_batches batch on batch.import_id = revision.import_id
    where head.entity_id = p_entity_id and batch.state = 'applied' and batch.projection_eligible
  ) then
    raise exception using errcode = '23514', message = format('REFERENCE_INELIGIBLE:%s:%s', p_path, p_entity_id);
  end if;
end
$function$;

create function catalog.require_evidence_references(
  p_ids text[],
  p_import_id text,
  p_path text
)
returns void
language plpgsql
stable
set search_path = pg_catalog, catalog
as $function$
declare
  v_id text;
begin
  foreach v_id in array p_ids loop
    perform catalog.require_entity_reference(v_id, array['Evidence'], p_import_id, p_path);
  end loop;
end
$function$;

-- This validator is the shared database truth boundary for the import
-- function and DB adversarial tests.  It mirrors the core v2 compatible-type
-- map and rejects every logical array reference before typed rows are written.
create function catalog.validate_normalization_bundle(p_bundle jsonb, p_import_id text)
returns void
language plpgsql
stable
set search_path = pg_catalog, catalog
as $function$
declare
  v_collection text;
  v_expected_type text;
  v_id_field text;
  v_row jsonb;
  v_ref jsonb;
  v_id text;
  v_allowed_subject_types constant text[] := array[
    'Organization', 'Source', 'Asset', 'Release', 'Distribution',
    'Documentation', 'SchemaSnapshot', 'SchemaField', 'AccessRoute'
  ];
  v_all_entity_types constant text[] := array[
    'Organization', 'Source', 'Asset', 'Release', 'Distribution',
    'Documentation', 'SchemaSnapshot', 'SchemaField', 'AccessRoute',
    'AccessObservation', 'Evidence', 'Assertion', 'Relationship'
  ];
begin
  foreach v_collection in array array[
    'organizations', 'sources', 'assets', 'releases', 'distributions',
    'documentation', 'schema_snapshots', 'schema_fields', 'access_routes',
    'access_observations', 'evidence', 'assertions', 'relationships'
  ] loop
    select expected_type, id_field into v_expected_type, v_id_field
    from (values
      ('organizations', 'Organization', 'organization_id'),
      ('sources', 'Source', 'source_id'),
      ('assets', 'Asset', 'asset_id'),
      ('releases', 'Release', 'release_id'),
      ('distributions', 'Distribution', 'distribution_id'),
      ('documentation', 'Documentation', 'documentation_id'),
      ('schema_snapshots', 'SchemaSnapshot', 'schema_snapshot_id'),
      ('schema_fields', 'SchemaField', 'schema_field_id'),
      ('access_routes', 'AccessRoute', 'access_route_id'),
      ('access_observations', 'AccessObservation', 'observation_id'),
      ('evidence', 'Evidence', 'evidence_id'),
      ('assertions', 'Assertion', 'assertion_id'),
      ('relationships', 'Relationship', 'relationship_id')
    ) mapping(collection_name, expected_type, id_field)
    where collection_name = v_collection;

    if jsonb_typeof(p_bundle->v_collection) <> 'array' then
      raise exception using errcode = '22023', message = format('CANONICAL_COLLECTION_MISSING:%s', v_collection);
    end if;
    for v_row in select value from jsonb_array_elements(p_bundle->v_collection) loop
      if v_row->>'entity_type' <> v_expected_type then
        raise exception using errcode = '23514', message = format(
          'COLLECTION_TYPE_MISMATCH:%s:%s', v_collection, coalesce(v_row->>'entity_type', 'null')
        );
      end if;
      if v_row->>v_id_field is distinct from v_row->>'entity_id' then
        raise exception using errcode = '23514', message = format('ENTITY_ID_ALIAS_MISMATCH:%s', v_collection);
      end if;
      if v_row->'lineage'->>'import_id' is distinct from p_import_id then
        raise exception using errcode = '23514', message = format('LINEAGE_IMPORT_MISMATCH:%s', v_collection);
      end if;
      if catalog.content_fingerprint(v_row - 'canonical_content_fingerprint')
         is distinct from v_row->>'canonical_content_fingerprint' then
        raise exception using errcode = '23514', message = format('CONTENT_FINGERPRINT_MISMATCH:%s', v_row->>'revision_id');
      end if;
      if jsonb_array_length(coalesce(v_row->'history'->'supersedes_revision_ids', '[]'::jsonb)) > 1 then
        raise exception using errcode = '23514', message = 'DB_LINEAR_HISTORY_MULTIPLE_PREDECESSORS';
      end if;
      perform catalog.require_entity_reference(v_row->>'entity_id', array[v_expected_type], p_import_id, v_collection || '.entity_id');

      for v_ref in select value from jsonb_array_elements(coalesce(v_row->'evidence_refs', '[]'::jsonb)) loop
        perform catalog.require_entity_reference(v_ref->>'evidence_id', array['Evidence'], p_import_id, v_collection || '.evidence_refs');
      end loop;
      for v_ref in select value from jsonb_array_elements(coalesce(v_row->'native_identifiers', '[]'::jsonb)) loop
        perform catalog.require_entity_reference(v_ref->>'source_id', array['Source'], p_import_id, v_collection || '.native_identifiers.source_id');
        perform catalog.require_evidence_references(
          array(select value from jsonb_array_elements_text(coalesce(v_ref->'evidence_ids', '[]'::jsonb))),
          p_import_id, v_collection || '.native_identifiers.evidence_ids'
        );
      end loop;
      for v_id in select value from jsonb_array_elements_text(coalesce(v_row->'assertion_refs', '[]'::jsonb)) loop
        perform catalog.require_entity_reference(v_id, array['Assertion'], p_import_id, v_collection || '.assertion_refs');
      end loop;

      if v_expected_type = 'Evidence' then
        for v_id in select value from jsonb_array_elements_text(coalesce(v_row->'lineage'->'derivation_parent_ids', '[]'::jsonb)) loop
          if not exists (select 1 from catalog.lineage_anchors where anchor_id = v_id) then
            raise exception using errcode = '23503', message = format('EVIDENCE_DERIVATION_PARENT_MISSING:%s', v_id);
          end if;
        end loop;
      else
        for v_id in select value from jsonb_array_elements_text(coalesce(v_row->'lineage'->'derivation_parent_ids', '[]'::jsonb)) loop
          perform catalog.require_entity_reference(v_id, v_all_entity_types, p_import_id, v_collection || '.lineage.derivation_parent_ids');
        end loop;
      end if;

      case v_expected_type
        when 'Source' then
          perform catalog.require_entity_reference(v_row->>'operator_organization_id', array['Organization'], p_import_id, 'sources.operator_organization_id');
        when 'Asset' then
          perform catalog.require_entity_reference(v_row->>'source_id', array['Source'], p_import_id, 'assets.source_id');
          perform catalog.require_entity_reference(v_row->>'responsible_organization_id', array['Organization'], p_import_id, 'assets.responsible_organization_id');
        when 'Release' then
          perform catalog.require_entity_reference(v_row->>'asset_id', array['Asset'], p_import_id, 'releases.asset_id');
        when 'Distribution' then
          perform catalog.require_entity_reference(v_row->>'release_id', array['Release'], p_import_id, 'distributions.release_id');
          for v_id in select value from jsonb_array_elements_text(v_row->'access_route_ids') loop
            perform catalog.require_entity_reference(v_id, array['AccessRoute'], p_import_id, 'distributions.access_route_ids');
          end loop;
          perform catalog.require_evidence_references(
            array(select value from jsonb_array_elements_text(coalesce(v_row->'machine_readiness'->'evidence_ids', '[]'::jsonb))),
            p_import_id, 'distributions.machine_readiness.evidence_ids'
          );
        when 'Documentation' then
          perform catalog.require_entity_reference(v_row->>'subject_id', array['Source','Asset','Release','Distribution','SchemaSnapshot','AccessRoute'], p_import_id, 'documentation.subject_id');
        when 'SchemaSnapshot' then
          perform catalog.require_entity_reference(v_row->>'release_id', array['Release'], p_import_id, 'schema_snapshots.release_id');
          perform catalog.require_entity_reference(v_row->>'distribution_id', array['Distribution'], p_import_id, 'schema_snapshots.distribution_id');
          for v_id in select value from jsonb_array_elements_text(v_row->'field_ids') loop
            perform catalog.require_entity_reference(v_id, array['SchemaField'], p_import_id, 'schema_snapshots.field_ids');
          end loop;
        when 'SchemaField' then
          perform catalog.require_entity_reference(v_row->>'schema_snapshot_id', array['SchemaSnapshot'], p_import_id, 'schema_fields.schema_snapshot_id');
        when 'AccessRoute' then
          perform catalog.require_entity_reference(v_row->>'distribution_id', array['Distribution'], p_import_id, 'access_routes.distribution_id');
          for v_ref in select value from jsonb_array_elements(v_row->'requirements') loop
            perform catalog.require_evidence_references(
              array(select value from jsonb_array_elements_text(coalesce(v_ref->'evidence_ids', '[]'::jsonb))),
              p_import_id, 'access_routes.requirements.evidence_ids'
            );
          end loop;
        when 'AccessObservation' then
          perform catalog.require_entity_reference(v_row->>'access_route_id', array['AccessRoute'], p_import_id, 'access_observations.access_route_id');
        when 'Evidence' then
          perform catalog.require_entity_reference(v_row->>'source_id', array['Source'], p_import_id, 'evidence.source_id');
        when 'Assertion' then
          perform catalog.require_entity_reference(v_row->>'subject_id', v_allowed_subject_types, p_import_id, 'assertions.subject_id');
        when 'Relationship' then
          perform catalog.require_entity_reference(v_row->>'subject_id', v_allowed_subject_types, p_import_id, 'relationships.subject_id');
          perform catalog.require_entity_reference(v_row->>'object_id', v_allowed_subject_types, p_import_id, 'relationships.object_id');
          if v_row->>'relationship_domain' = 'join' then
            perform catalog.require_entity_reference(v_row->'join_semantics'->>'source_field_id', array['SchemaField'], p_import_id, 'relationships.join_semantics.source_field_id');
            perform catalog.require_entity_reference(v_row->'join_semantics'->>'target_field_id', array['SchemaField'], p_import_id, 'relationships.join_semantics.target_field_id');
            for v_ref in
              select value
              from jsonb_array_elements(coalesce(v_row->'join_semantics'->'requirements', '[]'::jsonb))
            loop
              perform catalog.require_evidence_references(
                array(select value from jsonb_array_elements_text(coalesce(v_ref->'evidence_ids', '[]'::jsonb))),
                p_import_id, 'relationships.join_semantics.requirements.evidence_ids'
              );
            end loop;
            for v_ref in
              select value
              from jsonb_array_elements(coalesce(v_row->'join_semantics'->'blockers', '[]'::jsonb))
            loop
              perform catalog.require_evidence_references(
                array(select value from jsonb_array_elements_text(coalesce(v_ref->'evidence_ids', '[]'::jsonb))),
                p_import_id, 'relationships.join_semantics.blockers.evidence_ids'
              );
            end loop;
            if v_row->>'subject_id' is distinct from v_row->'join_semantics'->>'source_field_id'
               or v_row->>'object_id' is distinct from v_row->'join_semantics'->>'target_field_id' then
              raise exception using errcode = '23514', message = 'JOIN_FIELD_REFERENCE_MISMATCH';
            end if;
          end if;
        else null;
      end case;
    end loop;
  end loop;
end
$function$;

create function catalog.bundle_row(
  p_bundle jsonb,
  p_collection text,
  p_id_field text,
  p_id text
)
returns jsonb
language sql
immutable
strict
set search_path = pg_catalog, catalog
as $function$
  select row.value
  from jsonb_array_elements(p_bundle->p_collection) row
  where row.value->>p_id_field = p_id
  limit 1;
$function$;

create function catalog.validate_import_mapping_reconciliation(p_plan jsonb, p_bundle jsonb)
returns void
language plpgsql
set search_path = pg_catalog, catalog
as $function$
declare
  v_mapping jsonb;
  v_ids jsonb;
  v_legacy_id text;
  v_evidence_id text;
  v_relationship_id text;
  v_organization jsonb;
  v_source jsonb;
  v_asset jsonb;
  v_release jsonb;
  v_distribution jsonb;
  v_documentation jsonb;
  v_route jsonb;
  v_observation jsonb;
  v_assertion jsonb;
  v_relationship jsonb;
  v_mapping_field text;
begin
  foreach v_mapping_field in array array[
    'source_id', 'asset_id', 'release_id', 'distribution_id',
    'documentation_id', 'access_route_id', 'observation_id', 'assertion_id'
  ] loop
    if exists (
      select 1
      from jsonb_array_elements(p_plan->'record_mappings') mapping
      group by mapping.value->'canonical_ids'->>v_mapping_field
      having count(*) <> 1
    ) then
      raise exception using errcode = '23514', message = format('RECORD_MAPPING_TARGET_REUSED:%s', v_mapping_field);
    end if;
  end loop;

  for v_mapping in select value from jsonb_array_elements(p_plan->'record_mappings') loop
    v_legacy_id := v_mapping->>'legacy_record_id';
    v_ids := v_mapping->'canonical_ids';
    if v_mapping->>'disposition' <> 'accepted' then
      raise exception using errcode = '23514', message = format('RECORD_MAPPING_NOT_ACCEPTED:%s', v_legacy_id);
    end if;
    v_organization := catalog.bundle_row(p_bundle, 'organizations', 'organization_id', v_ids->>'organization_id');
    v_source := catalog.bundle_row(p_bundle, 'sources', 'source_id', v_ids->>'source_id');
    v_asset := catalog.bundle_row(p_bundle, 'assets', 'asset_id', v_ids->>'asset_id');
    v_release := catalog.bundle_row(p_bundle, 'releases', 'release_id', v_ids->>'release_id');
    v_distribution := catalog.bundle_row(p_bundle, 'distributions', 'distribution_id', v_ids->>'distribution_id');
    v_documentation := catalog.bundle_row(p_bundle, 'documentation', 'documentation_id', v_ids->>'documentation_id');
    v_route := catalog.bundle_row(p_bundle, 'access_routes', 'access_route_id', v_ids->>'access_route_id');
    v_observation := catalog.bundle_row(p_bundle, 'access_observations', 'observation_id', v_ids->>'observation_id');
    v_assertion := catalog.bundle_row(p_bundle, 'assertions', 'assertion_id', v_ids->>'assertion_id');
    if v_organization is null or v_source is null or v_asset is null or v_release is null
       or v_distribution is null or v_documentation is null or v_route is null
       or v_observation is null or v_assertion is null then
      raise exception using errcode = '23503', message = format('RECORD_MAPPING_TARGET_MISSING:%s', v_legacy_id);
    end if;
    if v_asset->>'source_id' is distinct from v_ids->>'source_id'
       or v_asset->>'responsible_organization_id' is distinct from v_ids->>'organization_id'
       or not (v_asset->'legacy_aliases' ? v_legacy_id)
       or not (v_source->'legacy_aliases' ? (v_legacy_id || '#source'))
       or v_release->>'asset_id' is distinct from v_ids->>'asset_id'
       or v_distribution->>'release_id' is distinct from v_ids->>'release_id'
       or v_documentation->>'subject_id' is distinct from v_ids->>'asset_id'
       or v_route->>'distribution_id' is distinct from v_ids->>'distribution_id'
       or v_observation->>'access_route_id' is distinct from v_ids->>'access_route_id'
       or v_assertion->>'subject_id' is distinct from v_ids->>'asset_id' then
      raise exception using errcode = '23514', message = format('RECORD_MAPPING_GRAPH_MISMATCH:%s', v_legacy_id);
    end if;
    for v_evidence_id in select value from jsonb_array_elements_text(v_mapping->'evidence_ids') loop
      if catalog.bundle_row(p_bundle, 'evidence', 'evidence_id', v_evidence_id) is null
         or not exists (
           select 1 from jsonb_array_elements(v_asset->'evidence_refs') reference
           where reference.value->>'evidence_id' = v_evidence_id
         ) then
        raise exception using errcode = '23503', message = format('RECORD_MAPPING_EVIDENCE_MISMATCH:%s:%s', v_legacy_id, v_evidence_id);
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_plan->'join_route_mappings') mapping,
         lateral jsonb_array_elements_text(mapping.value->'relationship_ids') relationship_id
    group by relationship_id.value
    having count(*) <> 1
  ) then
    raise exception using errcode = '23514', message = 'ROUTE_MAPPING_TARGET_REUSED';
  end if;
  for v_mapping in select value from jsonb_array_elements(p_plan->'join_route_mappings') loop
    v_legacy_id := v_mapping->>'legacy_route_id';
    if v_mapping->>'disposition' <> 'accepted'
       or jsonb_array_length(v_mapping->'relationship_ids') = 0 then
      raise exception using errcode = '23514', message = format('ROUTE_MAPPING_NOT_ACCEPTED:%s', v_legacy_id);
    end if;
    for v_relationship_id in select value from jsonb_array_elements_text(v_mapping->'relationship_ids') loop
      v_relationship := catalog.bundle_row(p_bundle, 'relationships', 'relationship_id', v_relationship_id);
      if v_relationship is null or v_relationship->>'relationship_domain' <> 'join'
         or not (v_relationship->'legacy_aliases' ? v_legacy_id)
         or catalog.bundle_row(p_bundle, 'schema_fields', 'schema_field_id', v_relationship->>'subject_id') is null
         or catalog.bundle_row(p_bundle, 'schema_fields', 'schema_field_id', v_relationship->>'object_id') is null then
        raise exception using errcode = '23514', message = format('ROUTE_MAPPING_TARGET_MISMATCH:%s:%s', v_legacy_id, v_relationship_id);
      end if;
    end loop;
  end loop;
end
$function$;

-- Defense in depth for maintenance SQL: typed projections must bind their
-- revision to the exact entity/type/import and every duplicated logical
-- reference must remain compatible.  Worker roles have no direct INSERT, but
-- owner-side mistakes still fail closed.
create function catalog.validate_typed_catalog_row()
returns trigger
language plpgsql
set search_path = pg_catalog, catalog
as $function$
declare
  v_payload jsonb := to_jsonb(new);
  v_revision_id text := v_payload->>tg_argv[0];
  v_entity_id text := v_payload->>tg_argv[1];
  v_expected_type text := tg_argv[2];
  v_import_id text := v_payload->>'import_id';
  v_revision_entity_id text;
  v_revision_type text;
  v_revision_import_id text;
  v_index integer := 3;
  v_id text;
  v_ref jsonb;
begin
  select entity_id, entity_type, import_id
  into v_revision_entity_id, v_revision_type, v_revision_import_id
  from catalog.object_revisions where revision_id = v_revision_id;
  if not found or v_revision_entity_id is distinct from v_entity_id
     or not (v_revision_type = any(string_to_array(v_expected_type, '|')))
     or v_revision_import_id is distinct from v_import_id then
    raise exception using errcode = '23514', message = format('TYPED_REVISION_MISMATCH:%s', tg_table_name);
  end if;
  while v_index + 1 < tg_nargs loop
    perform catalog.require_entity_reference(
      v_payload->>tg_argv[v_index], string_to_array(tg_argv[v_index + 1], '|'),
      v_import_id, tg_table_name || '.' || tg_argv[v_index]
    );
    v_index := v_index + 2;
  end loop;

  if tg_table_name = 'native_identifiers' then
    perform catalog.require_evidence_references(
      array(select value from jsonb_array_elements_text(v_payload->'evidence_ids')),
      v_import_id, 'native_identifiers.evidence_ids'
    );
  elsif tg_table_name = 'evidence' then
    for v_id in select value from jsonb_array_elements_text(v_payload->'derivation_parent_ids') loop
      if not exists (select 1 from catalog.lineage_anchors where anchor_id = v_id) then
        raise exception using errcode = '23503', message = format('EVIDENCE_DERIVATION_PARENT_MISSING:%s', v_id);
      end if;
    end loop;
  elsif tg_table_name = 'distributions' then
    for v_id in select value from jsonb_array_elements_text(v_payload->'access_route_ids') loop
      perform catalog.require_entity_reference(v_id, array['AccessRoute'], v_import_id, 'distributions.access_route_ids');
    end loop;
    perform catalog.require_evidence_references(
      array(select value from jsonb_array_elements_text(coalesce(v_payload->'machine_readiness'->'evidence_ids', '[]'::jsonb))),
      v_import_id, 'distributions.machine_readiness.evidence_ids'
    );
  elsif tg_table_name = 'schema_snapshots' then
    for v_id in select value from jsonb_array_elements_text(v_payload->'field_ids') loop
      perform catalog.require_entity_reference(v_id, array['SchemaField'], v_import_id, 'schema_snapshots.field_ids');
    end loop;
  elsif tg_table_name = 'access_routes' then
    for v_ref in select value from jsonb_array_elements(v_payload->'requirements') loop
      perform catalog.require_evidence_references(
        array(select value from jsonb_array_elements_text(coalesce(v_ref->'evidence_ids', '[]'::jsonb))),
        v_import_id, 'access_routes.requirements.evidence_ids'
      );
    end loop;
  elsif tg_table_name in ('assertions', 'relationships') then
    perform catalog.require_evidence_references(
      array(select value from jsonb_array_elements_text(v_payload->'evidence_ids')),
      v_import_id, tg_table_name || '.evidence_ids'
    );
    if tg_table_name = 'relationships' and v_payload->>'relationship_domain' = 'join' then
      perform catalog.require_entity_reference(v_payload->'join_semantics'->>'source_field_id', array['SchemaField'], v_import_id, 'relationships.join_semantics.source_field_id');
      perform catalog.require_entity_reference(v_payload->'join_semantics'->>'target_field_id', array['SchemaField'], v_import_id, 'relationships.join_semantics.target_field_id');
      for v_ref in
        select value
        from jsonb_array_elements(coalesce(v_payload->'join_semantics'->'requirements', '[]'::jsonb))
      loop
        perform catalog.require_evidence_references(
          array(select value from jsonb_array_elements_text(coalesce(v_ref->'evidence_ids', '[]'::jsonb))),
          v_import_id, 'relationships.join_semantics.requirements.evidence_ids'
        );
      end loop;
      for v_ref in
        select value
        from jsonb_array_elements(coalesce(v_payload->'join_semantics'->'blockers', '[]'::jsonb))
      loop
        perform catalog.require_evidence_references(
          array(select value from jsonb_array_elements_text(coalesce(v_ref->'evidence_ids', '[]'::jsonb))),
          v_import_id, 'relationships.join_semantics.blockers.evidence_ids'
        );
      end loop;
      if v_payload->>'subject_id' is distinct from v_payload->'join_semantics'->>'source_field_id'
         or v_payload->>'object_id' is distinct from v_payload->'join_semantics'->>'target_field_id' then
        raise exception using errcode = '23514', message = 'JOIN_FIELD_REFERENCE_MISMATCH';
      end if;
    end if;
  end if;
  return new;
end
$function$;

create trigger native_identifiers_typed_refs before insert on catalog.native_identifiers
for each row execute function catalog.validate_typed_catalog_row(
  'revision_id', 'entity_id', 'Organization|Source|Asset|Release|Distribution|Documentation|SchemaSnapshot|SchemaField|AccessRoute|AccessObservation|Evidence|Assertion|Relationship',
  'source_id', 'Source'
);
create trigger evidence_typed_refs before insert on catalog.evidence
for each row execute function catalog.validate_typed_catalog_row(
  'evidence_revision_id', 'evidence_id', 'Evidence', 'source_id', 'Source'
);
create trigger assets_typed_refs before insert on catalog.assets
for each row execute function catalog.validate_typed_catalog_row(
  'asset_revision_id', 'asset_id', 'Asset', 'source_id', 'Source', 'responsible_organization_id', 'Organization'
);
create trigger releases_typed_refs before insert on catalog.releases
for each row execute function catalog.validate_typed_catalog_row(
  'release_revision_id', 'release_id', 'Release', 'asset_id', 'Asset'
);
create trigger distributions_typed_refs before insert on catalog.distributions
for each row execute function catalog.validate_typed_catalog_row(
  'distribution_revision_id', 'distribution_id', 'Distribution', 'release_id', 'Release'
);
create trigger documentation_typed_refs before insert on catalog.documentation
for each row execute function catalog.validate_typed_catalog_row(
  'documentation_revision_id', 'documentation_id', 'Documentation',
  'subject_id', 'Source|Asset|Release|Distribution|SchemaSnapshot|AccessRoute'
);
create trigger schema_snapshots_typed_refs before insert on catalog.schema_snapshots
for each row execute function catalog.validate_typed_catalog_row(
  'schema_snapshot_revision_id', 'schema_snapshot_id', 'SchemaSnapshot',
  'release_id', 'Release', 'distribution_id', 'Distribution'
);
create trigger schema_fields_typed_refs before insert on catalog.schema_fields
for each row execute function catalog.validate_typed_catalog_row(
  'schema_field_revision_id', 'schema_field_id', 'SchemaField', 'schema_snapshot_id', 'SchemaSnapshot'
);
create trigger access_routes_typed_refs before insert on catalog.access_routes
for each row execute function catalog.validate_typed_catalog_row(
  'access_route_revision_id', 'access_route_id', 'AccessRoute', 'distribution_id', 'Distribution'
);
create trigger access_observations_typed_refs before insert on catalog.access_observations
for each row execute function catalog.validate_typed_catalog_row(
  'observation_revision_id', 'observation_id', 'AccessObservation', 'access_route_id', 'AccessRoute'
);
create trigger assertions_typed_refs before insert on catalog.assertions
for each row execute function catalog.validate_typed_catalog_row(
  'assertion_revision_id', 'assertion_id', 'Assertion',
  'subject_id', 'Organization|Source|Asset|Release|Distribution|Documentation|SchemaSnapshot|SchemaField|AccessRoute'
);
create trigger relationships_typed_refs before insert on catalog.relationships
for each row execute function catalog.validate_typed_catalog_row(
  'relationship_revision_id', 'relationship_id', 'Relationship',
  'subject_id', 'Organization|Source|Asset|Release|Distribution|Documentation|SchemaSnapshot|SchemaField|AccessRoute',
  'object_id', 'Organization|Source|Asset|Release|Distribution|Documentation|SchemaSnapshot|SchemaField|AccessRoute'
);

create view catalog.legacy_v1_eligible_imports as
select import_id, source_corpus_version, source_content_fingerprint,
       document_fingerprint, applied_at
from catalog.import_batches
where state = 'applied' and projection_eligible;

create function catalog.require_normalization_environment_fence(
  p_environment text,
  p_deployment_fingerprint text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, catalog
as $function$
begin
  if p_environment not in ('local', 'staging', 'production')
     or p_deployment_fingerprint !~ '^[a-f0-9]{64}$'
     or not exists (
       select 1
       from ops.environment_fence fence
       where fence.singleton
         and fence.environment = p_environment
         and fence.deployment_fingerprint = p_deployment_fingerprint
     ) then
    raise exception using errcode = '42501', message = 'NORMALIZATION_ENVIRONMENT_FENCE_MISMATCH';
  end if;
end
$function$;

create function catalog.apply_normalization_import(p_document jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, catalog
set statement_timeout = '60s'
as $function$
declare
  v_import_id text := p_document->>'import_id';
  v_document_fingerprint text := p_document->>'document_fingerprint';
  v_source_fingerprint text := p_document->>'source_content_fingerprint';
  v_plan jsonb := p_document->'plan';
  v_bundle jsonb := p_document->'bundle';
  v_projection jsonb := p_document->'legacy_projection';
  v_collection text;
  v_row jsonb;
  v_native jsonb;
  v_alias text;
  v_prior_id text;
  v_state text;
  v_existing_projection_eligible boolean;
  v_prior_fingerprint text;
  v_added integer;
  v_new_logical_rows integer := 0;
  v_revision_count integer := 0;
  v_record_count integer;
  v_search_count integer;
  v_route_count integer;
  v_actual_canonical_counts jsonb;
  v_expected_fingerprint text;
  v_authority_id text;
  v_import_transaction_at timestamptz := clock_timestamp();
begin
  -- Serialize the entire validation-and-publication transaction with head
  -- selection and rejection.  Acquiring this before any reference eligibility
  -- read prevents a concurrent rollback from invalidating a just-validated
  -- dependency before this import publishes its heads.
  perform pg_advisory_xact_lock(hashtextextended('ushso-catalog-revision-head-ledger-v1', 0));
  if jsonb_typeof(p_document) <> 'object'
     or p_document->>'contract_version' <> 'ushso-normalization-import.v1.0.0'
     or v_import_id !~ '^urn:ushso:import:[A-Za-z0-9._~-]+$'
     or v_document_fingerprint !~ '^sha256:[a-f0-9]{64}$'
     or v_source_fingerprint !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(v_plan) <> 'object'
     or jsonb_typeof(v_bundle) <> 'object'
     or jsonb_typeof(v_projection) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid normalization import envelope';
  end if;

  if catalog.content_fingerprint(jsonb_set(p_document, '{document_fingerprint}', 'null'::jsonb, false))
     <> v_document_fingerprint then
    raise exception using errcode = '23514', message = 'DOCUMENT_FINGERPRINT_MISMATCH';
  end if;
  if catalog.content_fingerprint(v_bundle) <> v_plan->>'bundle_fingerprint' then
    raise exception using errcode = '23514', message = 'BUNDLE_FINGERPRINT_MISMATCH';
  end if;
  if catalog.content_fingerprint(v_projection) <> v_plan->>'projection_fingerprint' then
    raise exception using errcode = '23514', message = 'PROJECTION_FINGERPRINT_MISMATCH';
  end if;
  if v_plan->>'import_id' <> v_import_id
     or v_plan->'source'->>'content_fingerprint_sha256' <> v_source_fingerprint
     or v_plan->'normalizer'->>'deterministic' <> 'true'
     or v_plan->'policy'->>'title_or_url_merge_permitted' <> 'false'
     or v_plan->'policy'->>'destructive_rollback_permitted' <> 'false'
     or v_plan->'policy'->>'source_payloads_acquired' <> 'false'
     or v_plan->'policy'->>'analyses_executed' <> 'false' then
    raise exception using errcode = '22023', message = 'normalization plan violates import safety policy';
  end if;

  v_record_count := jsonb_array_length(v_projection->'records');
  v_search_count := jsonb_array_length(v_projection->'search_documents');
  v_route_count := jsonb_array_length(v_projection->'join_routes');
  v_actual_canonical_counts := jsonb_build_object(
    'organizations', jsonb_array_length(v_bundle->'organizations'),
    'sources', jsonb_array_length(v_bundle->'sources'),
    'assets', jsonb_array_length(v_bundle->'assets'),
    'releases', jsonb_array_length(v_bundle->'releases'),
    'distributions', jsonb_array_length(v_bundle->'distributions'),
    'documentation', jsonb_array_length(v_bundle->'documentation'),
    'schema_snapshots', jsonb_array_length(v_bundle->'schema_snapshots'),
    'schema_fields', jsonb_array_length(v_bundle->'schema_fields'),
    'access_routes', jsonb_array_length(v_bundle->'access_routes'),
    'access_observations', jsonb_array_length(v_bundle->'access_observations'),
    'evidence', jsonb_array_length(v_bundle->'evidence'),
    'assertions', jsonb_array_length(v_bundle->'assertions'),
    'relationships', jsonb_array_length(v_bundle->'relationships')
  );
  if v_record_count <> (v_plan->'expected_counts'->>'legacy_records')::integer
     or v_search_count <> (v_plan->'expected_counts'->>'legacy_search_documents')::integer
     or v_route_count <> (v_plan->'expected_counts'->>'legacy_join_routes')::integer
     or jsonb_array_length(v_plan->'record_mappings') <> v_record_count
     or jsonb_array_length(v_plan->'join_route_mappings') <> v_route_count
     or v_plan->'canonical_counts' is distinct from v_actual_canonical_counts then
    raise exception using errcode = '22023', message = 'normalization import reconciliation count mismatch';
  end if;

  select authority_id into v_authority_id
  from catalog.normalization_import_authorities authority
  where authority.contract_version = p_document->>'contract_version'
    and authority.plan_version = v_plan->>'plan_version'
    and authority.import_id = v_import_id
    and authority.source_corpus_version = v_plan->'source'->>'corpus_version'
    and authority.source_manifest_file_sha256 = v_plan->'source'->>'manifest_file_sha256'
    and authority.source_content_fingerprint = v_source_fingerprint
    and authority.source_records_file_sha256 = v_plan->'source'->>'records_file_sha256'
    and authority.source_search_documents_file_sha256 = v_plan->'source'->>'search_documents_file_sha256'
    and authority.source_join_routes_file_sha256 = v_plan->'source'->>'join_routes_file_sha256'
    and authority.normalizer_name = v_plan->'normalizer'->>'name'
    and authority.normalizer_version = v_plan->'normalizer'->>'version'
    and authority.expected_record_count = v_record_count
    and authority.expected_search_document_count = v_search_count
    and authority.expected_join_route_count = v_route_count
    and authority.expected_canonical_counts = v_actual_canonical_counts
    and authority.bundle_fingerprint = v_plan->>'bundle_fingerprint'
    and authority.projection_fingerprint = v_plan->>'projection_fingerprint'
    and authority.document_fingerprint = v_document_fingerprint
    and authority.canonicalization_version = 'ushso-canonical-json-v1';
  if not found then
    raise exception using errcode = '42501', message = 'NORMALIZATION_IMPORT_NOT_AUTHORIZED';
  end if;

  v_expected_fingerprint := p_document->'projection_row_fingerprints'->>'corpus';
  if v_expected_fingerprint is null
     or catalog.content_fingerprint(v_projection->'corpus') <> v_expected_fingerprint then
    raise exception using errcode = '23514', message = 'PROJECTION_ROW_FINGERPRINT_MISMATCH:corpus';
  end if;
  if (select count(*) from jsonb_object_keys(p_document->'projection_row_fingerprints'->'records')) <> v_record_count
     or (select count(*) from jsonb_object_keys(p_document->'projection_row_fingerprints'->'search_documents')) <> v_search_count
     or (select count(*) from jsonb_object_keys(p_document->'projection_row_fingerprints'->'join_routes')) <> v_route_count then
    raise exception using errcode = '23514', message = 'PROJECTION_ROW_FINGERPRINT_SET_MISMATCH';
  end if;
  for v_row in select value from jsonb_array_elements(v_projection->'records') loop
    v_expected_fingerprint := p_document->'projection_row_fingerprints'->'records'->>(v_row->>'record_id');
    if v_expected_fingerprint is null or catalog.content_fingerprint(v_row) <> v_expected_fingerprint
       or not exists (
         select 1 from jsonb_array_elements(v_plan->'record_mappings') mapping
         where mapping->>'legacy_record_id' = v_row->>'record_id'
           and mapping->>'legacy_record_fingerprint' = v_expected_fingerprint
       ) then
      raise exception using errcode = '23514', message = format('PROJECTION_ROW_FINGERPRINT_MISMATCH:record:%s', v_row->>'record_id');
    end if;
  end loop;
  for v_row in select value from jsonb_array_elements(v_projection->'search_documents') loop
    v_expected_fingerprint := p_document->'projection_row_fingerprints'->'search_documents'->>(v_row->>'search_document_id');
    if v_expected_fingerprint is null or catalog.content_fingerprint(v_row) <> v_expected_fingerprint then
      raise exception using errcode = '23514', message = format('PROJECTION_ROW_FINGERPRINT_MISMATCH:search:%s', v_row->>'search_document_id');
    end if;
  end loop;
  for v_row in select value from jsonb_array_elements(v_projection->'join_routes') loop
    v_expected_fingerprint := p_document->'projection_row_fingerprints'->'join_routes'->>(v_row->>'route_id');
    if v_expected_fingerprint is null or catalog.content_fingerprint(v_row) <> v_expected_fingerprint
       or not exists (
         select 1 from jsonb_array_elements(v_plan->'join_route_mappings') mapping
         where mapping->>'legacy_route_id' = v_row->>'route_id'
           and mapping->>'legacy_route_fingerprint' = v_expected_fingerprint
       ) then
      raise exception using errcode = '23514', message = format('PROJECTION_ROW_FINGERPRINT_MISMATCH:join:%s', v_row->>'route_id');
    end if;
  end loop;

  select state, document_fingerprint, projection_eligible
  into v_state, v_prior_fingerprint, v_existing_projection_eligible
  from catalog.import_batches where import_id = v_import_id for update;
  if found then
    if v_prior_fingerprint <> v_document_fingerprint then
      raise exception using errcode = '23505', message = 'IMPORT_ID_CONTENT_CONFLICT';
    end if;
    if v_state = 'rejected' then
      raise exception using errcode = '55000', message = 'REJECTED_IMPORT_CANNOT_BE_REAPPLIED';
    end if;
    if v_state <> 'applied' or not v_existing_projection_eligible then
      raise exception using errcode = '55000', message = 'INCOMPLETE_IMPORT_REQUIRES_MAINTENANCE_RECOVERY';
    end if;
    return jsonb_build_object(
      'status', 'already_applied', 'import_id', v_import_id,
      'new_logical_rows', 0, 'state', v_state,
      'integrity_authority_id', v_authority_id,
      'database_canonical_hash_verified', true
    );
  end if;

  insert into catalog.import_batches (
    import_id, contract_version, source_corpus_version, source_manifest_file_sha256,
    source_content_fingerprint, document_fingerprint, normalizer_name,
    normalizer_version, state, projection_eligible, plan_payload,
    expected_record_count, expected_search_document_count, expected_join_route_count,
    created_at
  ) values (
    v_import_id, p_document->>'contract_version', v_plan->'source'->>'corpus_version',
    v_plan->'source'->>'manifest_file_sha256', v_source_fingerprint,
    v_document_fingerprint, v_plan->'normalizer'->>'name',
    v_plan->'normalizer'->>'version', 'prepared', false, v_plan,
    v_record_count, v_search_count, v_route_count, v_import_transaction_at
  );
  insert into catalog.import_batch_events
    (import_id, from_state, to_state, reason, audit_event_id, actor, recorded_at)
  values (v_import_id, null, 'prepared', 'deterministic import staged', null, session_user, v_import_transaction_at);

  foreach v_collection in array array[
    'organizations', 'sources', 'assets', 'releases', 'distributions',
    'documentation', 'schema_snapshots', 'schema_fields', 'access_routes',
    'access_observations', 'evidence', 'assertions', 'relationships'
  ] loop
    if jsonb_typeof(v_bundle->v_collection) <> 'array' then
      raise exception using errcode = '22023', message = format('canonical collection missing: %s', v_collection);
    end if;
    for v_row in select value from jsonb_array_elements(v_bundle->v_collection) loop
      if v_row->>'entity_id' is null or v_row->>'revision_id' is null then
        raise exception using errcode = '22023', message = format('canonical identity missing in %s', v_collection);
      end if;
      insert into catalog.objects (entity_id, entity_type, first_import_id, created_at)
      values (v_row->>'entity_id', v_row->>'entity_type', v_import_id, (v_row->'clocks'->>'recorded_at')::timestamptz)
      on conflict (entity_id) do nothing;
      get diagnostics v_added = row_count;
      v_new_logical_rows := v_new_logical_rows + v_added;
      if not exists (select 1 from catalog.objects where entity_id = v_row->>'entity_id' and entity_type = v_row->>'entity_type') then
        raise exception using errcode = '23505', message = format('ENTITY_TYPE_CONFLICT:%s', v_row->>'entity_id');
      end if;

      insert into catalog.object_revisions (
        revision_id, entity_id, entity_type, contract_version, schema_version,
        lifecycle_state, canonical_content_fingerprint, revision_payload, import_id,
        normalizer_name, normalizer_version, first_seen_at, observed_at, recorded_at,
        publisher_released_at, publisher_modified_at, superseded_at
      ) values (
        v_row->>'revision_id', v_row->>'entity_id', v_row->>'entity_type',
        v_row->>'contract_version', v_row->>'schema_version', v_row->>'lifecycle_state',
        v_row->>'canonical_content_fingerprint', v_row, v_import_id,
        v_row->'lineage'->'normalizer'->>'name', v_row->'lineage'->'normalizer'->>'version',
        (v_row->'clocks'->>'first_seen_at')::timestamptz,
        (v_row->'clocks'->>'observed_at')::timestamptz,
        (v_row->'clocks'->>'recorded_at')::timestamptz,
        (v_row->'clocks'->>'publisher_released_at')::timestamptz,
        (v_row->'clocks'->>'publisher_modified_at')::timestamptz,
        (v_row->'clocks'->>'superseded_at')::timestamptz
      ) on conflict (revision_id) do nothing;
      if not exists (
        select 1 from catalog.object_revisions
        where revision_id = v_row->>'revision_id'
          and entity_id = v_row->>'entity_id'
          and canonical_content_fingerprint = v_row->>'canonical_content_fingerprint'
          and revision_payload = v_row
      ) then
        raise exception using errcode = '23505', message = format('REVISION_CONTENT_CONFLICT:%s', v_row->>'revision_id');
      end if;
      v_revision_count := v_revision_count + 1;

      for v_alias in select value from jsonb_array_elements_text(v_row->'legacy_aliases') loop
        insert into catalog.legacy_aliases (alias, entity_id, first_import_id, permanent, recorded_at)
        values (v_alias, v_row->>'entity_id', v_import_id, true, (v_row->'clocks'->>'recorded_at')::timestamptz)
        on conflict (alias) do nothing;
        if not exists (select 1 from catalog.legacy_aliases where alias = v_alias and entity_id = v_row->>'entity_id') then
          raise exception using errcode = '23505', message = format('LEGACY_ALIAS_CONFLICT:%s', v_alias);
        end if;
      end loop;

    end loop;
  end loop;

  -- Materialize only identifier-level lineage anchors that are provably
  -- derived from provenance IDs in the fingerprint-bound projection.
  for v_row in
    select provenance.value
    from jsonb_array_elements(v_projection->'records') record,
         lateral jsonb_array_elements(coalesce(record.value->'provenance', '[]'::jsonb)) provenance
  loop
    insert into catalog.lineage_anchors (
      anchor_id, anchor_type, source_reference, first_import_id, recorded_at, payload_included
    ) values (
      catalog.normalization_opaque_id('capture-reference', 'legacy-provenance:' || (v_row->>'provenance_id')),
      'legacy_provenance_reference', v_row->>'provenance_id', v_import_id,
      v_import_transaction_at, false
    ) on conflict (anchor_id) do nothing;
    if not exists (
      select 1 from catalog.lineage_anchors
      where anchor_id = catalog.normalization_opaque_id('capture-reference', 'legacy-provenance:' || (v_row->>'provenance_id'))
        and anchor_type = 'legacy_provenance_reference'
        and source_reference = v_row->>'provenance_id'
    ) then
      raise exception using errcode = '23505', message = 'LINEAGE_ANCHOR_CONFLICT';
    end if;
  end loop;

  perform catalog.validate_normalization_bundle(v_bundle, v_import_id);
  perform catalog.validate_import_mapping_reconciliation(v_plan, v_bundle);

  -- Identifiers and history are a second pass because the common envelope
  -- permits source/organization cycles and arbitrary revision ordering. Every
  -- referenced object/revision is present before restrictive FKs are checked.
  foreach v_collection in array array[
    'organizations', 'sources', 'assets', 'releases', 'distributions',
    'documentation', 'schema_snapshots', 'schema_fields', 'access_routes',
    'access_observations', 'evidence', 'assertions', 'relationships'
  ] loop
    for v_row in select value from jsonb_array_elements(v_bundle->v_collection) loop
      for v_native in select value from jsonb_array_elements(v_row->'native_identifiers') loop
        insert into catalog.native_identifiers (
          revision_id, entity_id, source_id, namespace, exact_value, normalized_value,
          case_behavior, preservation, entity_scope, authority, uniqueness_policy,
          effective_from, effective_to, evidence_ids, import_id, recorded_at
        ) values (
          v_row->>'revision_id', v_row->>'entity_id', v_native->>'source_id',
          v_native->>'namespace', v_native->>'value', v_native->>'normalized_value',
          v_native->>'case_behavior', v_native->>'preservation', v_native->>'entity_scope',
          v_native->>'authority', v_native->>'uniqueness_policy',
          (v_native->>'effective_from')::date, (v_native->>'effective_to')::date,
          array(select value from jsonb_array_elements_text(v_native->'evidence_ids')),
          v_import_id, (v_row->'clocks'->>'recorded_at')::timestamptz
        ) on conflict do nothing;
      end loop;
      for v_prior_id in select value from jsonb_array_elements_text(v_row->'history'->'supersedes_revision_ids') loop
        insert into catalog.temporal_revision_history
          (prior_revision_id, successor_revision_id, entity_id, rationale, superseded_at, import_id)
        select v_prior_id, v_row->>'revision_id', v_row->>'entity_id',
          v_row->'history'->>'rationale',
          coalesce((prior.revision_payload->'clocks'->>'superseded_at')::timestamptz,
                   (v_row->'clocks'->>'recorded_at')::timestamptz),
          v_import_id
        from catalog.object_revisions prior
        where prior.revision_id = v_prior_id;
        if not found then
          raise exception using errcode = '23503', message = format('SUPERSESSION_REFERENCE_MISSING:%s', v_prior_id);
        end if;
      end loop;
    end loop;
  end loop;

  insert into catalog.evidence (
    evidence_revision_id, evidence_id, source_id, evidence_class, locator,
    captured_content_digest, media_type, availability_state, description,
    payload_included, derivation_parent_ids, import_id, recorded_at
  ) select
    row->>'revision_id', row->>'evidence_id', row->>'source_id', row->>'evidence_class',
    row->>'locator', row->>'captured_content_digest', row->>'media_type',
    row->>'availability_state', row->>'description', (row->>'payload_included')::boolean,
    array(select value from jsonb_array_elements_text(row->'lineage'->'derivation_parent_ids')),
    v_import_id, (row->'clocks'->>'recorded_at')::timestamptz
  from jsonb_array_elements(v_bundle->'evidence') row;

  insert into catalog.assets
  select row->>'revision_id', row->>'asset_id', row->>'source_id', row->>'responsible_organization_id',
    row->>'title', row->>'asset_kind', row->>'summary', row->>'identity_resolution_state',
    row->>'family_resolution_state', v_import_id
  from jsonb_array_elements(v_bundle->'assets') row;

  insert into catalog.releases
  select row->>'revision_id', row->>'release_id', row->>'asset_id', row->>'release_label',
    row->>'release_kind', row->>'publisher_version', row->>'cadence', (row->>'immutable')::boolean,
    row->'coverage_intervals', v_import_id
  from jsonb_array_elements(v_bundle->'releases') row;

  insert into catalog.distributions
  select row->>'revision_id', row->>'distribution_id', row->>'release_id', row->>'title',
    row->>'distribution_kind', row->>'format', row->>'media_type',
    array(select value from jsonb_array_elements_text(row->'access_route_ids')),
    row->'machine_readiness', v_import_id
  from jsonb_array_elements(v_bundle->'distributions') row;

  insert into catalog.documentation
  select row->>'revision_id', row->>'documentation_id', row->>'subject_id',
    row->>'documentation_type', row->>'title', row->>'locator', v_import_id
  from jsonb_array_elements(v_bundle->'documentation') row;

  insert into catalog.schema_snapshots
  select row->>'revision_id', row->>'schema_snapshot_id', row->>'release_id',
    row->>'distribution_id', row->>'schema_digest',
    array(select value from jsonb_array_elements_text(row->'field_ids')),
    (row->>'immutable')::boolean, v_import_id
  from jsonb_array_elements(v_bundle->'schema_snapshots') row;

  insert into catalog.schema_fields
  select row->>'revision_id', row->>'schema_field_id', row->>'schema_snapshot_id',
    row->>'source_name', (row->>'ordinal')::integer, row->>'source_data_type',
    row->>'description', row->>'identifier_namespace', row->>'field_role', v_import_id
  from jsonb_array_elements(v_bundle->'schema_fields') row;

  insert into catalog.access_routes
  select row->>'revision_id', row->>'access_route_id', row->>'distribution_id',
    row->>'route_kind', row->>'access_class', row->>'locator',
    (row->>'human_authorization_gate')::boolean, row->'requirements', row->'stop_conditions',
    row->>'execution_state', (row->>'access_workflow_submitted')::boolean,
    (row->>'payloads_acquired')::boolean, v_import_id
  from jsonb_array_elements(v_bundle->'access_routes') row;

  insert into catalog.access_observations
  select row->>'revision_id', row->>'observation_id', row->>'access_route_id',
    row->>'catalog_visibility_state', row->>'payload_access_state', row->>'authorization_state',
    row->>'infrastructure_state', row->>'requirement_state', row->>'freshness_state',
    (row->>'stale_at')::timestamptz, row->>'check_method',
    (row->>'access_workflow_submitted')::boolean, (row->>'payloads_acquired')::boolean,
    (row->>'raw_payload_stored')::boolean, (row->'clocks'->>'observed_at')::timestamptz, v_import_id
  from jsonb_array_elements(v_bundle->'access_observations') row;

  insert into catalog.assertions
  select row->>'revision_id', row->>'assertion_id', row->>'subject_id', row->>'predicate',
    row->'claim_value', row->>'claim_class', row->>'epistemic_state',
    (row->>'effective_from')::timestamptz, (row->>'effective_to')::timestamptz,
    array(select ref->>'evidence_id' from jsonb_array_elements(row->'evidence_refs') ref), v_import_id
  from jsonb_array_elements(v_bundle->'assertions') row;

  insert into catalog.relationships
  select row->>'revision_id', row->>'relationship_id', row->>'subject_id', row->>'object_id',
    row->>'relationship_domain', row->>'relationship_kind', (row->>'match_score_micros')::integer,
    row->>'epistemic_confidence', nullif(row->'identity_semantics', 'null'::jsonb),
    nullif(row->'family_semantics', 'null'::jsonb),
    nullif(row->'join_semantics', 'null'::jsonb),
    array(select ref->>'evidence_id' from jsonb_array_elements(row->'evidence_refs') ref), v_import_id
  from jsonb_array_elements(v_bundle->'relationships') row;

  -- A revision becomes selectable only after its type-specific projection is
  -- present. Existing heads require an explicit forward edge.
  foreach v_collection in array array[
    'organizations', 'sources', 'assets', 'releases', 'distributions',
    'documentation', 'schema_snapshots', 'schema_fields', 'access_routes',
    'access_observations', 'evidence', 'assertions', 'relationships'
  ] loop
    for v_row in select value from jsonb_array_elements(v_bundle->v_collection)
      where value->>'lifecycle_state' <> 'superseded'
    loop
      perform catalog.select_object_revision(
        v_row->>'entity_id', v_row->>'revision_id',
        case when exists (select 1 from catalog.object_revision_heads where entity_id = v_row->>'entity_id') then 'select' else 'import_initial' end,
        case when exists (select 1 from catalog.object_revision_heads where entity_id = v_row->>'entity_id') then 'normalizer selected explicit successor' else 'initial deterministic import selection' end,
        format('import:%s', v_import_id), v_import_id,
        v_import_transaction_at
      );
    end loop;
  end loop;

  insert into catalog.legacy_import_mappings
  select v_import_id, 'record', mapping->>'legacy_record_id', mapping->>'legacy_record_fingerprint',
    mapping->>'disposition', mapping->>'rejection_code', mapping,
    v_import_transaction_at
  from jsonb_array_elements(v_plan->'record_mappings') mapping;
  insert into catalog.legacy_import_mappings
  select v_import_id, 'join_route', mapping->>'legacy_route_id', mapping->>'legacy_route_fingerprint',
    mapping->>'disposition', mapping->>'rejection_code', mapping,
    v_import_transaction_at
  from jsonb_array_elements(v_plan->'join_route_mappings') mapping;

  insert into catalog.legacy_v1_corpus
  values (v_import_id, v_projection->'corpus', p_document->'projection_row_fingerprints'->>'corpus');

  insert into catalog.legacy_v1_records
  select v_import_id, ordinality::integer, row->>'record_id', row,
    p_document->'projection_row_fingerprints'->'records'->>(row->>'record_id')
  from jsonb_array_elements(v_projection->'records') with ordinality input(row, ordinality);

  insert into catalog.legacy_v1_search_documents
  select v_import_id, ordinality::integer, row->>'search_document_id', row->>'resource_record_id', row,
    p_document->'projection_row_fingerprints'->'search_documents'->>(row->>'search_document_id')
  from jsonb_array_elements(v_projection->'search_documents') with ordinality input(row, ordinality);

  insert into catalog.legacy_v1_join_routes
  select v_import_id, ordinality::integer, row->>'route_id', row->>'from_record_id', row->>'to_record_id', row,
    p_document->'projection_row_fingerprints'->'join_routes'->>(row->>'route_id')
  from jsonb_array_elements(v_projection->'join_routes') with ordinality input(row, ordinality);

  if (select count(*) from catalog.legacy_import_mappings where import_id = v_import_id and legacy_kind = 'record') <> v_record_count
     or (select count(*) from catalog.legacy_import_mappings where import_id = v_import_id and legacy_kind = 'join_route') <> v_route_count
     or (select count(*) from catalog.legacy_v1_records where import_id = v_import_id) <> v_record_count
     or (select count(*) from catalog.legacy_v1_search_documents where import_id = v_import_id) <> v_search_count
     or (select count(*) from catalog.legacy_v1_join_routes where import_id = v_import_id) <> v_route_count then
    raise exception using errcode = '23514', message = 'post-import reconciliation failed';
  end if;

  update catalog.import_batches
  set state = 'applied', projection_eligible = true,
      canonical_revision_count = v_revision_count,
      applied_at = v_import_transaction_at
  where import_id = v_import_id;
  insert into catalog.import_batch_events
    (import_id, from_state, to_state, reason, audit_event_id, actor, recorded_at)
  values (v_import_id, 'prepared', 'applied', 'atomic canonical and legacy projection import committed', null, session_user, v_import_transaction_at);

  return jsonb_build_object(
    'status', 'applied', 'import_id', v_import_id,
    'new_logical_rows', v_new_logical_rows,
    'canonical_revisions', v_revision_count,
    'records', v_record_count, 'search_documents', v_search_count,
    'join_routes', v_route_count,
    'integrity_authority_id', v_authority_id,
    'database_canonical_hash_verified', true
  );
exception
  when others then
    raise;
end
$function$;

create function catalog.reject_import_batch(
  p_import_id text,
  p_reason text,
  p_audit_event_id text,
  p_recorded_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, catalog
set statement_timeout = '60s'
as $function$
declare
  v_state text;
  v_batch_created_at timestamptz;
  v_batch_applied_at timestamptz;
  v_entities bigint;
  v_revisions bigint;
  v_aliases bigint;
  v_head record;
  v_fallback_revision_id text;
  v_fallback_import_id text;
  v_selection_event_id bigint;
  v_reverted_heads bigint := 0;
  v_no_eligible_heads bigint := 0;
  v_audit_event_occurred_at timestamptz;
  v_audit_event_count integer;
  v_unavailable_entity_ids text[] := array[]::text[];
  v_dependency_violation record;
begin
  perform pg_advisory_xact_lock(hashtextextended('ushso-catalog-revision-head-ledger-v1', 0));
  if length(trim(p_reason)) < 3 or length(trim(p_audit_event_id)) < 3 then
    raise exception using errcode = '22023', message = 'rejection reason and audit event ID are required';
  end if;
  select state, created_at, applied_at into v_state, v_batch_created_at, v_batch_applied_at
  from catalog.import_batches where import_id = p_import_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'IMPORT_BATCH_NOT_FOUND'; end if;
  if v_state = 'rejected' then
    return jsonb_build_object('status', 'already_rejected', 'import_id', p_import_id, 'deleted_rows', 0);
  end if;
  if p_recorded_at < coalesce(v_batch_applied_at, v_batch_created_at) then
    raise exception using errcode = '23514', message = 'IMPORT_REJECTION_TIME_NOT_MONOTONIC';
  end if;
  select count(*), min(audit.occurred_at)
  into v_audit_event_count, v_audit_event_occurred_at
  from ops.audit_events audit where audit.audit_event_id = p_audit_event_id;
  if v_audit_event_count <> 1 or not exists (
    select 1 from ops.audit_events audit
    where audit.audit_event_id = p_audit_event_id
      and audit.occurred_at = v_audit_event_occurred_at
      and audit.action = 'rollback'
      and audit.object_type = 'normalization_import'
      and audit.object_id = p_import_id
      and audit.decision in ('allowed', 'completed')
      and audit.details->>'import_id' = p_import_id
      and audit.occurred_at <= p_recorded_at
  ) then
    raise exception using errcode = '42501', message = 'IMPORT_REJECTION_AUDIT_MISMATCH';
  end if;

  -- Only heads that currently select a revision from this batch are affected.
  -- Walk immutable predecessor edges to the nearest still-eligible ancestor;
  -- later heads from other batches are deliberately untouched.
  for v_head in
    select head.entity_id, head.selected_revision_id
    from catalog.object_revision_heads head
    join catalog.object_revisions revision on revision.revision_id = head.selected_revision_id
    where revision.import_id = p_import_id
    order by head.entity_id
    for update of head
  loop
    if p_recorded_at <= (
      select selected_at from catalog.object_revision_heads where entity_id = v_head.entity_id
    ) then
      raise exception using errcode = '23514', message = 'IMPORT_REJECTION_TIME_NOT_MONOTONIC';
    end if;
    v_fallback_revision_id := null;
    v_fallback_import_id := null;
    with recursive ancestors(revision_id, depth) as (
      select history.prior_revision_id, 1
      from catalog.temporal_revision_history history
      where history.successor_revision_id = v_head.selected_revision_id
      union all
      select history.prior_revision_id, ancestors.depth + 1
      from ancestors
      join catalog.temporal_revision_history history
        on history.successor_revision_id = ancestors.revision_id
    )
    select revision.revision_id, revision.import_id
    into v_fallback_revision_id, v_fallback_import_id
    from ancestors
    join catalog.object_revisions revision on revision.revision_id = ancestors.revision_id
    join catalog.import_batches batch on batch.import_id = revision.import_id
    where batch.state = 'applied' and batch.projection_eligible
      and revision.import_id <> p_import_id
    order by ancestors.depth
    limit 1;

    if v_fallback_revision_id is not null then
      insert into catalog.object_revision_selections (
        entity_id, previous_revision_id, selected_revision_id, action, reason,
        audit_event_id, audit_event_occurred_at, actor, import_id, selected_at
      ) values (
        v_head.entity_id, v_head.selected_revision_id, v_fallback_revision_id,
        'revert', 'automatic fallback from rejected import to nearest eligible immutable predecessor',
        p_audit_event_id, v_audit_event_occurred_at, session_user, v_fallback_import_id, p_recorded_at
      ) returning selection_event_id into v_selection_event_id;
      update catalog.object_revision_heads
      set selected_revision_id = v_fallback_revision_id,
          selection_event_id = v_selection_event_id,
          selected_at = p_recorded_at
      where entity_id = v_head.entity_id;
      v_reverted_heads := v_reverted_heads + 1;
    else
      insert into catalog.object_revision_unavailability_events (
        entity_id, selected_revision_id, reason, rejected_import_id,
        audit_event_id, audit_event_occurred_at, actor, recorded_at
      ) values (
        v_head.entity_id, v_head.selected_revision_id,
        'rejected_import_no_eligible_predecessor', p_import_id,
        p_audit_event_id, v_audit_event_occurred_at, session_user, p_recorded_at
      );
      v_unavailable_entity_ids := array_append(v_unavailable_entity_ids, v_head.entity_id);
      v_no_eligible_heads := v_no_eligible_heads + 1;
    end if;
  end loop;

  -- A batch cannot be rejected if doing so would leave a still-eligible head
  -- pointing at an entity with no eligible revision.  This is deliberately
  -- checked after computing fallback heads but before changing batch state;
  -- any failure rolls back the provisional selection/unavailability events.
  if cardinality(v_unavailable_entity_ids) > 0 then
    select head.entity_id as dependent_entity_id,
           revision.revision_id as dependent_revision_id,
           dependency.entity_id as unavailable_dependency_entity_id
    into v_dependency_violation
    from catalog.object_revision_heads head
    join catalog.object_revisions revision
      on revision.revision_id = head.selected_revision_id
    join catalog.import_batches batch
      on batch.import_id = revision.import_id
    cross join lateral catalog.revision_dependency_entity_ids(revision.revision_payload) dependency
    where revision.import_id <> p_import_id
      and batch.state = 'applied'
      and batch.projection_eligible
      and dependency.entity_id = any(v_unavailable_entity_ids)
    order by head.entity_id, revision.revision_id, dependency.entity_id
    limit 1;
    if found then
      raise exception using
        errcode = '23514',
        message = 'IMPORT_REJECTION_BREAKS_ELIGIBLE_REFERENCE_CLOSURE',
        detail = format(
          'dependent_entity_id=%s dependent_revision_id=%s unavailable_dependency_entity_id=%s',
          v_dependency_violation.dependent_entity_id,
          v_dependency_violation.dependent_revision_id,
          v_dependency_violation.unavailable_dependency_entity_id
        ),
        hint = 'Reject or supersede the dependent import first, or provide an eligible replacement dependency revision.';
    end if;
  end if;

  update catalog.import_batches
  set state = 'rejected', projection_eligible = false, rejected_at = p_recorded_at,
      rejection_reason = p_reason, rejection_audit_event_id = p_audit_event_id,
      rejection_audit_event_occurred_at = v_audit_event_occurred_at
  where import_id = p_import_id;
  insert into catalog.import_batch_events
    (import_id, from_state, to_state, reason, audit_event_id,
     audit_event_occurred_at, actor, recorded_at)
  values (p_import_id, v_state, 'rejected', p_reason, p_audit_event_id,
          v_audit_event_occurred_at, session_user, p_recorded_at);
  select count(*) into v_entities from catalog.objects where first_import_id = p_import_id;
  select count(*) into v_revisions from catalog.object_revisions where import_id = p_import_id;
  select count(*) into v_aliases from catalog.legacy_aliases where first_import_id = p_import_id;
  return jsonb_build_object(
    'status', 'rejected', 'import_id', p_import_id, 'deleted_rows', 0,
    'preserved_entities', v_entities, 'preserved_revisions', v_revisions,
    'preserved_aliases', v_aliases, 'audit_projection_preserved',
    exists(select 1 from catalog.legacy_v1_corpus where import_id = p_import_id),
    'reverted_heads', v_reverted_heads,
    'no_eligible_heads', v_no_eligible_heads
  );
end
$function$;

create function catalog.legacy_v1_projection(p_import_id text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, catalog
as $function$
  select case when batch.state = 'applied' and batch.projection_eligible then
    jsonb_build_object(
      'records', coalesce((select jsonb_agg(record_payload order by ordinal) from catalog.legacy_v1_records where import_id = p_import_id), '[]'::jsonb),
      'search_documents', coalesce((select jsonb_agg(search_document_payload order by ordinal) from catalog.legacy_v1_search_documents where import_id = p_import_id), '[]'::jsonb),
      'join_routes', coalesce((select jsonb_agg(join_route_payload order by ordinal) from catalog.legacy_v1_join_routes where import_id = p_import_id), '[]'::jsonb),
      'corpus', (select corpus_payload from catalog.legacy_v1_corpus where import_id = p_import_id),
      'semantics', jsonb_build_object(
        'stable_public_ids', true,
        'exact_access_states', true,
        'exact_evidence', true,
        'exact_join_routes', true,
        'projection_warnings_preserved', true,
        'zero_results_status', 200,
        'zero_results_absence_claim_permitted', false,
        'zero_results_warning', 'Zero results are not evidence that no source exists.'
      )
    ) else null end
  from catalog.import_batches batch
  where batch.import_id = p_import_id;
$function$;

create function catalog.apply_normalization_import_guarded(
  p_document jsonb,
  p_environment text,
  p_deployment_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, catalog
set statement_timeout = '60s'
as $function$
begin
  perform catalog.require_normalization_environment_fence(p_environment, p_deployment_fingerprint);
  return catalog.apply_normalization_import(p_document);
end
$function$;

create function catalog.reject_import_batch_guarded(
  p_import_id text,
  p_reason text,
  p_audit_event_id text,
  p_recorded_at timestamptz,
  p_environment text,
  p_deployment_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, catalog
set statement_timeout = '60s'
as $function$
begin
  perform catalog.require_normalization_environment_fence(p_environment, p_deployment_fingerprint);
  return catalog.reject_import_batch(p_import_id, p_reason, p_audit_event_id, p_recorded_at);
end
$function$;

revoke all on function catalog.apply_normalization_import(jsonb) from public;
revoke all on function catalog.reject_import_batch(text, text, text, timestamptz) from public;
revoke all on function catalog.apply_normalization_import_guarded(jsonb, text, text) from public;
revoke all on function catalog.reject_import_batch_guarded(text, text, text, timestamptz, text, text) from public;
revoke all on function catalog.require_normalization_environment_fence(text, text) from public;
revoke all on function catalog.legacy_v1_projection(text) from public;
revoke all on function catalog.select_object_revision(text, text, text, text, text, text, timestamptz) from public;

reset role;

grant usage on schema catalog to ushso_normalize, ushso_maintenance;
revoke all on all tables in schema catalog from ushso_projector;
revoke execute on function catalog.reject_import_batch(text, text, text, timestamptz) from ushso_ops;
revoke execute on function catalog.select_object_revision(text, text, text, text, text, text, timestamptz) from ushso_ops;
grant execute on function catalog.apply_normalization_import_guarded(jsonb, text, text) to ushso_normalize, ushso_maintenance;
grant execute on function catalog.reject_import_batch_guarded(text, text, text, timestamptz, text, text) to ushso_maintenance;
grant execute on function catalog.legacy_v1_projection(text) to ushso_projector, ushso_ops;
grant execute on function catalog.select_object_revision(text, text, text, text, text, text, timestamptz) to ushso_maintenance;

grant select on catalog.assertions, catalog.relationships, catalog.temporal_revision_history,
  catalog.object_revision_selections, catalog.object_revision_heads,
  catalog.object_revision_unavailability_events,
  catalog.selected_object_revisions, catalog.object_revision_selection_status,
  catalog.legacy_import_mappings, catalog.legacy_v1_corpus, catalog.legacy_v1_records,
  catalog.legacy_v1_search_documents, catalog.legacy_v1_join_routes,
  catalog.legacy_v1_eligible_imports to ushso_ops;
grant select on catalog.selected_object_revisions,
  catalog.object_revision_selection_status,
  catalog.legacy_v1_eligible_imports to ushso_projector;

revoke all on catalog.assertions, catalog.relationships, catalog.temporal_revision_history,
  catalog.object_revision_selections, catalog.object_revision_heads,
  catalog.object_revision_unavailability_events,
  catalog.legacy_import_mappings, catalog.legacy_v1_corpus, catalog.legacy_v1_records,
  catalog.legacy_v1_search_documents, catalog.legacy_v1_join_routes
  from ushso_public, ushso_scheduler, ushso_harvest;
