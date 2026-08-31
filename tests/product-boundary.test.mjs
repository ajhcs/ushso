import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createWorker } from '../worker/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_CONTRACT_SEGMENTS = new Set(['machine-toolkit', 'research-plan']);
const ZERO_ACTION_FIELDS = [
  'source_requests_made',
  'execution_authorized_by_ushso',
  'retrieval_executed',
  'payloads_acquired',
  'analysis_executed',
  'identity_merges_performed'
];

// These are source-data or computed-result fields, not metadata fields. The
// patterns are intentionally narrow: `analysis_compatibility`, `row_count`,
// `payloads_acquired`, and other metadata assertions remain valid contracts.
const PROHIBITED_PUBLIC_FIELD_PATTERNS = [
  /^(?:healthcare|source|dataset)[_-]?data[_-]?rows?$/i,
  /^raw[_-]?(?:healthcare|source|dataset)[_-]?(?:data|rows?|payloads?)$/i,
  /^(?:row|record)[_-]?(?:payload|values?|contents?)$/i,
  /^(?:analysis|analytic)[_-]?(?:results?|outputs?|values?)$/i,
  /^computed[_-]?(?:measures?|metrics?|results?|values?)$/i,
  /^market[_-]?shares?(?:[_-]?(?:results?|values?))?$/i,
  /^financial[_-]?benchmarks?(?:[_-]?(?:results?|values?))?$/i,
  /^execut(?:e|ed)[_-]?(?:sql|analysis|queries?|code)$/i
];

const RUNTIME_SUFFIXES = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);

async function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function repositoryPath(absolute) {
  return path.relative(ROOT, absolute).split(path.sep).join('/');
}

function collectSchemaProperties(node, location = '$', collected = []) {
  if (Array.isArray(node)) {
    node.forEach((value, index) => collectSchemaProperties(value, `${location}[${index}]`, collected));
    return collected;
  }
  if (!node || typeof node !== 'object') return collected;
  if (node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)) {
    for (const [name, definition] of Object.entries(node.properties)) {
      const propertyLocation = `${location}.properties.${name}`;
      collected.push({ name, definition, location: propertyLocation });
      collectSchemaProperties(definition, propertyLocation, collected);
    }
  }
  for (const [name, value] of Object.entries(node)) {
    if (name !== 'properties') collectSchemaProperties(value, `${location}.${name}`, collected);
  }
  return collected;
}

function forcesFalse(definition) {
  if (!definition || typeof definition !== 'object') return false;
  if (definition.const === false) return true;
  if (Array.isArray(definition.enum) && definition.enum.length === 1 && definition.enum[0] === false) return true;
  return ['allOf', 'anyOf', 'oneOf'].some(keyword =>
    Array.isArray(definition[keyword]) && definition[keyword].some(forcesFalse)
  );
}

async function schemaDocuments() {
  const roots = [path.join(ROOT, 'contracts'), path.join(ROOT, 'packages', 'retrieval', 'schemas')];
  const files = (await Promise.all(roots.map(walkFiles)))
    .flat()
    .filter(file => file.endsWith('.schema.json'));
  return Promise.all(files.map(async file => ({
    file,
    document: JSON.parse(await readFile(file, 'utf8'))
  })));
}

function isTargetContract(file) {
  return repositoryPath(file).split('/').some(segment => TARGET_CONTRACT_SEGMENTS.has(segment));
}

function isPublicRuntime(file) {
  const relative = repositoryPath(file);
  if (/\.(?:test|spec)\.[^.]+$/.test(relative) || relative.endsWith('.d.ts')) return false;
  if (relative.startsWith('worker/')) return true;
  if (relative.startsWith('apps/web/src/')) return true;
  if (!relative.startsWith('services/')) return false;
  const segments = relative.toLowerCase().split('/');
  return segments.some(segment => /^(?:public|api|query|search|planner|machine|webmcp)(?:-|$)/.test(segment));
}

async function publicRuntimeSources() {
  const roots = [path.join(ROOT, 'worker'), path.join(ROOT, 'apps', 'web', 'src'), path.join(ROOT, 'services')];
  return (await Promise.all(roots.map(walkFiles)))
    .flat()
    .filter(file => RUNTIME_SUFFIXES.has(path.extname(file)) && isPublicRuntime(file));
}

function sampleEngine() {
  return {
    interpret(input = {}) {
      const question = input.question ?? 'Browse published health systems metadata';
      return {
        original_question: question,
        normalized_question: question.toLowerCase(),
        interpretation: {
          geographies: [],
          subjects: [],
          units_of_analysis: [],
          time_window: null,
          access_intent: {
            include_restricted: true,
            public_only: false,
            accepts_restricted: true,
            match_basis: 'default'
          }
        },
        compiler: { mode: 'deterministic_fixture', llm_used: false, external_requests: 0 }
      };
    },
    retrieve(input = {}) {
      if (typeof input.question !== 'string') throw new TypeError('question is required');
      return {
        contract_version: 'observatory-discovery-result.v1.0.0',
        retrieval_id: 'retrieval-product-boundary',
        evidence_mode: 'published_offline_evidence',
        corpus: { corpus_id: 'product-boundary', corpus_version: '1.0.0', record_count: 1, join_route_count: 0 },
        query: { question: input.question, normalized_question: input.question.toLowerCase(), interpretation: {}, filters: {} },
        result_count: 0,
        results: [],
        join_routes: [],
        warnings: []
      };
    }
  };
}

function sampleCatalog(engine) {
  return {
    records: [{ record_id: 'obs:asset:product-boundary', title: 'Metadata-only fixture' }],
    searchDocuments: [{}],
    joinRoutes: [],
    corpus: { corpus_id: 'product-boundary', corpus_version: '1.0.0' },
    engine
  };
}

test('public schemas cannot expose healthcare rows or computed analytical results', async () => {
  const violations = [];
  for (const { file, document } of await schemaDocuments()) {
    for (const property of collectSchemaProperties(document)) {
      if (PROHIBITED_PUBLIC_FIELD_PATTERNS.some(pattern => pattern.test(property.name))) {
        violations.push(`${repositoryPath(file)}:${property.location}`);
      }
    }
  }
  assert.deepEqual(violations, [], `prohibited public contract fields:\n${violations.join('\n')}`);
});

test('target plan and machine contracts pin every zero-action truth field to false', async t => {
  const documents = await schemaDocuments();
  const targetSchemas = documents.filter(({ file }) => isTargetContract(file));
  if (targetSchemas.length === 0) {
    t.diagnostic('Target research-plan and machine-toolkit schemas are not present yet; the gate activates as soon as either package appears.');
    return;
  }

  const occurrences = new Map(ZERO_ACTION_FIELDS.map(field => [field, []]));
  for (const { file, document } of documents) {
    for (const property of collectSchemaProperties(document)) {
      if (occurrences.has(property.name)) occurrences.get(property.name).push({ file, ...property });
    }
  }

  const targetPackages = new Map();
  for (const { file, document } of targetSchemas) {
    const packageName = repositoryPath(file).split('/').find(segment => TARGET_CONTRACT_SEGMENTS.has(segment));
    if (!targetPackages.has(packageName)) targetPackages.set(packageName, []);
    targetPackages.get(packageName).push(...collectSchemaProperties(document).filter(property => property.name === 'truth_boundary'));
  }

  const missing = [];
  const mutable = [];
  for (const field of ZERO_ACTION_FIELDS) {
    const definitions = occurrences.get(field);
    if (definitions.length === 0) missing.push(field);
    for (const occurrence of definitions) {
      if (!forcesFalse(occurrence.definition)) {
        mutable.push(`${repositoryPath(occurrence.file)}:${occurrence.location}`);
      }
    }
  }
  for (const [packageName, truthBoundaries] of targetPackages) {
    if (truthBoundaries.length === 0) missing.push(`${packageName}.truth_boundary`);
  }
  assert.deepEqual(missing, [], `missing zero-action truth fields: ${missing.join(', ')}`);
  assert.deepEqual(mutable, [], `truth fields must be schema-constant false:\n${mutable.join('\n')}`);
});

test('public runtime contains no analytical execution primitive or explicit external fetch literal', async () => {
  const executionPatterns = [
    /\b(?:calculate|compute)[A-Z_]?\w*(?:MarketShare|FinancialBenchmark)\s*\(/g,
    /\b(?:execute|run)(?:Analysis|Analytics|Sql|Notebook)\s*\(/g,
    /\bnew\s+Function\s*\(/g,
    /(?<![\w.])eval\s*\(/g
  ];
  const explicitExternalFetch = /(?<![\w.])fetch\s*\(\s*(?:new\s+Request\s*\(\s*)?[`'"]https?:\/\//g;
  const violations = [];

  for (const file of await publicRuntimeSources()) {
    const source = await readFile(file, 'utf8');
    for (const pattern of [...executionPatterns, explicitExternalFetch]) {
      pattern.lastIndex = 0;
      if (pattern.test(source)) violations.push(`${repositoryPath(file)}:${pattern.source}`);
    }
  }
  assert.deepEqual(violations, [], `public runtime product-boundary violations:\n${violations.join('\n')}`);
});

test('public request paths make zero authoritative requests and persist no raw query', { concurrency: false }, async () => {
  const engine = sampleEngine();
  const catalog = sampleCatalog(engine);
  const worker = createWorker({ loadEngine: async () => engine, loadCatalog: async () => catalog });
  const querySentinel = 'BOUNDARY_PRIVATE_QUERY_7b7bbd3e';
  const authoritativeRequests = [];
  const storageWrites = [];
  const logEntries = [];
  const originalFetch = globalThis.fetch;
  const originalConsole = {};

  globalThis.fetch = async (...args) => {
    authoritativeRequests.push(args);
    throw new Error('External fetch is forbidden in the public query path.');
  };
  for (const level of ['debug', 'info', 'log', 'warn', 'error']) {
    originalConsole[level] = console[level];
    console[level] = (...args) => logEntries.push(args.map(value => String(value)).join(' '));
  }

  const writeTrap = operation => (...args) => {
    storageWrites.push({ operation, args });
    throw new Error(`${operation} is forbidden in the public query path.`);
  };
  const env = {
    ASSETS: { fetch: async () => new Response('{}', { status: 200 }) },
    QUERY_KV: { put: writeTrap('kv.put') },
    QUERY_R2: { put: writeTrap('r2.put') },
    QUERY_QUEUE: { send: writeTrap('queue.send'), sendBatch: writeTrap('queue.sendBatch') },
    QUERY_DB: {
      exec: writeTrap('db.exec'),
      prepare(sql) {
        if (/\b(?:insert|update|delete|merge|upsert)\b/i.test(String(sql))) writeTrap('db.mutation')(sql);
        return { bind() { return this; }, first: async () => null, all: async () => ({ results: [] }) };
      }
    }
  };

  try {
    const requests = [
      new Request('https://ushso.org/api/health'),
      new Request('https://ushso.org/api/catalog?limit=1'),
      new Request('https://ushso.org/api/datasets/obs%3Aasset%3Aproduct-boundary'),
      new Request('https://ushso.org/api/discover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: querySentinel, limit: 5 })
      }),
      // This request is a 404 until the planner ships; exercising it now makes
      // an accidentally request-time implementation fail the boundary gate.
      new Request('https://ushso.org/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: querySentinel })
      })
    ];
    for (const request of requests) await worker.fetch(request, env);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [level, implementation] of Object.entries(originalConsole)) console[level] = implementation;
  }

  assert.equal(authoritativeRequests.length, 0, 'a public request used global external fetch');
  assert.equal(storageWrites.length, 0, 'a public request wrote to storage or a queue');
  assert.equal(logEntries.some(entry => entry.includes(querySentinel)), false, 'raw question appeared in logs');
});

test('public runtime has no obvious raw-question logging or persistence sink', async () => {
  const sinkPatterns = [
    /console\.(?:debug|info|log|warn|error)\s*\([^)]*\b(?:question|normalized_question|bodyText|requestBody|userId|user_id)\b/gs,
    /\.(?:put|send|sendBatch|write)\s*\([\s\S]{0,300}\b(?:question|normalized_question|bodyText|requestBody|userId|user_id)\b/gi,
    /\b(?:insert|update|upsert)\b[\s\S]{0,300}\b(?:question|normalized_question|userId|user_id)\b/gi
  ];
  const violations = [];
  for (const file of await publicRuntimeSources()) {
    const source = await readFile(file, 'utf8');
    for (const pattern of sinkPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(source)) violations.push(`${repositoryPath(file)}:${pattern.source}`);
    }
  }
  assert.deepEqual(violations, [], `raw-query persistence/logging patterns:\n${violations.join('\n')}`);
});

// Sanity-check the module resolution used by the receipt builder and CI.
test('boundary test path resolves inside the repository', () => {
  assert.equal(pathToFileURL(path.join(ROOT, 'tests', 'product-boundary.test.mjs')).protocol, 'file:');
});
