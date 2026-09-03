import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const RECEIPT_PATH = path.join(ROOT, 'verification', 'wp0', 'v1.0.0', 'receipts', 'product-boundary.json');
const TEST_PATH = path.join(ROOT, 'tests', 'product-boundary.test.mjs');
const TARGET_CONTRACT_SEGMENTS = new Set(['machine-toolkit', 'research-plan']);

async function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function repositoryPath(absolute) {
  return path.relative(ROOT, absolute).split(path.sep).join('/');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function inspectedFiles() {
  const fixed = [
    path.join(ROOT, 'SECURITY.md'),
    path.join(ROOT, 'docs', 'RESEARCH_NAVIGATOR_IMPLEMENTATION_PLAN.md'),
    TEST_PATH
  ];
  const scanned = (await Promise.all([
    walkFiles(path.join(ROOT, 'worker')),
    walkFiles(path.join(ROOT, 'services')),
    walkFiles(path.join(ROOT, 'apps', 'web', 'src')),
    walkFiles(path.join(ROOT, 'contracts')),
    walkFiles(path.join(ROOT, 'packages', 'retrieval', 'schemas'))
  ])).flat().filter(file => {
    const suffix = path.extname(file);
    return file.endsWith('.schema.json') || ['.js', '.mjs', '.cjs', '.ts', '.tsx'].includes(suffix);
  });
  return [...new Set([...fixed, ...scanned])]
    .filter(existsSync)
    .sort((left, right) => repositoryPath(left).localeCompare(repositoryPath(right)));
}

export async function buildProductBoundaryReceipt({ verifiedTestSummary = null } = {}) {
  let testSummary = verifiedTestSummary;
  const failures = [];
  if (testSummary === null) {
    const testStream = run({ files: [TEST_PATH], isolation: 'none' });
    for await (const event of testStream) {
      if (event.type === 'test:fail') failures.push(event.data.name);
      if (event.type === 'test:summary') testSummary = event.data;
    }
  }
  if (!testSummary?.success) throw new Error(`product boundary tests failed: ${failures.join(', ')}`);

  const files = await inspectedFiles();
  const hashes = await Promise.all(files.map(async file => ({
    path: repositoryPath(file),
    sha256: sha256(await readFile(file))
  })));
  const scopeDigest = sha256(hashes.map(entry => `${entry.path}\u0000${entry.sha256}\n`).join(''));
  const targetContractFiles = hashes.filter(entry =>
    entry.path.split('/').some(segment => TARGET_CONTRACT_SEGMENTS.has(segment))
  );
  const testCount = testSummary.counts.tests;
  const passCount = testSummary.counts.passed;

  return {
    receipt_id: 'wp0-product-boundary-v1.0.0',
    receipt_version: '1.0.0',
    verification_date: '2026-08-30',
    authoritative_specification: {
      path: 'docs/RESEARCH_NAVIGATOR_IMPLEMENTATION_PLAN.md',
      sections: ['3.3', '5.1', '5.12', '5.13', '14.4', '15.6.2', '17', '23.8']
    },
    command: 'node tests/product-boundary.test.mjs',
    result: 'pass',
    test_summary: {
      tests: testCount,
      passed: passCount,
      failed: 0,
      skipped: 0
    },
    assertions: [
      {
        id: 'BOUNDARY-METADATA-ONLY',
        result: 'pass',
        evidence: 'Public schema property names exclude source-data rows, payload bodies, and computed analytical result fields.'
      },
      {
        id: 'BOUNDARY-ZERO-ACTION-TRUTH',
        result: targetContractFiles.length > 0 ? 'pass' : 'gate_armed_target_contracts_not_yet_present',
        evidence: targetContractFiles.length > 0
          ? 'Every target research-plan and machine-toolkit zero-action field is schema-constant false.'
          : 'The executable check activates when a research-plan or machine-toolkit schema package appears.'
      },
      {
        id: 'BOUNDARY-NO-AUTHORITATIVE-EGRESS',
        result: 'pass',
        evidence: 'Instrumented public health, browse, dereference, discovery, and prospective planner requests made zero global fetch calls.'
      },
      {
        id: 'BOUNDARY-NO-ANALYSIS-EXECUTION',
        result: 'pass',
        evidence: 'Public runtime inspection found no analysis, SQL, notebook, market-share, or financial-benchmark execution primitive.'
      },
      {
        id: 'BOUNDARY-NO-RAW-QUERY-PERSISTENCE',
        result: 'pass',
        evidence: 'Instrumented storage, queue, console, and source-pattern checks found no raw-question write or log sink.'
      }
    ],
    target_contract_file_count: targetContractFiles.length,
    inspected_scope: {
      file_count: hashes.length,
      sha256: scopeDigest,
      files: hashes
    }
  };
}

async function main() {
  const receipt = await buildProductBoundaryReceipt();
  const rendered = `${JSON.stringify(receipt, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    if (!existsSync(RECEIPT_PATH)) throw new Error(`missing receipt: ${repositoryPath(RECEIPT_PATH)}`);
    const existing = await readFile(RECEIPT_PATH, 'utf8');
    if (existing !== rendered) throw new Error('product-boundary receipt is stale; run the builder without --check');
    process.stdout.write(`verified ${repositoryPath(RECEIPT_PATH)}\n`);
  } else if (process.argv.includes('--stdout')) {
    process.stdout.write(rendered);
  } else {
    await mkdir(path.dirname(RECEIPT_PATH), { recursive: true });
    await writeFile(RECEIPT_PATH, rendered, 'utf8');
    process.stdout.write(`wrote ${repositoryPath(RECEIPT_PATH)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
