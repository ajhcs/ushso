import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  createAnalysisRequirementsAjv,
  validateAnalysisRequirementsCatalogSemantics,
} from '../packages/retrieval/tools/verified-analysis-requirements.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutputRoot = path.join(
  projectRoot,
  'packages',
  'retrieval',
  'analysis-use',
  'v1.0.0',
  'upstream',
);

const CATALOG_FILE = 'analysis-requirements.v1.0.0.json';
const SCHEMA_FILE = 'analysis-requirements.v1.0.0.schema.json';
const PIN_FILE = 'analysis-requirements.pin.json';
const EXPECTED_SCHEMA_VERSION = 'hc-metrics.analysis-requirements.v1.0.0';
const EXPECTED_SCHEMA_ID =
  'https://contracts.ushso.org/hc-metrics/analysis-requirements/v1.0.0/schema.json';
const FAIL_CLOSED_AUTHORITY = {
  calculation_authorized: false,
  data_access_authorized: false,
  discovery_guidance_only: true,
  persistence_authorized: false,
  publication_authorized: false,
};
const CATALOG_SOURCE_PATH = 'packages/hc-metrics/src/hc_metrics/data/analysis-requirements.v1.0.0.json';
const SCHEMA_SOURCE_PATH = 'packages/hc-metrics/src/hc_metrics/schemas/analysis-requirements.v1.0.0.schema.json';
const execFileAsync = promisify(execFile);

function sanitizedGitEnvironment() {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  environment.GIT_NO_REPLACE_OBJECTS = '1';
  return environment;
}

function parseArgs(argv) {
  const allowed = new Set(['catalog', 'schema', 'source-revision', 'output-root']);
  const values = {};

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`Expected --flag value, received ${flag ?? '<end>'}`);
    }

    const name = flag.slice(2);
    if (!allowed.has(name)) throw new Error(`Unknown option --${name}`);
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate option --${name}`);
    values[name] = value;
  }

  for (const required of ['catalog', 'schema', 'source-revision']) {
    if (!values[required]) throw new Error(`Missing required --${required}`);
  }
  if (!/^[0-9a-f]{40}$/.test(values['source-revision'])) {
    throw new Error('--source-revision must be an exact lowercase 40-hex Git commit');
  }

  const outputRoot = path.resolve(values['output-root'] ?? defaultOutputRoot);
  if (outputRoot === path.parse(outputRoot).root) {
    throw new Error('--output-root must not be a filesystem root');
  }

  return { ...values, outputRoot };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(sortJson(value), null, 2)}\n`, 'utf8');
}

function assertFailClosedAuthority(authority) {
  const actual = JSON.stringify(sortJson(authority));
  const expected = JSON.stringify(sortJson(FAIL_CLOSED_AUTHORITY));
  if (actual !== expected) {
    throw new Error('Catalog authority must exactly match the fail-closed authority contract');
  }
}

async function gitText(repositoryRoot, args) {
  const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8',
    env: sanitizedGitEnvironment(),
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

async function gitBytes(repositoryRoot, args) {
  const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, ...args], {
    encoding: null,
    env: sanitizedGitEnvironment(),
    maxBuffer: 8 * 1024 * 1024,
  });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

function repositoryRelative(repositoryRoot, filePath) {
  return path.relative(repositoryRoot, path.resolve(filePath)).split(path.sep).join('/');
}

async function readCommittedSources(args) {
  const catalogRepository = path.resolve(await gitText(path.dirname(path.resolve(args.catalog)), [
    'rev-parse',
    '--show-toplevel',
  ]));
  const schemaRepository = path.resolve(await gitText(path.dirname(path.resolve(args.schema)), [
    'rev-parse',
    '--show-toplevel',
  ]));
  if (catalogRepository !== schemaRepository) {
    throw new Error('Catalog and schema must resolve inside the same Git repository');
  }
  if (repositoryRelative(catalogRepository, args.catalog) !== CATALOG_SOURCE_PATH
    || repositoryRelative(catalogRepository, args.schema) !== SCHEMA_SOURCE_PATH) {
    throw new Error('Catalog and schema must use the fixed hc-metrics source paths');
  }
  const objectType = await gitText(catalogRepository, ['cat-file', '-t', args['source-revision']]);
  if (objectType !== 'commit') throw new Error('--source-revision must resolve to a Git commit');

  const catalogSpec = `${args['source-revision']}:${CATALOG_SOURCE_PATH}`;
  const schemaSpec = `${args['source-revision']}:${SCHEMA_SOURCE_PATH}`;
  const [catalogBytes, schemaBytes, catalogBlobOid, schemaBlobOid] = await Promise.all([
    gitBytes(catalogRepository, ['cat-file', 'blob', catalogSpec]),
    gitBytes(catalogRepository, ['cat-file', 'blob', schemaSpec]),
    gitText(catalogRepository, ['rev-parse', catalogSpec]),
    gitText(catalogRepository, ['rev-parse', schemaSpec]),
  ]);
  return {
    catalogBlobOid,
    catalogBytes,
    schemaBlobOid,
    schemaBytes,
  };
}

async function inspectExistingPublication(outputRoot, expectedFiles) {
  let stat;
  try {
    stat = await fs.lstat(outputRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }

  if (!stat.isDirectory()) {
    throw new Error(`Immutable publication target exists but is not a directory: ${outputRoot}`);
  }

  const entries = await fs.readdir(outputRoot, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  const expectedNames = [...expectedFiles.keys()].sort();
  if (
    names.length !== expectedNames.length
    || names.some((name, index) => name !== expectedNames[index])
    || entries.some((entry) => !entry.isFile())
  ) {
    throw new Error(
      `Immutable publication target is partial or mixed; expected exactly ${expectedNames.join(', ')}`,
    );
  }

  for (const name of expectedNames) {
    const actual = await fs.readFile(path.join(outputRoot, name));
    if (!actual.equals(expectedFiles.get(name))) {
      throw new Error(`Immutable publication differs from requested bytes: ${name}`);
    }
  }

  return true;
}

async function publishImmutableDirectory(outputRoot, expectedFiles) {
  if (await inspectExistingPublication(outputRoot, expectedFiles)) return 'reused';

  const parent = path.dirname(outputRoot);
  await fs.mkdir(parent, { recursive: true });
  try {
    await fs.mkdir(outputRoot);
  } catch (error) {
    if (error?.code === 'EEXIST' && await inspectExistingPublication(outputRoot, expectedFiles)) {
      return 'reused';
    }
    throw error;
  }
  const written = [];
  let verified = false;

  try {
    for (const [name, bytes] of expectedFiles) {
      await fs.writeFile(path.join(outputRoot, name), bytes, { flag: 'wx' });
      written.push(name);
    }
    await inspectExistingPublication(outputRoot, expectedFiles);
    verified = true;
    return 'published';
  } finally {
    if (!verified) {
      for (const name of written.reverse()) {
        await fs.unlink(path.join(outputRoot, name)).catch(() => {});
      }
      await fs.rmdir(outputRoot).catch(() => {});
    }
  }
}

export async function importAnalysisRequirements(argv) {
  const args = parseArgs(argv);
  const {
    catalogBlobOid,
    catalogBytes,
    schemaBlobOid,
    schemaBytes,
  } = await readCommittedSources(args);
  const catalog = JSON.parse(catalogBytes.toString('utf8'));
  const schema = JSON.parse(schemaBytes.toString('utf8'));

  if (catalog.schema_version !== EXPECTED_SCHEMA_VERSION) {
    throw new Error('Unsupported catalog schema_version');
  }
  if (schema.$id !== EXPECTED_SCHEMA_ID) throw new Error('Unexpected catalog schema $id');

  const validate = createAnalysisRequirementsAjv().compile(schema);
  if (!validate(catalog)) {
    throw new Error(`Catalog failed its published schema: ${JSON.stringify(validate.errors)}`);
  }
  assertFailClosedAuthority(catalog.authority);
  validateAnalysisRequirementsCatalogSemantics(catalog);

  const catalogOutput = canonicalJson(catalog);
  const schemaOutput = canonicalJson(schema);
  const pin = {
    authority: FAIL_CLOSED_AUTHORITY,
    catalog: {
      bytes: catalogOutput.byteLength,
      catalog_version: catalog.catalog_version,
      path: `upstream/${CATALOG_FILE}`,
      schema_version: catalog.schema_version,
      sha256: `sha256:${sha256(catalogOutput)}`,
    },
    schema: {
      bytes: schemaOutput.byteLength,
      id: schema.$id,
      path: `upstream/${SCHEMA_FILE}`,
      sha256: `sha256:${sha256(schemaOutput)}`,
    },
    schema_version: 'observatory-analysis-requirements-pin.v1.0.0',
    source: {
      catalog_blob_oid: catalogBlobOid,
      catalog_path: CATALOG_SOURCE_PATH,
      origin_verified: false,
      project_id: 'ajhcs/healthcare-toolkit',
      revision: args['source-revision'],
      schema_blob_oid: schemaBlobOid,
      schema_path: SCHEMA_SOURCE_PATH,
      tracking_bead: 'healthcare-toolkit-672v',
    },
  };
  const pinOutput = canonicalJson(pin);
  const expectedFiles = new Map([
    [CATALOG_FILE, catalogOutput],
    [SCHEMA_FILE, schemaOutput],
    [PIN_FILE, pinOutput],
  ]);

  const publication = await publishImmutableDirectory(args.outputRoot, expectedFiles);

  return {
    output_root: path.relative(projectRoot, args.outputRoot),
    pin,
    publication,
    status: 'PASS',
  };
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  const result = await importAnalysisRequirements(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
