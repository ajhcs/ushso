import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateIngestionRecord as validateIngestionV11 } from '../../../contracts/ingestion/v1.1.0/tools/index.mjs';
import {
  APPROVED_SOURCE_DESCRIPTOR_TEMPLATES, DESCRIPTOR_TEMPLATE_ACTIVATION,
  deliveryWaveManifest, routeManifestInventory, validateDeliveryWaveRegistry,
  validateDescriptor, validateRegulatorApcdRegistry,
} from '../src/index.mjs';
import { runFixtureMatrix } from '../src/testing/fixture-matrix.mjs';
import { runReconciliationAudit } from '../src/testing/reconciliation-audit.mjs';
import { runDeliveryWaveFixtureMatrix } from '../src/testing/wave-fixtures.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function filesBelow(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(absolute));
    else result.push(absolute);
  }
  return result;
}

const included = (await filesBelow(packageRoot))
  .filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`))
  .filter((file) => !file.endsWith('manifests/package-manifest.json'))
  .sort();
const content = await Promise.all(included.map(async (file) => ({
  path: path.relative(packageRoot, file).replaceAll(path.sep, '/'),
  bytes: await readFile(file),
})));
const fingerprint = createHash('sha256');
for (const file of content) {
  fingerprint.update(file.path);
  fingerprint.update('\0');
  fingerprint.update(file.bytes);
  fingerprint.update('\0');
}
const implementationFingerprint = fingerprint.digest('hex');

if (process.argv.includes('--fingerprint-only')) {
  process.stdout.write(`${implementationFingerprint}\n`);
  process.exit(0);
}

assert.equal(DESCRIPTOR_TEMPLATE_ACTIVATION.activation_authorized, false);
assert.equal(DESCRIPTOR_TEMPLATE_ACTIVATION.live_network_permitted, false);
assert.equal(DESCRIPTOR_TEMPLATE_ACTIVATION.external_authorization_gate, 'AUTH-04');
let routeCount = 0;
for (const descriptor of APPROVED_SOURCE_DESCRIPTOR_TEMPLATES) {
  validateDescriptor(descriptor);
  const contract = await validateIngestionV11('source-descriptor.schema.json', descriptor);
  assert.deepEqual(contract, { valid: true, issues: [] }, descriptor.descriptor_id);
  assert.equal(descriptor.source_state, 'paused');
  assert.equal(descriptor.legal_review.state, 'pending');
  const routes = routeManifestInventory(descriptor);
  routeCount += routes.length;
  assert.ok(routes.every((route) => ['catalog_metadata', 'documentation', 'schema', 'access_probe'].includes(route.purpose)));
  assert.ok(routes.every((route) => route.forbidden_route_classes.includes('source_data_payload')));
}

const sourceFiles = content.filter((file) => file.path.startsWith('src/') && file.path.endsWith('.mjs'));
const directIoPatterns = [
  /\bfetch\s*\(/,
  /node:(?:dns|http|https|net|tls)/,
  /cloudflarestorage\.com/,
  /\bR2Bucket\b/,
];
for (const file of sourceFiles) {
  const text = file.bytes.toString('utf8');
  for (const pattern of directIoPatterns) assert.equal(pattern.test(text), false, `${file.path} contains direct I/O pattern ${pattern}`);
}

const matrix = await runFixtureMatrix();
assert.equal(matrix.status, 'PASS');
assert.equal(matrix.totals.scenarios, 18);
assert.equal(matrix.totals.assertions, 81);
assert.ok(Object.values(matrix.zero_external_actions).every((value) => value === 0));
const deliveryWaveMatrix = await runDeliveryWaveFixtureMatrix();
assert.equal(deliveryWaveMatrix.status, 'PASS');
assert.equal(deliveryWaveMatrix.totals.scenarios, 10);
assert.equal(deliveryWaveMatrix.totals.assertions, 64);
assert.ok(Object.values(deliveryWaveMatrix.zero_external_actions).every((value) => value === 0));
assert.equal(validateDeliveryWaveRegistry().source_instances, APPROVED_SOURCE_DESCRIPTOR_TEMPLATES.length);
assert.equal(validateRegulatorApcdRegistry().entries, 8);
assert.equal(deliveryWaveManifest().length, APPROVED_SOURCE_DESCRIPTOR_TEMPLATES.length);
const reconciliation = await runReconciliationAudit();
assert.equal(reconciliation.status, 'PASS');
assert.equal(reconciliation.discoveries, reconciliation.exact_locator_capture_links);
assert.equal(reconciliation.prohibited_capture_classifications, 0);

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  package: '@ushso/connectors',
  version: '1.0.0',
  implementation_fingerprint: implementationFingerprint,
  files: content.length,
  descriptor_templates: APPROVED_SOURCE_DESCRIPTOR_TEMPLATES.length,
  route_templates: routeCount,
  fixture_scenarios: matrix.totals.scenarios,
  delivery_wave_scenarios: deliveryWaveMatrix.totals.scenarios,
  recorded_delivery_wave_fixtures: deliveryWaveMatrix.recorded_fixtures,
  assertions: matrix.totals.assertions + deliveryWaveMatrix.totals.assertions,
  reconciled_discoveries: reconciliation.discoveries,
  external_actions: 0,
}, null, 2)}\n`);
