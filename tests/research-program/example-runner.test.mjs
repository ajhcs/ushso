import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  blockedFetch,
  createExampleReceipt,
  executeBoundedSample,
  generateCopyableExamples,
  publishExamplePreview,
  roundTripExample,
} from '../../packages/connectors/src/testing/example-runner.mjs';
import { runCli } from '../../scripts/research-program/test-example.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const censusHtml = path.join(root, 'tests/research-program/fixtures/pr009-census-negative/sample-census-acs.html');
const censusReceiptPath = path.join(root, 'tests/research-program/fixtures/pr009-census-negative/sample-census-acs.receipt.json');

function headers(contentType) {
  return new Headers({ 'content-type': contentType });
}

test('CMS, CDC and Census keyless receipts have distinct expected outcomes', async () => {
  const cms = createExampleReceipt({
    source: 'cms',
    release: 'hcris-2023',
    distribution: 'cms-api',
    expected: { content_class: 'json', media_type: 'application/json', fields: ['PROVNUM'], types: { PROVNUM: 'string' } },
    limits: { max_rows: 1, max_bytes: 4096 },
  });
  const cdc = createExampleReceipt({
    source: 'cdc',
    release: 'places-2023',
    distribution: '7cmc-7y5g',
    expected: { content_class: 'json', media_type: 'application/json', fields: ['stateabbr'], types: { stateabbr: 'string' } },
    limits: { max_rows: 1, max_bytes: 4096 },
  });
  const census = createExampleReceipt({
    source: 'census',
    release: 'acs5-2023',
    distribution: 'acs5-subject',
    expected: { content_class: 'catalog_metadata', media_type: 'text/html' },
    credentialRequired: true,
    outcomeKind: 'keyed',
  });
  assert.notDeepEqual({ source: cms.source, fields: cms.expected.fields }, { source: cdc.source, fields: cdc.expected.fields });
  assert.notDeepEqual({ source: cdc.source, credential: cdc.credential_required }, { source: census.source, credential: census.credential_required });
  assert.equal(census.credential_required, true);
  assert.equal(cms.tested_example, false);
  const html = await readFile(censusHtml);
  const receipt = JSON.parse(await readFile(censusReceiptPath, 'utf8'));
  const executed = executeBoundedSample(census, {
    status: receipt.observed_status,
    mediaType: receipt.observed_media_type,
    headers: headers(receipt.observed_media_type),
    bodyBytes: html,
    requestedUrl: 'https://api.census.gov/data/acs',
    finalUrl: `https://${receipt.safe_final_host}${receipt.safe_final_path}`,
    observedTitle: 'Missing Key',
    missingKey: true,
  });
  assert.equal(executed.result, 'missing_key');
  assert.equal(executed.tested_example, false);
  assert.equal(executed.http_success_alone, true);
  assert.equal(executed.full_dataset_validated, false);
});

test('wrong MIME, unexpected field, empty-but-valid data and ignored row limit have explicit results', () => {
  const receipt = createExampleReceipt({
    source: 'cms',
    release: 'hcris-2023',
    distribution: 'cms-api',
    expected: { content_class: 'json', media_type: 'application/json', fields: ['PROVNUM'], types: { PROVNUM: 'string' } },
    limits: { max_rows: 1, max_bytes: 4096 },
  });
  const wrongMime = executeBoundedSample(receipt, {
    status: 200,
    mediaType: 'text/html',
    headers: headers('text/html'),
    bodyBytes: Buffer.from('<html>not json</html>'),
  });
  assert.equal(wrongMime.result, 'wrong_mime');
  assert.equal(wrongMime.tested_example, false);
  const unexpected = executeBoundedSample(receipt, {
    status: 200,
    mediaType: 'application/json',
    headers: headers('application/json'),
    bodyBytes: Buffer.from('[{"OTHER":"x"}]'),
    bodyJson: [{ OTHER: 'x' }],
  });
  assert.equal(unexpected.result, 'unexpected_field');
  const empty = executeBoundedSample(receipt, {
    status: 200,
    mediaType: 'application/json',
    headers: headers('application/json'),
    bodyBytes: Buffer.from('[]'),
    bodyJson: [],
    emptyValid: true,
  });
  assert.equal(empty.passed, true);
  assert.equal(empty.tested_example, false);
  assert.equal(empty.checks[0].code, 'empty_but_valid');
  const ignored = executeBoundedSample(receipt, {
    status: 200,
    mediaType: 'application/json',
    headers: headers('application/json'),
    bodyBytes: Buffer.from('[{"PROVNUM":"1"},{"PROVNUM":"2"}]'),
    bodyJson: [{ PROVNUM: '1' }, { PROVNUM: '2' }],
  });
  assert.equal(ignored.result, 'ignored_row_limit');
});

test('HTTP 200 alone never produces a tested-example badge and sample checks stay separate from full schema', () => {
  const receipt = createExampleReceipt({
    source: 'cdc',
    release: 'places-2023',
    distribution: '7cmc-7y5g',
    expected: { content_class: 'json', media_type: 'application/json', fields: ['stateabbr'], types: { stateabbr: 'string' } },
    limits: { max_rows: 1, max_bytes: 4096 },
  });
  const html200 = executeBoundedSample(receipt, {
    status: 200,
    mediaType: 'text/html',
    headers: headers('text/html'),
    bodyBytes: Buffer.from('<html>ok</html>'),
  });
  assert.equal(html200.tested_example, false);
  assert.equal(html200.http_success_alone, true);
  const sample = executeBoundedSample(receipt, {
    status: 200,
    mediaType: 'application/json',
    headers: headers('application/json'),
    bodyBytes: Buffer.from('[{"stateabbr":"PA"}]'),
    bodyJson: [{ stateabbr: 'PA' }],
  });
  assert.equal(sample.tested_example, true);
  assert.equal(sample.full_dataset_validated, false);
  assert.equal(sample.full_schema_validated, false);
  assert.equal(sample.catalog_accepted, false);
});

test('previews distinguish sampled values from synthetic examples and redact credentials', () => {
  const receipt = createExampleReceipt({
    source: 'cms',
    release: 'hcris-2023',
    distribution: 'cms-api',
    parameters: { get: 'PROVNUM', key: 'secret-value' },
    expected: { content_class: 'json', media_type: 'application/json', fields: ['PROVNUM'], types: { PROVNUM: 'string' } },
    limits: { max_rows: 1, max_bytes: 4096 },
  });
  assert.equal(receipt.parameters.key, '[REDACTED]');
  const sample = executeBoundedSample(receipt, {
    status: 200,
    mediaType: 'application/json',
    headers: headers('application/json'),
    bodyBytes: Buffer.from('[{"PROVNUM":"390001"}]'),
    bodyJson: [{ PROVNUM: '390001' }],
  });
  const sampled = publishExamplePreview(receipt, sample);
  const synthetic = publishExamplePreview(receipt, sample, { synthetic: true });
  assert.equal(sampled.kind, 'sampled_aggregate_preview');
  assert.equal(sampled.values_retained, true);
  assert.equal(synthetic.kind, 'synthetic_schema_example');
  assert.equal(synthetic.synthetic, true);
  assert.equal(synthetic.values_retained, false);
  const blocked = publishExamplePreview(receipt, executeBoundedSample(receipt, {
    status: 200,
    mediaType: 'text/html',
    headers: headers('text/html'),
    bodyBytes: Buffer.from('<html>no</html>'),
  }));
  assert.equal(blocked.kind, 'untested');
  const examples = generateCopyableExamples(receipt);
  assert.match(examples.curl, /key=\[REDACTED\]/);
  assert.equal(examples.python.includes('secret-value'), false);
  assert.equal(examples.url.includes('secret-value'), false);
  assert.equal(roundTripExample(receipt, examples), true);
});

test('CLI stays fixture-only and live fetch is forbidden', async () => {
  const cli = runCli([]);
  assert.equal(cli.ok, false);
  assert.equal(cli.error, 'EXAMPLE_CLI_FIXTURE_ONLY');
  await assert.rejects(() => blockedFetch('https://data.cms.gov'), { code: 'EXAMPLE_RUNNER_LIVE_NETWORK_FORBIDDEN' });
});
