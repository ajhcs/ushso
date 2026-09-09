import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRetrievalEngine } from '../packages/retrieval/tools/retrieval-core-v1.2.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusRoot = path.join(root, 'packages/retrieval/versions/v1.2.0');
const outputPath = path.join(root, 'apps/web/src/data/generatedAgentsResponseExample.json');
const question = 'CMS HCRIS hospital cost reports by state';
const expectedRecordId = 'obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-44060-2d9b0e057caefa17';
const readJson = async relative => JSON.parse(await fs.readFile(path.join(root, relative), 'utf8'));
const manifest = await readJson('packages/retrieval/versions/v1.2.0/corpus/corpus.json');
const records = (await Promise.all(manifest.record_files.map(async file => {
  const value = await fs.readFile(path.join(corpusRoot, 'corpus', file), 'utf8');
  return value.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}))).flat();
const engine = createRetrievalEngine({
  records,
  searchDocuments: null,
  joinRoutes: [],
  vocabulary: await readJson('packages/retrieval/versions/v1.2.0/fixtures/controlled-vocabulary.json'),
  namedSourceRegistry: await readJson('packages/retrieval/fixtures/named-source-registry.v1.0.0.json'),
  corpus: manifest,
});
const response = engine.retrieve({ question, page_size: 10 });
if (response.results[0]?.record_id !== expectedRecordId) {
  throw new Error('Agents quick-start example drifted from its reviewed production record');
}
const example = {
  contract_version: response.contract_version,
  corpus: {
    corpus_version: response.corpus.corpus_version,
    record_count: response.corpus.record_count,
    generation: response.corpus.publication.generation,
  },
  query: {
    question: response.query.question,
    interpretation: response.query.interpretation,
  },
  ranking: response.ranking,
  result_count: response.result_count,
  total_matches: response.total_matches,
  results: response.results.slice(0, 1).map(result => ({
    rank: result.rank,
    record_id: result.record_id,
    match_state: result.match_state,
    record: {
      title: result.record.title,
      authoritative_url: result.record.authoritative_url,
    },
  })),
  warnings: response.warnings,
};

await fs.writeFile(outputPath, JSON.stringify(example, null, 2) + '\n');
process.stdout.write(JSON.stringify({
  status: 'PASS',
  corpus_version: manifest.corpus_version,
  record_count: manifest.record_count,
  expected_record_id: expectedRecordId,
  output: path.relative(root, outputPath),
}) + '\n');
