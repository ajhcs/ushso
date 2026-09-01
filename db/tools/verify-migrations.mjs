#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, repositoryRoot, runPsql, sha256File } from './common.mjs';

export async function verifyMigrations(options = parseArgs()) {
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'db/migrations/manifest.json'), 'utf8'));
  const files = [];
  for (const migration of manifest.migrations) {
    const actual = await sha256File(path.join(repositoryRoot, 'db/migrations', migration.file));
    if (actual !== migration.byte_sha256) throw new Error(`migration checksum mismatch: ${migration.file}`);
    files.push({ id: migration.id, file: migration.file, byte_sha256: actual });
  }
  if (options.container || process.env.USHSO_MAINTENANCE_DATABASE_URL) {
    const rows = runPsql({
      container: options.container || null,
      database: options.database || 'ushso',
      tuplesOnly: true,
      sql: "select migration_id || ':' || byte_sha256 from public.ushso_schema_migrations order by migration_id;",
    }).stdout.trim().split('\n').filter(Boolean);
    if (rows.length !== files.length) throw new Error('database migration count does not match manifest');
    for (const file of files) if (!rows.includes(`${file.id}:${file.byte_sha256}`)) throw new Error(`database missing exact migration ${file.id}`);
  }
  return { schema_version: manifest.schema_version, status: 'pass', files };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  verifyMigrations().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
