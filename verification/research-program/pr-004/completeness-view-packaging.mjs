import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

export const PACKAGING_FORMAT = 'ushso.completeness-view.gzip-v1';
export const PACKAGING_SCHEMA_VERSION = 'ushso.completeness-view-packaging.v1';
export const GZIP_LEVEL = 9;
export const GZIP_HEADER_MTIME = 0;
export const GZIP_HEADER_OS = 3;
export const GZIP_HEADER_XFL = 2;
export const ORIGINAL_DECODED_BYTES = 49808256;
export const ORIGINAL_DECODED_SHA256 = '47be5a2e5bb63a0bb3effa78977abaa653882156f2057c57efe40f7aa65d8a74';
export const ORIGINAL_ARTIFACT_ID = 'urn:ushso:completeness-view:7b6d763bfc652aa094b7d68c76ebc534de401c1e';
export const ORIGINAL_ARTIFACT_DIGEST = 'sha256:7b6d763bfc652aa094b7d68c76ebc534de401c1e5904738932231b7824b42fab';
export const ORIGINAL_GIT_SNAPSHOT = Object.freeze({
  commit: '323dfe54c88322369f417c7fde22597b9ab57d75',
  path: 'verification/research-program/pr-004/completeness-view.json'
});
export const SEARCHABLE_RECORD_COUNT = 3430;

export function packagedPaths(root) {
  const directory = path.join(root, 'verification/research-program/pr-004');
  return {
    directory,
    transport: path.join(directory, 'completeness-view.json.gz'),
    manifest: path.join(directory, 'completeness-view.manifest.json'),
    decodedForbidden: path.join(directory, 'completeness-view.json')
  };
}

export function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fail(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  throw error;
}

export function canonicalizeGzipHeader(bytes) {
  const out = Buffer.isBuffer(bytes) ? Buffer.from(bytes) : Buffer.from(bytes);
  if (out.length < 10 || out[0] !== 0x1f || out[1] !== 0x8b || out[2] !== 0x08) {
    fail('completeness_gzip_corrupt');
  }
  out[4] = 0;
  out[5] = 0;
  out[6] = 0;
  out[7] = 0;
  out[8] = GZIP_HEADER_XFL;
  out[9] = GZIP_HEADER_OS;
  return out;
}

export function gzipCompletenessBytes(decodedBytes) {
  if (!Buffer.isBuffer(decodedBytes)) fail('completeness_decoded_bytes_required');
  return canonicalizeGzipHeader(zlib.gzipSync(decodedBytes, { level: GZIP_LEVEL }));
}

export function gunzipCompletenessBytes(transportBytes, { maxOutputLength = ORIGINAL_DECODED_BYTES } = {}) {
  const bytes = Buffer.isBuffer(transportBytes) ? transportBytes : Buffer.from(transportBytes);
  if (bytes.length < 10 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) fail('completeness_gzip_corrupt');
  try {
    return zlib.gunzipSync(bytes, { maxOutputLength });
  } catch (error) {
    if (error.code === 'ERR_BUFFER_TOO_LARGE') fail('completeness_decoded_size_bound', error);
    if (error.code === 'Z_BUF_ERROR') fail('completeness_gzip_truncated', error);
    if (error.code === 'Z_DATA_ERROR') fail('completeness_gzip_corrupt', error);
    fail('completeness_gzip_decode_failed', error);
  }
}

export function assertTransportIdentity(transportBytes, expected) {
  if (!expected || typeof expected.bytes !== 'number' || typeof expected.sha256 !== 'string') {
    fail('completeness_transport_identity_required');
  }
  if (transportBytes.length !== expected.bytes) fail('completeness_transport_byte_mismatch');
  const digest = sha256Hex(transportBytes);
  if (digest !== expected.sha256) fail('completeness_transport_hash_mismatch');
  return digest;
}

export function assertDecodedIdentity(decodedBytes, expected = {
  bytes: ORIGINAL_DECODED_BYTES,
  sha256: ORIGINAL_DECODED_SHA256
}) {
  if (decodedBytes.length !== expected.bytes) fail('completeness_decoded_byte_mismatch');
  const digest = sha256Hex(decodedBytes);
  if (digest !== expected.sha256) fail('completeness_decoded_hash_mismatch');
  return digest;
}

export function createCompletenessViewManifest({ transportBytes, decodedBytes, view }) {
  const vectorFieldCount = view.records.flatMap(record => record.source_vectors.flatMap(source => source.fields)).length;
  return {
    format: PACKAGING_FORMAT,
    schema_version: PACKAGING_SCHEMA_VERSION,
    compressor: {
      module: 'node:zlib',
      method: 'gzipSync',
      level: GZIP_LEVEL,
      header: {
        mtime: GZIP_HEADER_MTIME,
        os: GZIP_HEADER_OS,
        xfl: GZIP_HEADER_XFL
      }
    },
    transport: {
      path: 'verification/research-program/pr-004/completeness-view.json.gz',
      encoding: 'gzip',
      bytes: transportBytes.length,
      sha256: sha256Hex(transportBytes)
    },
    decoded: {
      path: ORIGINAL_GIT_SNAPSHOT.path,
      encoding: 'utf8-json',
      bytes: decodedBytes.length,
      sha256: sha256Hex(decodedBytes),
      git_snapshot: {
        commit: ORIGINAL_GIT_SNAPSHOT.commit,
        path: ORIGINAL_GIT_SNAPSHOT.path
      }
    },
    logical: {
      schema_version: view.schema_version,
      artifact_id: view.artifact_id,
      artifact_digest: view.artifact_digest,
      vector_encoding: view.vector_encoding,
      cohort: view.cohort,
      generation: view.generation,
      as_of: view.as_of,
      input_digest: view.input_digest,
      record_count: view.membership.record_count,
      source_membership_count: view.membership.source_membership_count,
      isolated_count: view.membership.isolated_count,
      searchable_record_count: SEARCHABLE_RECORD_COUNT,
      vector_field_count: vectorFieldCount,
      metric_count: view.aggregates.metrics.length,
      evidence_catalog_count: view.evidence_catalog.length
    },
    offline_consumption: {
      loader: 'verification/research-program/pr-004/completeness-view-packaging.mjs',
      verifier: 'verification/research-program/pr-004/verify.mjs',
      instruction: 'Decode in memory with Node zlib.gunzipSync bounded to decoded.bytes. Do not write the decoded JSON into the repository tree. gzip -dc may hash or inspect the payload only outside the working tree.'
    }
  };
}

function assertManifestShape(manifest) {
  if (!manifest || manifest.format !== PACKAGING_FORMAT || manifest.schema_version !== PACKAGING_SCHEMA_VERSION) {
    fail('completeness_manifest_invalid');
  }
  if (!manifest.transport || !manifest.decoded || !manifest.logical) fail('completeness_manifest_invalid');
}

export async function loadPackagedCompletenessView({
  root,
  manifestBytes,
  transportBytes,
  expectedDecoded = { bytes: ORIGINAL_DECODED_BYTES, sha256: ORIGINAL_DECODED_SHA256 }
} = {}) {
  if (typeof root !== 'string' || root.length === 0) fail('completeness_packaging_root_required');
  const paths = packagedPaths(root);
  const manifestRaw = manifestBytes ?? await fs.readFile(paths.manifest);
  const manifest = JSON.parse(manifestRaw.toString('utf8'));
  assertManifestShape(manifest);
  if (manifest.decoded.sha256 !== expectedDecoded.sha256 || manifest.decoded.bytes !== expectedDecoded.bytes) {
    fail('completeness_decoded_hash_mismatch');
  }
  const transport = transportBytes ?? await fs.readFile(paths.transport);
  assertTransportIdentity(transport, manifest.transport);
  const decoded = gunzipCompletenessBytes(transport, { maxOutputLength: manifest.decoded.bytes });
  assertDecodedIdentity(decoded, expectedDecoded);
  const view = JSON.parse(decoded.toString('utf8'));
  if (view.artifact_id !== ORIGINAL_ARTIFACT_ID || view.artifact_digest !== ORIGINAL_ARTIFACT_DIGEST) {
    fail('completeness_logical_identity_mismatch');
  }
  return { manifest, transport, decoded, view, paths };
}

export async function writePackagedCompletenessView({ root, decodedBytes, view }) {
  if (typeof root !== 'string' || root.length === 0) fail('completeness_packaging_root_required');
  const paths = packagedPaths(root);
  assertDecodedIdentity(decodedBytes);
  if (view.artifact_id !== ORIGINAL_ARTIFACT_ID || view.artifact_digest !== ORIGINAL_ARTIFACT_DIGEST) {
    fail('completeness_logical_identity_mismatch');
  }
  const transport = gzipCompletenessBytes(decodedBytes);
  const roundtrip = gunzipCompletenessBytes(transport, { maxOutputLength: decodedBytes.length });
  if (!roundtrip.equals(decodedBytes)) fail('completeness_gzip_roundtrip_mismatch');
  const manifest = createCompletenessViewManifest({ transportBytes: transport, decodedBytes, view });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);

  let existingTransport = null;
  try {
    existingTransport = await fs.readFile(paths.transport);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existingTransport && !existingTransport.equals(transport)) fail('completeness_gzip_rebuild_drift');

  let existingManifest = null;
  try {
    existingManifest = await fs.readFile(paths.manifest);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existingManifest && !existingManifest.equals(manifestBytes)) fail('completeness_manifest_rebuild_drift');

  await fs.writeFile(paths.transport, transport);
  await fs.writeFile(paths.manifest, manifestBytes);
  await fs.rm(paths.decodedForbidden, { force: true });
  return { transport, manifest, manifestBytes, paths, decodedBytes };
}
