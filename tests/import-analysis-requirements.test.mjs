import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { importAnalysisRequirements } from '../scripts/import-analysis-requirements.mjs';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(
  new URL('../scripts/import-analysis-requirements.mjs', import.meta.url),
);
const projectRoot = path.resolve(path.dirname(scriptPath), '..');
const upstreamRoot = path.join(
  projectRoot,
  'packages',
  'retrieval',
  'analysis-use',
  'v1.0.0',
  'upstream',
);
const sourceCatalogPath = path.join(upstreamRoot, 'analysis-requirements.v1.0.0.json');
const sourceSchemaPath = path.join(upstreamRoot, 'analysis-requirements.v1.0.0.schema.json');
const catalogRepositoryPath =
  'packages/hc-metrics/src/hc_metrics/data/analysis-requirements.v1.0.0.json';
const schemaRepositoryPath =
  'packages/hc-metrics/src/hc_metrics/schemas/analysis-requirements.v1.0.0.schema.json';
const expectedNames = [
  'analysis-requirements.pin.json',
  'analysis-requirements.v1.0.0.json',
  'analysis-requirements.v1.0.0.schema.json',
];

async function git(repositoryRoot, args) {
  const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8',
  });
  return stdout.trim();
}

async function createFixtureRepository(t, { mutateCatalog, mutateSchema } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ushso-analysis-import-git-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, 'healthcare-toolkit');
  const catalogPath = path.join(repositoryRoot, catalogRepositoryPath);
  const schemaPath = path.join(repositoryRoot, schemaRepositoryPath);
  const catalog = JSON.parse(await fs.readFile(sourceCatalogPath, 'utf8'));
  const schema = JSON.parse(await fs.readFile(sourceSchemaPath, 'utf8'));
  mutateCatalog?.(catalog);
  mutateSchema?.(schema);

  await Promise.all([
    fs.mkdir(path.dirname(catalogPath), { recursive: true }),
    fs.mkdir(path.dirname(schemaPath), { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`),
    fs.writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`),
  ]);
  await fs.mkdir(repositoryRoot, { recursive: true });
  await git(repositoryRoot, ['init', '--quiet']);
  await git(repositoryRoot, ['config', 'user.name', 'USHSO Import Test']);
  await git(repositoryRoot, ['config', 'user.email', 'import-test@ushso.invalid']);
  await git(repositoryRoot, ['config', 'commit.gpgsign', 'false']);
  await git(repositoryRoot, ['add', '--', catalogRepositoryPath, schemaRepositoryPath]);
  await git(repositoryRoot, ['commit', '--quiet', '-m', 'Add analysis requirements fixture']);

  const revision = await git(repositoryRoot, ['rev-parse', 'HEAD']);
  const catalogBlobOid = await git(repositoryRoot, [
    'rev-parse',
    `${revision}:${catalogRepositoryPath}`,
  ]);
  const schemaBlobOid = await git(repositoryRoot, [
    'rev-parse',
    `${revision}:${schemaRepositoryPath}`,
  ]);
  assert.match(revision, /^[0-9a-f]{40}$/);

  return {
    catalogBlobOid,
    catalogPath,
    repositoryRoot,
    revision,
    root,
    schemaBlobOid,
    schemaPath,
  };
}

function runImporter(fixture, outputRoot, options = {}) {
  return importAnalysisRequirements(importerArguments(fixture, outputRoot, options));
}

function importerArguments(fixture, outputRoot, options = {}) {
  return [
    '--catalog',
    options.catalogPath ?? fixture.catalogPath,
    '--schema',
    options.schemaPath ?? fixture.schemaPath,
    '--source-revision',
    options.sourceRevision ?? fixture.revision,
    '--output-root',
    outputRoot,
  ];
}

async function runImporterCli(fixture, outputRoot) {
  const outputPath = path.join(fixture.root, 'cli-output.json');
  const outputHandle = await fs.open(outputPath, 'w');
  const child = spawn(process.execPath, [scriptPath, ...importerArguments(fixture, outputRoot)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'invalid',
      GIT_CONFIG_VALUE_0: 'must-not-reach-git',
      GIT_NO_REPLACE_OBJECTS: '0',
    },
    stdio: ['ignore', outputHandle.fd, 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [status, signal] = await once(child, 'close');
  await outputHandle.close();
  if (status !== 0 || signal) throw new Error(`Importer CLI failed: exit=${status ?? 'null'} signal=${signal ?? 'null'} ${stderr}`);
  return JSON.parse(await fs.readFile(outputPath, 'utf8'));
}

function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedJson(value[key])]),
  );
}

test('publishes canonical committed blobs and exactly reuses the immutable set', async (t) => {
  const fixture = await createFixtureRepository(t);
  const outputRoot = path.join(fixture.root, 'publication', 'upstream');

  const first = await runImporter(fixture, outputRoot);
  assert.equal(first.publication, 'published');
  assert.deepEqual((await fs.readdir(outputRoot)).sort(), expectedNames);
  assert.deepEqual(first.pin.source, {
    catalog_blob_oid: fixture.catalogBlobOid,
    catalog_path: catalogRepositoryPath,
    origin_verified: false,
    project_id: 'ajhcs/healthcare-toolkit',
    revision: fixture.revision,
    schema_blob_oid: fixture.schemaBlobOid,
    schema_path: schemaRepositoryPath,
    tracking_bead: 'healthcare-toolkit-672v',
  });

  const catalogOutput = await fs.readFile(path.join(outputRoot, expectedNames[1]), 'utf8');
  assert.equal(
    catalogOutput,
    `${JSON.stringify(sortedJson(JSON.parse(catalogOutput)), null, 2)}\n`,
  );
  const firstBytes = await Promise.all(
    expectedNames.map((name) => fs.readFile(path.join(outputRoot, name))),
  );

  const second = await runImporter(fixture, outputRoot);
  assert.equal(second.publication, 'reused');
  const secondBytes = await Promise.all(
    expectedNames.map((name) => fs.readFile(path.join(outputRoot, name))),
  );
  secondBytes.forEach((bytes, index) => assert.deepEqual(bytes, firstBytes[index]));
  const stagingEntries = (await fs.readdir(path.dirname(outputRoot))).filter((name) =>
    name.startsWith('.upstream.partial-'),
  );
  assert.deepEqual(stagingEntries, []);
});

test('concurrent publication claims never overwrite or mix immutable bytes', async (t) => {
  const fixture = await createFixtureRepository(t);
  const outputRoot = path.join(fixture.root, 'concurrent', 'upstream');
  const attempts = await Promise.allSettled(
    Array.from({ length: 8 }, () => runImporter(fixture, outputRoot)),
  );
  const fulfilled = attempts.filter((attempt) => attempt.status === 'fulfilled');
  const rejected = attempts.filter((attempt) => attempt.status === 'rejected');

  assert.equal(
    fulfilled.filter((attempt) => attempt.value.publication === 'published').length,
    1,
  );
  assert.ok(
    fulfilled.every((attempt) => ['published', 'reused'].includes(attempt.value.publication)),
  );
  assert.ok(
    rejected.every((attempt) =>
      /partial or mixed|differs from requested bytes/.test(String(attempt.reason?.message))),
  );
  assert.deepEqual((await fs.readdir(outputRoot)).sort(), expectedNames);

  const stableBytes = await Promise.all(
    expectedNames.map((name) => fs.readFile(path.join(outputRoot, name))),
  );
  const reused = await runImporter(fixture, outputRoot);
  assert.equal(reused.publication, 'reused');
  const reusedBytes = await Promise.all(
    expectedNames.map((name) => fs.readFile(path.join(outputRoot, name))),
  );
  reusedBytes.forEach((bytes, index) => assert.deepEqual(bytes, stableBytes[index]));
});

test('refuses a mixed existing publication without overwriting it', async (t) => {
  const fixture = await createFixtureRepository(t);
  const outputRoot = path.join(fixture.root, 'publication', 'upstream');
  await runImporter(fixture, outputRoot);
  const tamperedPath = path.join(outputRoot, 'analysis-requirements.v1.0.0.json');
  await fs.writeFile(tamperedPath, 'tampered\n');

  await assert.rejects(runImporter(fixture, outputRoot), /Immutable publication differs/);
  assert.equal(await fs.readFile(tamperedPath, 'utf8'), 'tampered\n');
  assert.deepEqual((await fs.readdir(outputRoot)).sort(), expectedNames);
});

test('refuses a partial existing publication without filling it in', async (t) => {
  const fixture = await createFixtureRepository(t);
  const outputRoot = path.join(fixture.root, 'partial', 'upstream');
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.writeFile(path.join(outputRoot, 'analysis-requirements.pin.json'), 'partial\n');

  await assert.rejects(runImporter(fixture, outputRoot), /partial or mixed/);
  assert.deepEqual(await fs.readdir(outputRoot), ['analysis-requirements.pin.json']);
  assert.equal(
    await fs.readFile(path.join(outputRoot, 'analysis-requirements.pin.json'), 'utf8'),
    'partial\n',
  );
});

test('rejects malformed and nonexistent commit revisions before publication', async (t) => {
  const fixture = await createFixtureRepository(t);
  const malformedOutput = path.join(fixture.root, 'malformed', 'upstream');
  const nonexistentOutput = path.join(fixture.root, 'nonexistent', 'upstream');

  await assert.rejects(
    runImporter(fixture, malformedOutput, { sourceRevision: 'main@working-tree' }),
    /exact lowercase 40-hex Git commit/,
  );
  await assert.rejects(
    runImporter(fixture, nonexistentOutput, { sourceRevision: 'f'.repeat(40) }),
    /cat-file|could not get object info|Not a valid object/i,
  );
  await assert.rejects(fs.lstat(malformedOutput), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(nonexistentOutput), { code: 'ENOENT' });
});

test('rejects an unsafe authority even when its committed schema permits it', async (t) => {
  const fixture = await createFixtureRepository(t, {
    mutateCatalog(catalog) {
      catalog.authority.calculation_authorized = true;
    },
    mutateSchema(schema) {
      schema.$defs.authority.properties.calculation_authorized.const = true;
    },
  });
  const outputRoot = path.join(fixture.root, 'unsafe', 'upstream');

  await assert.rejects(
    runImporter(fixture, outputRoot),
    /Catalog authority must exactly match the fail-closed authority contract/,
  );
  await assert.rejects(fs.lstat(outputRoot), { code: 'ENOENT' });
});

test('rejects a schema-valid committed catalog with invalid semantic references', async (t) => {
  const fixture = await createFixtureRepository(t, {
    mutateCatalog(catalog) {
      catalog.requirements[0].join_requirements[0].input_ids.pop();
    },
  });
  const outputRoot = path.join(fixture.root, 'semantic-invalid', 'upstream');

  await assert.rejects(
    runImporter(fixture, outputRoot),
    /INCOMPLETE_ANALYSIS_REQUIREMENTS_JOIN_INPUTS/,
  );
  await assert.rejects(fs.lstat(outputRoot), { code: 'ENOENT' });
});

test('enforces both fixed hc-metrics source paths', async (t) => {
  const fixture = await createFixtureRepository(t);
  const wrongCatalogPath = path.join(fixture.repositoryRoot, 'catalog.json');
  const wrongSchemaPath = path.join(fixture.repositoryRoot, 'schema.json');
  await Promise.all([
    fs.copyFile(fixture.catalogPath, wrongCatalogPath),
    fs.copyFile(fixture.schemaPath, wrongSchemaPath),
  ]);

  await assert.rejects(
    runImporter(fixture, path.join(fixture.root, 'wrong-catalog'), {
      catalogPath: wrongCatalogPath,
    }),
    /fixed hc-metrics source paths/,
  );
  await assert.rejects(
    runImporter(fixture, path.join(fixture.root, 'wrong-schema'), {
      schemaPath: wrongSchemaPath,
    }),
    /fixed hc-metrics source paths/,
  );
});

test('reads committed blobs and ignores unsafe uncommitted worktree mutations', async (t) => {
  const fixture = await createFixtureRepository(t);
  const outputRoot = path.join(fixture.root, 'committed-only', 'upstream');
  const worktreeCatalog = JSON.parse(await fs.readFile(fixture.catalogPath, 'utf8'));
  worktreeCatalog.catalog_id = 'uncommitted-worktree-mutation';
  worktreeCatalog.authority.calculation_authorized = true;
  await fs.writeFile(fixture.catalogPath, `${JSON.stringify(worktreeCatalog, null, 2)}\n`);
  assert.match(await git(fixture.repositoryRoot, ['status', '--short']), /^M /m);

  const result = await runImporter(fixture, outputRoot);
  const publishedCatalog = JSON.parse(
    await fs.readFile(path.join(outputRoot, 'analysis-requirements.v1.0.0.json'), 'utf8'),
  );
  assert.equal(result.publication, 'published');
  assert.equal(publishedCatalog.catalog_id, 'hc-metrics:analysis-requirements');
  assert.equal(publishedCatalog.authority.calculation_authorized, false);
  assert.equal(result.pin.source.revision, fixture.revision);
  assert.equal(result.pin.source.catalog_blob_oid, fixture.catalogBlobOid);
  assert.equal(result.pin.source.schema_blob_oid, fixture.schemaBlobOid);
});

test('bypasses Git replacement objects and caller-supplied Git config environment', async (t) => {
  const fixture = await createFixtureRepository(t);
  const outputRoot = path.join(fixture.root, 'replace-bypass', 'upstream');
  const marker = 'REPLACEMENT_OBJECT_MUST_NOT_BE_IMPORTED';
  const replacementCatalog = JSON.parse(await fs.readFile(fixture.catalogPath, 'utf8'));
  replacementCatalog.requirements[0].question_patterns.push(marker);
  await fs.writeFile(fixture.catalogPath, `${JSON.stringify(replacementCatalog, null, 2)}\n`);
  await git(fixture.repositoryRoot, ['add', '--', catalogRepositoryPath]);
  await git(fixture.repositoryRoot, ['commit', '--quiet', '-m', 'Add replacement object payload']);
  const replacementRevision = await git(fixture.repositoryRoot, ['rev-parse', 'HEAD']);
  await git(fixture.repositoryRoot, ['replace', fixture.revision, replacementRevision]);

  const replacedView = JSON.parse(await git(fixture.repositoryRoot, [
    'cat-file',
    'blob',
    `${fixture.revision}:${catalogRepositoryPath}`,
  ]));
  assert.ok(replacedView.requirements[0].question_patterns.includes(marker));

  const result = await runImporterCli(fixture, outputRoot);
  const publishedCatalog = JSON.parse(
    await fs.readFile(path.join(outputRoot, 'analysis-requirements.v1.0.0.json'), 'utf8'),
  );

  assert.equal(result.publication, 'published');
  assert.equal(result.pin.source.revision, fixture.revision);
  assert.equal(result.pin.source.catalog_blob_oid, fixture.catalogBlobOid);
  assert.ok(!publishedCatalog.requirements[0].question_patterns.includes(marker));
});
