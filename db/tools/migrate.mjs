#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, repositoryRoot, requireEnvironmentFence, runPsql, sha256File, verifyManagedAuthorization } from './common.mjs';

export async function applyMigrations(options) {
  const args = options ?? parseArgs();
  const fence = requireEnvironmentFence(args);
  await verifyManagedAuthorization(fence);
  const container = args.container || null;
  const database = args.database || 'ushso';

  const roleSql = await readFile(path.join(repositoryRoot, 'db/bootstrap/roles.sql'), 'utf8');
  runPsql({ container, database, sql: roleSql });

  const bootstrapSql = `
    create table if not exists public.ushso_environment_fence (
      singleton boolean primary key default true check (singleton),
      environment text not null check (environment in ('local','staging','production')),
      deployment_fingerprint text not null check (deployment_fingerprint ~ '^[a-f0-9]{64}$'),
      initialized_at timestamptz not null default clock_timestamp()
    );
    create table if not exists public.ushso_schema_migrations (
      migration_id text primary key,
      byte_sha256 text not null check (byte_sha256 ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz not null,
      applied_by text not null,
      execution_environment text not null
    );
    create table if not exists public.ushso_migration_lock (
      singleton boolean primary key default true check (singleton),
      last_owner text,
      last_acquired_at timestamptz
    );
    insert into public.ushso_migration_lock(singleton) values (true) on conflict do nothing;
    insert into public.ushso_environment_fence(singleton, environment, deployment_fingerprint)
    values (true, '${fence.environment}', '${fence.fingerprint}')
    on conflict (singleton) do nothing;
    do $fence$
    begin
      if not exists (
        select 1 from public.ushso_environment_fence
        where singleton and environment = '${fence.environment}'
          and deployment_fingerprint = '${fence.fingerprint}'
      ) then
        raise exception 'environment fence mismatch';
      end if;
    end
    $fence$;
  `;
  runPsql({ container, database, sql: bootstrapSql });

  const manifestPath = path.join(repositoryRoot, 'db/migrations/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const applied = [];
  const skipped = [];
  for (const migration of manifest.migrations) {
    if (args.through && Number(migration.id) > Number(args.through)) break;
    const filePath = path.join(repositoryRoot, 'db/migrations', migration.file);
    const actualSha = await sha256File(filePath);
    if (actualSha !== migration.byte_sha256) throw new Error(`migration checksum mismatch: ${migration.file}`);
    const prior = runPsql({
      container, database, tuplesOnly: true,
      sql: `select byte_sha256 from public.ushso_schema_migrations where migration_id = '${migration.id}';`,
    }).stdout.trim();
    if (prior) {
      if (prior !== actualSha) throw new Error(`applied migration checksum drift: ${migration.id}`);
      skipped.push(migration.id);
      continue;
    }

    const sql = await readFile(filePath, 'utf8');
    const syncFence = migration.id === '0001' ? `
      insert into ops.environment_fence(singleton, environment, deployment_fingerprint, initialized_at, initialized_by)
      select singleton, environment, deployment_fingerprint, initialized_at, session_user
      from public.ushso_environment_fence
      on conflict (singleton) do nothing;
    ` : '';
    runPsql({
      container,
      database,
      sql: `begin;
        select singleton from public.ushso_migration_lock where singleton for update nowait;
        update public.ushso_migration_lock set last_owner = session_user, last_acquired_at = clock_timestamp() where singleton;
        ${sql}
        ${syncFence}
        insert into public.ushso_schema_migrations(migration_id, byte_sha256, applied_at, applied_by, execution_environment)
        values ('${migration.id}', '${actualSha}', clock_timestamp(), session_user, '${fence.environment}');
        commit;`,
    });
    applied.push(migration.id);
  }

  return {
    environment: fence.environment,
    database,
    applied,
    skipped,
    migration_count: applied.length + skipped.length,
    through: args.through || manifest.migrations.at(-1).id,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  applyMigrations().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
