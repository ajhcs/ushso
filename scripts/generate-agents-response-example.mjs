import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'packages/retrieval/fixtures/responses/q-hospital-ownership.json');
const outputPath = path.join(root, 'apps/web/src/data/generatedAgentsResponseExample.json');
const response = JSON.parse(await fs.readFile(sourcePath, 'utf8'));

const example = {
  contract_version: response.contract_version,
  query: {
    interpretation: {
      geographies: response.query.interpretation.geographies,
    },
  },
  result_count: response.result_count,
  results: response.results.slice(0, 1).map(result => ({
    record_id: result.record_id,
    record: { authoritative_url: result.record.authoritative_url },
  })),
  warnings: response.warnings.slice(0, 1),
};

await fs.writeFile(outputPath, `${JSON.stringify(example, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: 'PASS', source: path.relative(root, sourcePath), output: path.relative(root, outputPath) })}\n`);
