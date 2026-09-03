import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalizeJson } from '../../../contracts/tooling/v1.0.0/src/canonical-json.mjs';
import { verifyPackageManifest } from '../../../contracts/tooling/v1.0.0/src/manifest.mjs';
import { readStrictJson } from '../../../contracts/tooling/v1.0.0/src/strict-json.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, '../..');

function check(condition, code, detail = null) {
  if (!condition) throw new Error(`${code}${detail ? `:${detail}` : ''}`);
}

const [packageJson, manifest, wp1Receipt, wp8Receipt, authorizationRegister] = await Promise.all([
  readStrictJson(path.join(PACKAGE_ROOT, 'package.json')),
  readStrictJson(path.join(PACKAGE_ROOT, 'manifests/package-manifest.json')),
  readStrictJson(path.join(REPOSITORY_ROOT, 'verification/wp1/v1.0.0/receipts/repository-adapter-contract.json')),
  readStrictJson(path.join(REPOSITORY_ROOT, 'verification/wp8/v1.0.0/validation/validation-receipt.json')),
  readStrictJson(path.join(REPOSITORY_ROOT, 'verification/external-authorization/v1.0.0/register.json')),
]);

check(packageJson.name === '@ushso/search-generation', 'SEARCH_PACKAGE_NAME_INVALID');
check(packageJson.version === '2.0.0-untuned', 'SEARCH_PACKAGE_VERSION_INVALID');
check(packageJson.scripts?.test && packageJson.scripts?.validate, 'SEARCH_PACKAGE_SCRIPTS_MISSING');
check(packageJson.dependencies?.['@ushso/contract-tooling'] === '1.0.0', 'SEARCH_TOOLING_DEPENDENCY_NOT_PINNED');
check(packageJson.dependencies?.['@ushso/publication-contract'] === '1.0.0', 'SEARCH_PUBLICATION_DEPENDENCY_NOT_PINNED');
const manifestCheck = await verifyPackageManifest({ root: PACKAGE_ROOT, manifest });
check(manifestCheck.ok, 'SEARCH_PACKAGE_MANIFEST_MISMATCH');

const wp1Pins = new Map(wp1Receipt.source_files.map(source => [source.path, source.sha256]));
for (const relative of ['packages/search/search-backend.mjs', 'packages/search/static-search-backend.mjs']) {
  const entry = manifest.files.find(file => file.path === path.basename(relative));
  check(Boolean(entry), 'SEARCH_WP1_SOURCE_NOT_IN_MANIFEST', relative);
  check(entry.byte_digest.value === wp1Pins.get(relative), 'SEARCH_WP1_SOURCE_PIN_CHANGED', relative);
}
check(wp8Receipt.status === 'PASS_UNTUNED_SCAFFOLDING', 'SEARCH_WP8_VERIFICATION_INVALID');
check(wp8Receipt.quality_status === 'FAIL_PRE_TUNING' && wp8Receipt.release_gate_pass === false, 'SEARCH_RELEASE_BOUNDARY_INVALID');
const authorization = authorizationRegister.entries.find(entry => entry.id === 'AUTH-13');
check(authorization?.authorized === false && authorization?.status === 'not_requested', 'SEARCH_AUTH_13_STATE_INVALID');

const canonicalManifest = canonicalizeJson(manifest);
const manifestCanonicalSha256 = createHash('sha256').update(canonicalManifest).digest('hex');
process.stdout.write(`${JSON.stringify({
  ok: true,
  package: `${packageJson.name}@${packageJson.version}`,
  file_count: manifest.file_count,
  package_content_digest: manifest.package_content_digest,
  manifest_canonical_sha256: manifestCanonicalSha256,
  wp1_pins_unchanged: true,
  quality_status: wp8Receipt.quality_status,
  release_gate_pass: false,
  external_authorization: 'AUTH-13:not_requested',
})}\n`);
