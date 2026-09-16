import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSchemaAssets, SUPPORTED_TOOLKIT_CONTRACTS } from './schema-assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'packages/retrieval');
const targetRoot = path.join(root, 'apps/web/public');
const files = [
  ['fixtures/named-source-registry.v1.0.0.json', 'corpus-v1.1.0/named-source-registry.json'],
  ['corpus/records.jsonl', 'corpus/records.jsonl'],
  ['corpus/search-documents.jsonl', 'corpus/search-documents.jsonl'],
  ['corpus/join-routes.jsonl', 'corpus/join-routes.jsonl'],
  ['corpus/corpus.json', 'corpus/corpus.json'],
  ['fixtures/controlled-vocabulary.json', 'corpus/controlled-vocabulary.json'],
  ['schemas/discovery-query.schema.json', 'corpus/discovery-query.schema.json'],
  ['schemas/discovery-result.schema.json', 'corpus/discovery-result.schema.json'],
  ['contracts/webmcp-tool.json', 'corpus/webmcp-tool.json'],
  ['versions/v1.1.0/corpus/records.jsonl', 'corpus-v1.1.0/records.jsonl'],
  ['versions/v1.1.0/corpus/search-documents.jsonl', 'corpus-v1.1.0/search-documents.jsonl'],
  ['versions/v1.1.0/corpus/join-routes.jsonl', 'corpus-v1.1.0/join-routes.jsonl'],
  ['versions/v1.1.0/corpus/corpus.json', 'corpus-v1.1.0/corpus.json'],
  ['versions/v1.1.0/fixtures/controlled-vocabulary.json', 'corpus-v1.1.0/controlled-vocabulary.json'],
  ['schemas/discovery-query.schema.json', 'corpus-v1.1.0/discovery-query.schema.json'],
  ['schemas/discovery-result.schema.json', 'corpus-v1.1.0/discovery-result.schema.json'],
  ['contracts/webmcp-tool.json', 'corpus-v1.1.0/webmcp-tool.json'],
  ['readiness/v0.1.0/state-readiness.json', 'state-readiness-v0.1.0.json']
];

async function filesBelow(directory) {
  const result = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(absolute));
    else result.push(absolute);
  }
  return result;
}

const liveVersionRoot = path.join(sourceRoot, 'versions/v1.2.0');
for (const sourcePath of await filesBelow(liveVersionRoot)) {
  const relative = path.relative(liveVersionRoot, sourcePath).replaceAll('\\', '/');
  files.push([`versions/v1.2.0/${relative}`, `corpus-v1.2.0/${relative}`]);
}
// Correction-3 candidate: stage only the served corpus inputs (records,
// registry, vocabulary, packets, manifests, validation). Build tooling and
// notes in the version directory are intentionally not published.
const candidateVersionRoot = path.join(sourceRoot, 'versions/v1.3.0');
const candidateStagedPrefixes = ['corpus/', 'fixtures/', 'manifests/', 'validation/', 'evidence-packets/'];
for (const sourcePath of await filesBelow(candidateVersionRoot)) {
  const relative = path.relative(candidateVersionRoot, sourcePath).replaceAll('\\', '/');
  if (!candidateStagedPrefixes.some((prefix) => relative.startsWith(prefix))) continue;
  files.push([`versions/v1.3.0/${relative}`, `corpus-candidate-v1.3.0/${relative}`]);
}
files.push(['fixtures/named-source-registry.v1.0.0.json', 'corpus-v1.2.0/fixtures/named-source-registry.json']);
files.push([
  null,
  'corpus-v1.2.0/webmcp-tool.json',
  path.join(root, 'packages/machine-toolkit/public-webmcp-tool.json'),
]);
// Verify the entire local dependency graph before touching generated output.
const schemaAssets = await collectSchemaAssets(root);
for (const asset of schemaAssets) files.push([null, asset.relative, asset.absolute]);

const requestedCatalogMode = process.env.USHSO_CATALOG_MODE || 'all';
if (requestedCatalogMode !== 'all' && requestedCatalogMode !== 'baseline' && requestedCatalogMode !== 'candidate') {
  throw new Error('STAGE_CATALOG_MODE_UNKNOWN: USHSO_CATALOG_MODE is ' + requestedCatalogMode);
}
if (requestedCatalogMode === 'baseline') {
  for (let index = files.length - 1; index >= 0; index--) {
    if (files[index][1].indexOf('corpus-candidate-v1.3.0') === 0) {
      files.splice(index, 1);
    }
  }
}
if (requestedCatalogMode === 'candidate' || requestedCatalogMode === 'all') {
  const candidateManifestPath = path.join(sourceRoot, 'versions/v1.3.0/manifests/candidate-manifest.json');
  const candidateCorpusPath = path.join(sourceRoot, 'versions/v1.3.0/corpus/corpus.json');
  const baselineCorpusPath = path.join(sourceRoot, 'versions/v1.2.0/corpus/corpus.json');
  let candidateManifest = null;
  let candidateCorpus = null;
  let baselineCorpus = null;
  try {
    candidateManifest = JSON.parse(await fs.readFile(candidateManifestPath, 'utf8'));
    candidateCorpus = JSON.parse(await fs.readFile(candidateCorpusPath, 'utf8'));
    baselineCorpus = JSON.parse(await fs.readFile(baselineCorpusPath, 'utf8'));
  } catch (error) {
    throw new Error('CANDIDATE_ASSETS_MISSING: candidate corpus or manifest is unavailable and candidate staging cannot silently fall back to baseline');
  }
  if (candidateCorpus.record_count !== 3436 || baselineCorpus.record_count !== 3434) {
    throw new Error('CANDIDATE_MANIFEST_MISMATCH: staged corpus counts do not match the frozen manifests');
  }
  if (candidateCorpus.record_count !== baselineCorpus.record_count + 2) {
    throw new Error('CANDIDATE_ARITHMETIC_MISMATCH: candidate count is not baseline plus two additive records');
  }
  if (!candidateManifest || candidateManifest.corpus_version !== '1.3.0-candidate') {
    throw new Error('CANDIDATE_MANIFEST_VERSION_MISMATCH: candidate manifest version is not 1.3.0-candidate');
  }
}
await fs.mkdir(targetRoot, { recursive: true });
await fs.rm(path.join(targetRoot, 'corpus-v1.2.0'), { recursive: true, force: true });
await fs.rm(path.join(targetRoot, 'corpus-candidate-v1.3.0'), { recursive: true, force: true });
for (const version of SUPPORTED_TOOLKIT_CONTRACTS) await fs.rm(path.join(targetRoot, `contracts/machine-toolkit/${version}/schemas`), { recursive: true, force: true });
for (const [source, target, absoluteSource = null] of files) {
  const sourcePath = absoluteSource ?? path.join(sourceRoot, source);
  const targetPath = path.join(targetRoot, target);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const content = await fs.readFile(sourcePath);
  try {
    const existing = await fs.readFile(targetPath);
    if (existing.equals(content)) continue;
    throw new Error(`CORPUS_STAGE_DRIFT:${target}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${targetPath}.partial-${process.pid}`;
  await fs.writeFile(temporary, content, { flag: 'wx' });
  await fs.rename(temporary, targetPath);
}
process.stdout.write(`${JSON.stringify({ status: 'PASS', staged_files: files.length })}\n`);
