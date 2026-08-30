import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRetrievalEngine } from '../tools/retrieval-core.mjs';
import { DISCOVERY_QUERY_SCHEMA } from '../tools/query-schema.mjs';
import { registerObservatoryWebMcp, TOOL_NAME } from '../tools/webmcp.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJsonl = filePath => fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const vocabulary = JSON.parse(fs.readFileSync(path.join(packageRoot, 'fixtures', 'controlled-vocabulary.json'), 'utf8'));
const baseRecordIds = new Set([
  'obs:asset:cms-provider-of-services-hospital',
  'obs:asset:unc-sheps-rural-hospital-closures',
  'obs:asset:usda-rural-urban-continuum-codes',
  'obs:asset:aha-annual-survey-database'
]);
const records = readJsonl(path.join(packageRoot, 'corpus', 'records.jsonl')).filter(record => baseRecordIds.has(record.record_id));
const routes = readJsonl(path.join(packageRoot, 'fixtures', 'base-join-routes.jsonl'));

test('WebMCP registers one read-only tool and executes the canonical retrieval engine', async () => {
  let registration;
  let options;
  const modelContext = {
    async registerTool(value, registerOptions) {
      registration = value;
      options = registerOptions;
    }
  };
  const engine = createRetrievalEngine({ records, joinRoutes: routes, vocabulary });
  const handle = await registerObservatoryWebMcp({ modelContext, engine });
  assert.equal(registration.name, TOOL_NAME);
  assert.deepEqual(registration.inputSchema, DISCOVERY_QUERY_SCHEMA);
  assert.deepEqual(registration.annotations, { readOnlyHint: true, untrustedContentHint: true });
  assert.equal(options.signal.aborted, false);
  const query = { question: 'What public sources can I use to study rural hospital closures?', limit: 10 };
  assert.deepEqual(await registration.execute(query), engine.retrieve(query));
  handle.unregister();
  assert.equal(options.signal.aborted, true);
});

test('WebMCP refuses registration without the browser surface', async () => {
  await assert.rejects(() => registerObservatoryWebMcp({ modelContext: {} }), /registerTool/);
});

test('browser execution modules contain no Node-only imports', () => {
  for (const relative of ['tools/question-parser.mjs', 'tools/intent-compiler.mjs', 'tools/search-document.mjs', 'tools/join-routes.mjs', 'tools/retrieval-core.mjs', 'tools/query-schema.mjs', 'tools/webmcp.mjs']) {
    const text = fs.readFileSync(path.join(packageRoot, relative), 'utf8');
    assert.doesNotMatch(text, /from ['"]node:/, relative);
    assert.doesNotMatch(text, /require\s*\(/, relative);
  }
});
