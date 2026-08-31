import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, contentFingerprint, hydrateFingerprints, ROOT, sha256File, writeAtomic } from './common.mjs';
import { fixtureBundleTemplate } from './fixture-data.mjs';
import { loadSchemas, schemaErrors } from './schema.mjs';
import { semanticErrors } from './semantics.mjs';

const PROHIBITED_ARGS = new Set(['--network', '--fetch', '--full', '--execute-analysis', '--acquire-payloads']);

export function assertSafeBuildArgs(args) {
  const prohibited = args.find(value => PROHIBITED_ARGS.has(value));
  if (prohibited) throw new Error(`PROHIBITED_MODE:${prohibited}`);
  if (args.length) throw new Error(`UNKNOWN_ARGUMENT:${args.join(',')}`);
}

function sortBundle(bundle) {
  const copy = structuredClone(bundle);
  for (const [name, rows] of Object.entries(copy)) {
    if (name !== 'bundle_version' && Array.isArray(rows)) rows.sort((left, right) => Buffer.compare(Buffer.from(left.revision_id), Buffer.from(right.revision_id)));
  }
  return copy;
}

export async function buildFixtures() {
  const template = fixtureBundleTemplate();
  const bundle = sortBundle(hydrateFingerprints(template));
  const { ajv } = await loadSchemas();
  const validate = ajv.getSchema('https://ushso.org/contracts/core/v2.0.0/schemas/fixture-bundle.schema.json');
  if (!validate(bundle)) throw new Error(`FIXTURE_SCHEMA_INVALID:${JSON.stringify(schemaErrors(validate))}`);
  const errors = semanticErrors(bundle);
  if (errors.length) throw new Error(`FIXTURE_SEMANTICS_INVALID:${JSON.stringify(errors)}`);

  const output = path.join(ROOT, 'bundle', 'valid-bundle.json');
  await writeAtomic(output, `${JSON.stringify(bundle, null, 2)}\n`);
  const manifestPath = path.join(ROOT, 'fixtures', 'fixture-manifest.json');
  const recordCounts = Object.fromEntries(Object.entries(bundle).filter(([, value]) => Array.isArray(value)).map(([name, value]) => [name, value.length]));
  const receipt = {
    receipt_version: 'observatory-core-fixture-build.v2.0.0',
    contract_version: 'observatory-core.v2.0.0',
    offline: true,
    network_used: false,
    source_data_included: false,
    fixture_manifest_file_sha256: await sha256File(manifestPath),
    bundle_file_sha256: await sha256File(output),
    bundle_content_fingerprint: contentFingerprint(bundle),
    record_counts: recordCounts,
    canonical_json_algorithm: 'ushso-canonical-json-v1'
  };
  const validateReceipt = ajv.getSchema('https://ushso.org/contracts/core/v2.0.0/schemas/build-receipt.schema.json');
  if (!validateReceipt(receipt)) throw new Error(`BUILD_RECEIPT_INVALID:${JSON.stringify(schemaErrors(validateReceipt))}`);
  await writeAtomic(path.join(ROOT, 'receipts', 'fixture-build.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  return { bundle, receipt, canonical_bytes: Buffer.byteLength(canonicalJson(bundle), 'utf8') };
}

if (process.argv[1]?.endsWith('build-fixtures.mjs')) {
  try {
    assertSafeBuildArgs(process.argv.slice(2));
    const { receipt, canonical_bytes: canonicalBytes } = await buildFixtures();
    process.stdout.write(`${JSON.stringify({ valid: true, record_counts: receipt.record_counts, bundle_file_sha256: receipt.bundle_file_sha256, bundle_content_fingerprint: receipt.bundle_content_fingerprint, canonical_bytes: canonicalBytes }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
