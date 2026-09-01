-- Cluster-level, value-free roles. The six exact Worker roles are LOGIN roles
-- so every Hyperdrive binding has an independently revocable database
-- identity. Password values are provisioned only through the managed secret
-- path and never appear here. Schema owners and the direct-maintenance
-- capability remain NOLOGIN roles.

do $roles$
declare
  role_name text;
begin
  foreach role_name in array array[
    'ushso_registry_owner',
    'ushso_ingest_owner',
    'ushso_catalog_owner',
    'ushso_identity_owner',
    'ushso_search_owner',
    'ushso_ops_owner',
    'ushso_maintenance'
  ] loop
    if not exists (select 1 from pg_roles where rolname = role_name) then
      execute format('create role %I nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls', role_name);
    end if;
  end loop;
  foreach role_name in array array[
    'ushso_public',
    'ushso_scheduler',
    'ushso_harvest',
    'ushso_normalize',
    'ushso_projector',
    'ushso_ops'
  ] loop
    if not exists (select 1 from pg_roles where rolname = role_name) then
      execute format('create role %I login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls', role_name);
    end if;
  end loop;
end
$roles$;

-- Reconciliation repairs privilege-bearing attributes without touching
-- externally managed passwords.
alter role ushso_registry_owner nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role ushso_ingest_owner nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role ushso_catalog_owner nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role ushso_identity_owner nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role ushso_search_owner nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role ushso_ops_owner nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role ushso_maintenance nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;

alter role ushso_public login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role ushso_scheduler login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role ushso_harvest login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role ushso_normalize login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role ushso_projector login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role ushso_ops login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;

grant ushso_registry_owner, ushso_ingest_owner, ushso_catalog_owner,
  ushso_identity_owner, ushso_search_owner, ushso_ops_owner
to ushso_maintenance;

alter role ushso_public set statement_timeout = '2s';
alter role ushso_public set lock_timeout = '500ms';
alter role ushso_public set idle_in_transaction_session_timeout = '3s';

alter role ushso_scheduler set statement_timeout = '5s';
alter role ushso_scheduler set lock_timeout = '1s';
alter role ushso_scheduler set idle_in_transaction_session_timeout = '5s';

alter role ushso_harvest set statement_timeout = '10s';
alter role ushso_harvest set lock_timeout = '1s';
alter role ushso_harvest set idle_in_transaction_session_timeout = '5s';

alter role ushso_normalize set statement_timeout = '10s';
alter role ushso_normalize set lock_timeout = '1s';
alter role ushso_normalize set idle_in_transaction_session_timeout = '5s';

alter role ushso_projector set statement_timeout = '15s';
alter role ushso_projector set lock_timeout = '2s';
alter role ushso_projector set idle_in_transaction_session_timeout = '5s';

alter role ushso_ops set statement_timeout = '15s';
alter role ushso_ops set lock_timeout = '2s';
alter role ushso_ops set idle_in_transaction_session_timeout = '5s';

alter role ushso_maintenance set statement_timeout = '0';
alter role ushso_maintenance set idle_in_transaction_session_timeout = '30s';
