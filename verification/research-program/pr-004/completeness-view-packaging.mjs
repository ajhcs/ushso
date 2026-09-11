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
export const ORIGINAL_TRANSPORT_PATH = 'verification/research-program/pr-004/completeness-view.json.gz';
export const ORIGINAL_TRANSPORT_ENCODING = 'gzip';
export const ORIGINAL_TRANSPORT_BYTES = 1904678;
export const ORIGINAL_TRANSPORT_SHA256 = '9f72a19a39f9e6a664ce8fdd36f1b5d31b61adea848ad40c0d72c9af3a95a064';
export const ORIGINAL_DECODED_PATH = ORIGINAL_GIT_SNAPSHOT.path;
export const ORIGINAL_DECODED_ENCODING = 'utf8-json';
export const ORIGINAL_SCHEMA_VERSION = 'ushso.completeness-view.v1.0.0';
export const ORIGINAL_VECTOR_ENCODING = 'compact-v1';
export const ORIGINAL_COHORT = 'PR-002 accepted baseline_records (C-002-3)';
export const ORIGINAL_GENERATION = 'live-2026-09-03-85b50522b420';
export const ORIGINAL_AS_OF = '2026-09-10T15:32:40.000Z';
export const ORIGINAL_INPUT_DIGEST = 'sha256:89130236f7a4c59d3d03a8c1c9aa3a3af93bef8289b1f337c2e52baca52fa543';
export const ORIGINAL_RECORD_COUNT = 3434;
export const ORIGINAL_SOURCE_MEMBERSHIP_COUNT = 3434;
export const ORIGINAL_ISOLATED_COUNT = 4;
export const SEARCHABLE_RECORD_COUNT = 3430;
export const ORIGINAL_VECTOR_FIELD_COUNT = 13736;
export const ORIGINAL_METRIC_COUNT = 25;
export const ORIGINAL_EVIDENCE_CATALOG_COUNT = 3434;
export const ORIGINAL_LOADER = 'verification/research-program/pr-004/completeness-view-packaging.mjs';
export const ORIGINAL_VERIFIER = 'verification/research-program/pr-004/verify.mjs';
export const ORIGINAL_COMPRESSOR = Object.freeze({
  module: 'node:zlib',
  method: 'gzipSync',
  level: GZIP_LEVEL,
  header: Object.freeze({
    mtime: GZIP_HEADER_MTIME,
    os: GZIP_HEADER_OS,
    xfl: GZIP_HEADER_XFL
  })
});

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

function fail(code, cause, field) {
  const error = new Error(field ? `${code}:${field}` : code);
  error.code = code;
  if (cause) error.cause = cause;
  if (field) error.field = field;
  throw error;
}

function assertManifestField(actual, expected, field) {
  if (actual !== expected) fail('completeness_manifest_inconsistent', undefined, field);
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
      path: ORIGINAL_TRANSPORT_PATH,
      encoding: ORIGINAL_TRANSPORT_ENCODING,
      bytes: transportBytes.length,
      sha256: sha256Hex(transportBytes)
    },
    decoded: {
      path: ORIGINAL_DECODED_PATH,
      encoding: ORIGINAL_DECODED_ENCODING,
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
      loader: ORIGINAL_LOADER,
      verifier: ORIGINAL_VERIFIER,
      instruction: 'Decode in memory with Node zlib.gunzipSync bounded to decoded.bytes. Do not write the decoded JSON into the repository tree. gzip -dc may hash or inspect the payload only outside the working tree.'
    }
  };
}

function assertManifestShape(manifest) {
  if (!manifest || manifest.format !== PACKAGING_FORMAT || manifest.schema_version !== PACKAGING_SCHEMA_VERSION) {
    fail('completeness_manifest_invalid');
  }
  if (!manifest.transport || !manifest.decoded || !manifest.logical || !manifest.compressor || !manifest.offline_consumption) {
    fail('completeness_manifest_invalid');
  }
  if (!manifest.decoded.git_snapshot || !manifest.compressor.header) fail('completeness_manifest_invalid');
}

function vectorFieldCount(view) {
  return view.records.flatMap(record => record.source_vectors.flatMap(source => source.fields)).length;
}

function readGzipHeader(transportBytes) {
  if (transportBytes.length < 10 || transportBytes[0] !== 0x1f || transportBytes[1] !== 0x8b || transportBytes[2] !== 0x08) {
    fail('completeness_gzip_corrupt');
  }
  return {
    mtime: transportBytes.readUInt32LE(4),
    xfl: transportBytes[8],
    os: transportBytes[9]
  };
}

export function assertPackagedManifestConsistency({ manifest, transportBytes, decodedBytes, view }) {
  assertManifestShape(manifest);
  if (!Buffer.isBuffer(transportBytes) || !Buffer.isBuffer(decodedBytes) || !view) {
    fail('completeness_manifest_invalid');
  }

  assertManifestField(manifest.transport.path, ORIGINAL_TRANSPORT_PATH, 'transport.path');
  assertManifestField(manifest.transport.encoding, ORIGINAL_TRANSPORT_ENCODING, 'transport.encoding');
  assertManifestField(manifest.decoded.path, ORIGINAL_DECODED_PATH, 'decoded.path');
  assertManifestField(manifest.decoded.encoding, ORIGINAL_DECODED_ENCODING, 'decoded.encoding');
  assertManifestField(manifest.decoded.git_snapshot.commit, ORIGINAL_GIT_SNAPSHOT.commit, 'decoded.git_snapshot.commit');
  assertManifestField(manifest.decoded.git_snapshot.path, ORIGINAL_GIT_SNAPSHOT.path, 'decoded.git_snapshot.path');

  const header = readGzipHeader(transportBytes);
  assertManifestField(manifest.compressor.header.mtime, header.mtime, 'compressor.header.mtime');
  assertManifestField(manifest.compressor.header.os, header.os, 'compressor.header.os');
  assertManifestField(manifest.compressor.header.xfl, header.xfl, 'compressor.header.xfl');
  assertManifestField(manifest.compressor.module, ORIGINAL_COMPRESSOR.module, 'compressor.module');
  assertManifestField(manifest.compressor.method, ORIGINAL_COMPRESSOR.method, 'compressor.method');
  assertManifestField(manifest.compressor.level, ORIGINAL_COMPRESSOR.level, 'compressor.level');
  assertManifestField(header.mtime, ORIGINAL_COMPRESSOR.header.mtime, 'compressor.header.mtime');
  assertManifestField(header.os, ORIGINAL_COMPRESSOR.header.os, 'compressor.header.os');
  assertManifestField(header.xfl, ORIGINAL_COMPRESSOR.header.xfl, 'compressor.header.xfl');

  assertManifestField(manifest.offline_consumption.loader, ORIGINAL_LOADER, 'offline_consumption.loader');
  assertManifestField(manifest.offline_consumption.verifier, ORIGINAL_VERIFIER, 'offline_consumption.verifier');

  const actualVectorFieldCount = vectorFieldCount(view);
  const actualSearchableCount = view.membership.record_count - view.membership.isolated_count;

  assertManifestField(manifest.logical.schema_version, view.schema_version, 'logical.schema_version');
  assertManifestField(manifest.logical.artifact_id, view.artifact_id, 'logical.artifact_id');
  assertManifestField(manifest.logical.artifact_digest, view.artifact_digest, 'logical.artifact_digest');
  assertManifestField(manifest.logical.vector_encoding, view.vector_encoding, 'logical.vector_encoding');
  assertManifestField(manifest.logical.cohort, view.cohort, 'logical.cohort');
  assertManifestField(manifest.logical.generation, view.generation, 'logical.generation');
  assertManifestField(manifest.logical.as_of, view.as_of, 'logical.as_of');
  assertManifestField(manifest.logical.input_digest, view.input_digest, 'logical.input_digest');
  assertManifestField(manifest.logical.record_count, view.membership.record_count, 'logical.record_count');
  assertManifestField(manifest.logical.source_membership_count, view.membership.source_membership_count, 'logical.source_membership_count');
  assertManifestField(manifest.logical.isolated_count, view.membership.isolated_count, 'logical.isolated_count');
  assertManifestField(manifest.logical.searchable_record_count, actualSearchableCount, 'logical.searchable_record_count');
  assertManifestField(manifest.logical.vector_field_count, actualVectorFieldCount, 'logical.vector_field_count');
  assertManifestField(manifest.logical.metric_count, view.aggregates.metrics.length, 'logical.metric_count');
  assertManifestField(manifest.logical.evidence_catalog_count, view.evidence_catalog.length, 'logical.evidence_catalog_count');

  assertManifestField(view.schema_version, ORIGINAL_SCHEMA_VERSION, 'logical.schema_version');
  assertManifestField(view.artifact_id, ORIGINAL_ARTIFACT_ID, 'logical.artifact_id');
  assertManifestField(view.artifact_digest, ORIGINAL_ARTIFACT_DIGEST, 'logical.artifact_digest');
  assertManifestField(view.vector_encoding, ORIGINAL_VECTOR_ENCODING, 'logical.vector_encoding');
  assertManifestField(view.cohort, ORIGINAL_COHORT, 'logical.cohort');
  assertManifestField(view.generation, ORIGINAL_GENERATION, 'logical.generation');
  assertManifestField(view.as_of, ORIGINAL_AS_OF, 'logical.as_of');
  assertManifestField(view.input_digest, ORIGINAL_INPUT_DIGEST, 'logical.input_digest');
  assertManifestField(view.membership.record_count, ORIGINAL_RECORD_COUNT, 'logical.record_count');
  assertManifestField(view.membership.source_membership_count, ORIGINAL_SOURCE_MEMBERSHIP_COUNT, 'logical.source_membership_count');
  assertManifestField(view.membership.isolated_count, ORIGINAL_ISOLATED_COUNT, 'logical.isolated_count');
  assertManifestField(actualSearchableCount, SEARCHABLE_RECORD_COUNT, 'logical.searchable_record_count');
  assertManifestField(actualVectorFieldCount, ORIGINAL_VECTOR_FIELD_COUNT, 'logical.vector_field_count');
  assertManifestField(view.aggregates.metrics.length, ORIGINAL_METRIC_COUNT, 'logical.metric_count');
  assertManifestField(view.evidence_catalog.length, ORIGINAL_EVIDENCE_CATALOG_COUNT, 'logical.evidence_catalog_count');
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
  assertTransportIdentity(transport, { bytes: ORIGINAL_TRANSPORT_BYTES, sha256: ORIGINAL_TRANSPORT_SHA256 });
  const decoded = gunzipCompletenessBytes(transport, { maxOutputLength: manifest.decoded.bytes });
  assertDecodedIdentity(decoded, expectedDecoded);
  const view = JSON.parse(decoded.toString('utf8'));
  if (view.artifact_id !== ORIGINAL_ARTIFACT_ID || view.artifact_digest !== ORIGINAL_ARTIFACT_DIGEST) {
    fail('completeness_logical_identity_mismatch');
  }
  assertPackagedManifestConsistency({ manifest, transportBytes: transport, decodedBytes: decoded, view });
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
  assertPackagedManifestConsistency({ manifest, transportBytes: transport, decodedBytes, view });
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
