import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalJsonSha256, PACKAGE_ROOT, readJson, sha256File, walkFiles, writeDeterministicJson } from './common.mjs';

const EXCLUDED = new Set(['manifests/package-manifest.json', 'validation/validation-receipt.json']);

function mediaType(relative) {
  if (relative.endsWith('.json')) return 'application/json';
  if (relative.endsWith('.md')) return 'text/markdown';
  return 'text/javascript';
}

export async function buildManifest() {
  const relatives = (await walkFiles(PACKAGE_ROOT)).filter(relative => !EXCLUDED.has(relative));
  const files = [];
  let payloadBytes = 0;
  for (const relative of relatives) {
    const absolute = path.join(PACKAGE_ROOT, relative);
    const stats = await fs.stat(absolute);
    const isJson = relative.endsWith('.json');
    files.push({
      path: relative,
      media_type: mediaType(relative),
      bytes: stats.size,
      raw_file_sha256: await sha256File(absolute),
      canonical_json_sha256: isJson ? canonicalJsonSha256(await readJson(absolute)) : null
    });
    payloadBytes += stats.size;
  }
  const manifest = {
    manifest_version: 'ingestion-package-manifest.v1',
    package: { name: '@ushso/ingestion-contract-v1-1', version: '1.1.0', immutable: true },
    schema_dialect: 'https://json-schema.org/draft/2020-12/schema',
    canonicalization: {
      algorithm: 'ushso-canonical-json', version: '1', encoding: 'UTF-8',
      object_key_order: 'Unicode-code-point-lexicographic', array_order: 'preserved', transport_exclusions: []
    },
    digest_taxonomy: [
      { digest_type: 'raw_file_sha256', algorithm: 'SHA-256', scope: 'exact stored file bytes' },
      { digest_type: 'canonical_json_sha256', algorithm: 'SHA-256 over ushso-canonical-json v1 UTF-8 bytes', scope: 'parsed JSON value; not a file-byte digest' }
    ],
    compatibility: {
      predecessor_package: '@ushso/ingestion-contract',
      predecessor_version: '1.0.0',
      predecessor_manifest_raw_file_sha256: '842888bae6092da9d00982bed4186a43ceb6aeace9f837947c5a4eb6e0da9886',
      predecessor_validation_receipt_raw_file_sha256: '665174c8ec848ae93fdb8034010f03892b2771aa67b777b361526dd6f396f8e8',
      relationship: 'strict_subset_for_harvest_run_workflow_instance_id',
      upgrade_rule: 'replace_contract_version_only_when_workflow_instance_id_is_provider_compatible',
      downgrade_rule: 'replace_contract_version_only; every_valid_v1_1_record_preserves_v1_0_shape_and_semantics',
      unsafe_legacy_action: 'retain_as_v1_0_audit_record_and_do_not_create_or_remap_provider_instance',
      unexpected_properties: 'reject',
      enum_extension: 'breaking_without_version_change',
      deprecation_state: 'current_successor'
    },
    file_count: files.length,
    payload_bytes: payloadBytes,
    files
  };
  await writeDeterministicJson(path.join(PACKAGE_ROOT, 'manifests', 'package-manifest.json'), manifest);
  return manifest;
}

if (process.argv[1]?.endsWith('build-manifest.mjs')) {
  buildManifest().then(manifest => process.stdout.write(`${JSON.stringify({ valid: true, file_count: manifest.file_count, payload_bytes: manifest.payload_bytes }, null, 2)}\n`))
    .catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
