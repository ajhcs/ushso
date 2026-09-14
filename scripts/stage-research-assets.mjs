import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMITS = Object.freeze({
  cloudflareMaxFiles: 100_000,
  cloudflareMaxFileBytes: 25 * 1024 * 1024,
  maxArchiveBytes: 8 * 1024 * 1024 * 1024,
  maxArchiveUnpackedBytes: 8 * 1024 * 1024 * 1024,
  maxArchiveEntries: 200_002,
  maxStagedBytes: 8 * 1024 * 1024 * 1024,
  maxManifestBytes: 2 * 1024 * 1024,
  maxDescriptorBytes: 256 * 1024,
  maxParserIssueBytes: 8 * 1024 * 1024,
  maxPageBytes: 64 * 1024,
  maxRecordCount: 100_000,
});

const HEX = /^[a-f0-9]{64}$/;
const LOCK_FORMAT = 'ushso.research-assets-lock.v1';
const INDEX_FORMAT = 'ushso.research-assets-index.v1';
const PACKAGE_KINDS = new Set(['dictionary', 'scientific-review', 'scientific-conflicts']);
const SAFE_PATH = /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.?($|\/))[A-Za-z0-9._~+@%:-]+(?:\/[A-Za-z0-9._~+@%:-]+)*$/;

const fail = (code, detail = '') => {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
};

// Keep ordering independent of the host locale so archive indexes and tree
// pins are reproducible across build machines.
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

const isSafeInteger = (value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= minimum && value <= maximum;

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Text(value) {
  return sha256(Buffer.from(value, 'utf8'));
}

function assertHex(value, code) {
  if (!HEX.test(value)) fail(code, String(value));
}

function assertSafePath(value, code = 'LOCK_PATH') {
  if (typeof value !== 'string' || !SAFE_PATH.test(value)) fail(code, String(value));
  return value;
}

function packageManifestPath(pkg) {
  return `${pkg.prefix}/manifest.json`;
}

function normalizeTarPath(value) {
  if (typeof value !== 'string') fail('ARCHIVE_PATH');
  const withoutNul = value.replace(/\0.*$/s, '');
  if (!withoutNul || withoutNul.startsWith('/') || withoutNul.includes('\\')) fail('ARCHIVE_PATH', value);
  const normalized = withoutNul.endsWith('/') ? withoutNul.slice(0, -1) : withoutNul;
  if (!normalized || !SAFE_PATH.test(normalized)) fail('ARCHIVE_PATH', value);
  return normalized;
}

function ensurePathUnderPrefixes(value, prefixes, code = 'ARCHIVE_UNEXPECTED_PATH') {
  if (!prefixes.some(prefix => value === prefix || value.startsWith(`${prefix}/`))) fail(code, value);
}

function parseOctal(bytes, code) {
  const text = bytes.toString('ascii').replace(/\0.*$/s, '').trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) fail(code, text);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) fail(code, text);
  return value;
}

function tarHeaderChecksum(header) {
  let total = 0;
  for (let index = 0; index < header.length; index += 1) {
    total += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  return total;
}

function isZeroBlock(bytes) {
  for (const byte of bytes) if (byte !== 0) return false;
  return true;
}

class StreamReader {
  constructor(stream, maxBytes = LIMITS.maxArchiveUnpackedBytes) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.buffer = Buffer.alloc(0);
    this.done = false;
    this.consumedBytes = 0;
    this.maxBytes = maxBytes;
  }

  async take(size, allowEnd = false) {
    if (!isSafeInteger(size, 0)) fail('ARCHIVE_READER');
    if (!isSafeInteger(this.maxBytes, 1)) fail('ARCHIVE_UNPACKED_SIZE_LIMIT');
    // A look-ahead read is needed for the final tar block: a valid archive can
    // end exactly at maxBytes, so asking whether another block exists must not
    // fail before the iterator reports EOF. Any actual bytes beyond the bound
    // are rejected below while buffering them.
    if (!allowEnd && this.consumedBytes + size > this.maxBytes) fail('ARCHIVE_UNPACKED_SIZE_LIMIT');
    if (allowEnd && this.consumedBytes >= this.maxBytes && this.buffer.length === 0 && this.done) return null;
    while (this.buffer.length < size && !this.done) {
      const next = await this.iterator.next();
      if (next.done) {
        this.done = true;
        break;
      }
      const chunk = Buffer.from(next.value);
      if (chunk.length) this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.consumedBytes + this.buffer.length > this.maxBytes) fail('ARCHIVE_UNPACKED_SIZE_LIMIT');
    }
    if (this.buffer.length < size) {
      if (allowEnd && this.buffer.length === 0) return null;
      fail('ARCHIVE_TRUNCATED');
    }
    if (this.consumedBytes + size > this.maxBytes) fail('ARCHIVE_UNPACKED_SIZE_LIMIT');
    const value = this.buffer.subarray(0, size);
    this.buffer = this.buffer.subarray(size);
    this.consumedBytes += size;
    return value;
  }
}

async function archiveStream(archivePath) {
  const handle = await fs.open(archivePath, 'r');
  try {
    const prefix = Buffer.alloc(2);
    const { bytesRead } = await handle.read(prefix, 0, 2, 0);
    if (bytesRead === 2 && prefix[0] === 0x1f && prefix[1] === 0x8b) {
      const source = createReadStream(archivePath, { highWaterMark: 256 * 1024 });
      const gunzip = createGunzip();
      // `pipe()` does not forward source errors to its destination. Bridge
      // both directions so a disk/read failure rejects the parser and a
      // parser or gunzip failure closes the raw source promptly.
      source.on('error', error => {
        if (!gunzip.destroyed) gunzip.destroy(error);
      });
      gunzip.on('error', () => {
        if (!source.destroyed) source.destroy();
      });
      source.pipe(gunzip);
      return {
        stream: gunzip,
        cleanup: () => {
          if (!source.destroyed) source.destroy();
          if (!gunzip.destroyed) gunzip.destroy();
        },
      };
    }
  } finally {
    await handle.close();
  }
  const source = createReadStream(archivePath, { highWaterMark: 256 * 1024 });
  return { stream: source, cleanup: () => source.destroy() };
}

async function readArchiveEntry(reader, size) {
  if (!isSafeInteger(size, 0, LIMITS.cloudflareMaxFileBytes)) fail('ARCHIVE_FILE_TOO_LARGE', String(size));
  const bytes = await reader.take(size);
  const padding = (512 - (size % 512)) % 512;
  if (padding) await reader.take(padding);
  return bytes;
}

async function extractArchive(archivePath, outputRoot, prefixes, { maxUnpackedBytes = LIMITS.maxArchiveUnpackedBytes, maxEntries = LIMITS.maxArchiveEntries } = {}) {
  if (!isSafeInteger(maxUnpackedBytes, 1, LIMITS.maxArchiveUnpackedBytes)) fail('ARCHIVE_UNPACKED_SIZE_LIMIT');
  if (!isSafeInteger(maxEntries, 1, LIMITS.maxArchiveEntries)) fail('ARCHIVE_ENTRY_LIMIT');
  const source = await archiveStream(archivePath);
  const { stream } = source;
  const reader = new StreamReader(stream, maxUnpackedBytes);
  const seen = new Set();
  let fileCount = 0;
  let totalBytes = 0;
  let entryCount = 0;
  let zeroBlocks = 0;
  try {
    for (;;) {
      const header = await reader.take(512, true);
      if (!header) {
        if (zeroBlocks < 2) fail('ARCHIVE_TERMINATOR');
        break;
      }
      if (isZeroBlock(header)) {
        zeroBlocks += 1;
        if (zeroBlocks === 2) {
          for (;;) {
            const tail = await reader.take(512, true);
            if (!tail) break;
            if (!isZeroBlock(tail)) fail('ARCHIVE_TRAILING_DATA');
          }
          break;
        }
        continue;
      }
      zeroBlocks = 0;
      entryCount += 1;
      if (entryCount > maxEntries) fail('ARCHIVE_ENTRY_LIMIT', String(entryCount));
      const checksum = parseOctal(header.subarray(148, 156), 'ARCHIVE_HEADER_CHECKSUM');
      if (checksum !== tarHeaderChecksum(header)) fail('ARCHIVE_HEADER_CHECKSUM');
      const magic = header.subarray(257, 263).toString('ascii').replace(/\0.*$/s, '');
      if (magic !== 'ustar') fail('ARCHIVE_HEADER_FORMAT', magic);
      const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
      const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
      const archivePathName = normalizeTarPath(prefix ? `${prefix}/${name}` : name);
      ensurePathUnderPrefixes(archivePathName, prefixes);
      if (seen.has(archivePathName)) fail('ARCHIVE_DUPLICATE_PATH', archivePathName);
      seen.add(archivePathName);
      const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
      const size = parseOctal(header.subarray(124, 136), 'ARCHIVE_SIZE');
      if (!isSafeInteger(size, 0, LIMITS.cloudflareMaxFileBytes)) fail('ARCHIVE_FILE_TOO_LARGE', archivePathName);
      const destination = path.join(outputRoot, archivePathName);
      const relativeDestination = path.relative(outputRoot, destination);
      if (relativeDestination.startsWith('..') || path.isAbsolute(relativeDestination)) fail('ARCHIVE_PATH', archivePathName);
      if (type === '5') {
        if (size !== 0) fail('ARCHIVE_DIRECTORY_SIZE', archivePathName);
        await fs.mkdir(destination, { recursive: true });
        continue;
      }
      if (type !== '0') fail('ARCHIVE_SPECIAL_ENTRY', `${archivePathName}:${type}`);
      fileCount += 1;
      if (fileCount > LIMITS.cloudflareMaxFiles) fail('CLOUDFLARE_FILE_LIMIT', String(fileCount));
      totalBytes += size;
      if (totalBytes > LIMITS.maxStagedBytes) fail('ASSET_TOTAL_BYTES_LIMIT', String(totalBytes));
      const bytes = await readArchiveEntry(reader, size);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      try {
        await fs.writeFile(destination, bytes, { flag: 'wx' });
      } catch (error) {
        if (error.code === 'EEXIST') fail('ARCHIVE_DUPLICATE_PATH', archivePathName);
        throw error;
      }
    }
  } catch (error) {
    // Async iteration surfaces source read and gunzip errors here. Preserve
    // parser error codes while giving compressed-source failures a stable
    // staging error for callers and tests.
    if (error?.code === 'Z_DATA_ERROR' || error?.code === 'Z_BUF_ERROR' || error?.code === 'Z_NEED_DICT') {
      fail('ARCHIVE_DECOMPRESSION_FAILED', error.message);
    }
    throw error;
  } finally {
    source.cleanup();
  }
  return { fileCount, totalBytes, entryCount, unpackedBytes: reader.consumedBytes };
}

async function hashFile(file, maximum = LIMITS.maxArchiveBytes) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) fail('ASSET_NOT_FILE', file);
  if (stat.size > maximum) fail('ASSET_SIZE_LIMIT', file);
  const digest = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file, { highWaterMark: 256 * 1024 })) {
    bytes += chunk.length;
    if (bytes > maximum) fail('ASSET_SIZE_LIMIT', file);
    digest.update(chunk);
  }
  if (bytes !== stat.size) fail('ASSET_CHANGED_DURING_READ', file);
  return { bytes, sha256: digest.digest('hex') };
}

async function readJson(file, maximum) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > maximum) fail('ASSET_JSON_LIMIT', file);
  const bytes = await fs.readFile(file);
  if (bytes.length !== stat.size) fail('ASSET_CHANGED_DURING_READ', file);
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail('ASSET_INVALID_JSON', file);
  }
  return { bytes, value };
}

async function walkFiles(root, current = '') {
  const result = [];
  const directory = path.join(root, current);
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') fail('ASSET_MISSING_DIRECTORY', current || root);
    throw error;
  }
  for (const entry of entries.sort((a, b) => compareText(a.name, b.name))) {
    const relative = current ? `${current}/${entry.name}` : entry.name;
    assertSafePath(relative, 'ASSET_PATH');
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) fail('ASSET_SYMLINK', relative);
    if (stat.isDirectory()) {
      result.push(...await walkFiles(root, relative));
      continue;
    }
    if (!stat.isFile()) fail('ASSET_SPECIAL_FILE', relative);
    if (stat.size > LIMITS.cloudflareMaxFileBytes) fail('CLOUDFLARE_FILE_SIZE_LIMIT', relative);
    const digest = await hashFile(absolute, LIMITS.cloudflareMaxFileBytes);
    result.push({ relative, absolute, bytes: digest.bytes, sha256: digest.sha256 });
  }
  return result;
}

export function treeDigest(files) {
  const digest = createHash('sha256');
  for (const file of [...files].sort((a, b) => compareText(a.relative, b.relative))) {
    digest.update(file.relative, 'utf8');
    digest.update('\0', 'utf8');
    digest.update(String(file.bytes), 'ascii');
    digest.update('\0', 'utf8');
    digest.update(file.sha256, 'ascii');
    digest.update('\n', 'utf8');
  }
  return digest.digest('hex');
}

export function validateLock(lock) {
  if (!lock || typeof lock !== 'object' || lock.format !== LOCK_FORMAT) fail('LOCK_FORMAT');
  if (!lock.source || typeof lock.source !== 'object' || !lock.source.archive || typeof lock.source.archive !== 'object') fail('LOCK_SOURCE');
  const archive = lock.source.archive;
  if (typeof archive.path !== 'string' || !archive.path) fail('LOCK_ARCHIVE_PATH');
  if (archive.url !== undefined && (typeof archive.url !== 'string' || !archive.url.startsWith('https://'))) fail('LOCK_ARCHIVE_URL');
  assertHex(archive.sha256, 'LOCK_ARCHIVE_SHA256');
  if (!isSafeInteger(archive.bytes, 1, LIMITS.maxArchiveBytes)) fail('LOCK_ARCHIVE_BYTES');
  if (!Array.isArray(lock.packages) || lock.packages.length !== 3) fail('LOCK_PACKAGES');
  const prefixes = new Set();
  const ids = new Set();
  const kinds = new Set();
  let generation = null;
  for (const pkg of lock.packages) {
    if (!pkg || typeof pkg !== 'object' || !PACKAGE_KINDS.has(pkg.kind)) fail('LOCK_PACKAGE_KIND');
    if (kinds.has(pkg.kind)) fail('LOCK_PACKAGE_KIND');
    kinds.add(pkg.kind);
    if (typeof pkg.id !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(pkg.id) || ids.has(pkg.id)) fail('LOCK_PACKAGE_ID');
    ids.add(pkg.id);
    assertSafePath(pkg.prefix, 'LOCK_PACKAGE_PREFIX');
    if (pkg.prefix.includes('/') || prefixes.has(pkg.prefix)) fail('LOCK_PACKAGE_PREFIX', pkg.prefix);
    prefixes.add(pkg.prefix);
    if (pkg.manifest_path !== packageManifestPath(pkg)) fail('LOCK_PACKAGE_MANIFEST_PATH');
    assertHex(pkg.manifest_sha256, 'LOCK_MANIFEST_SHA256');
    assertHex(pkg.tree_sha256, 'LOCK_TREE_SHA256');
    if (!isSafeInteger(pkg.file_count, 1, LIMITS.cloudflareMaxFiles)) fail('LOCK_FILE_COUNT');
    if (!isSafeInteger(pkg.bytes, 1, LIMITS.maxStagedBytes)) fail('LOCK_PACKAGE_BYTES');
    if (typeof pkg.generation !== 'string' || !pkg.generation || pkg.generation.length > 256) fail('LOCK_GENERATION');
    if (generation === null) generation = pkg.generation;
    else if (pkg.generation !== generation) fail('LOCK_GENERATION_MISMATCH');
    if (!pkg.status || typeof pkg.status !== 'object'
      || pkg.status.review_status !== 'pending_owner_review'
      || pkg.status.publication_authorized !== false
      || pkg.status.scientific_applicability !== 'unresolved') fail('LOCK_REVIEW_STATUS', pkg.id);
    if (pkg.record_count !== undefined && !isSafeInteger(pkg.record_count, 0, LIMITS.maxRecordCount)) fail('LOCK_RECORD_COUNT');
    if (pkg.claim_count !== undefined && !isSafeInteger(pkg.claim_count, 0, 4)) fail('LOCK_CLAIM_COUNT');
  }
  if (kinds.size !== PACKAGE_KINDS.size) fail('LOCK_PACKAGE_KIND');
  if (!lock.cloudflare || typeof lock.cloudflare !== 'object'
    || lock.cloudflare.max_files !== LIMITS.cloudflareMaxFiles
    || lock.cloudflare.max_file_bytes !== LIMITS.cloudflareMaxFileBytes) fail('LOCK_CLOUDFLARE_LIMITS');
  if (lock.cloudflare.plan_qualification !== 'required_before_deployment') fail('LOCK_PLAN_QUALIFICATION');
  return { archive, packages: lock.packages, prefixes: [...prefixes].sort(compareText) };
}

function packageFiles(files, prefix) {
  return files
    .filter(file => file.relative === prefix || file.relative.startsWith(`${prefix}/`))
    .map(file => ({ ...file, packageRelative: file.relative.slice(prefix.length + 1) }))
    .filter(file => file.packageRelative);
}

function addExpected(expected, pkg, relative, expectedSha, expectedBytes = null) {
  assertSafePath(relative, 'ASSET_REFERENCE_PATH');
  const global = `${pkg.prefix}/${relative}`;
  ensurePathUnderPrefixes(global, [pkg.prefix], 'ASSET_REFERENCE_PATH');
  assertHex(expectedSha, 'ASSET_REFERENCE_SHA256');
  const prior = expected.get(global);
  if (prior && (prior.sha256 !== expectedSha || (expectedBytes !== null && prior.bytes !== expectedBytes))) fail('ASSET_REFERENCE_CONFLICT', global);
  expected.set(global, { relative: global, sha256: expectedSha, bytes: expectedBytes });
}

async function packageJson(root, pkg, relative, maximum) {
  const file = path.join(root, pkg.prefix, relative);
  let result;
  try {
    result = await readJson(file, maximum);
  } catch (error) {
    if (error.code === 'ENOENT') fail('ASSET_MISSING_FILE', `${pkg.prefix}/${relative}`);
    throw error;
  }
  return { ...result, file };
}

function assertStatus(value, expected, code) {
  if (value !== expected) fail(code, `${String(value)}:${String(expected)}`);
}

async function inspectDictionary(root, pkg, manifest, expected) {
  if (manifest.format !== 'ushso.dictionary-review-package.v1') fail('ASSET_MANIFEST_CONTRACT', pkg.id);
  assertStatus(manifest.review_status, 'pending_owner_review', 'ASSET_REVIEW_STATUS');
  assertStatus(manifest.publication_authorized, false, 'ASSET_PUBLICATION_STATUS');
  assertStatus(manifest.canonical_records_changed, 0, 'ASSET_CANONICAL_CHANGE');
  if (!Array.isArray(manifest.records) || manifest.records.length > LIMITS.maxRecordCount) fail('ASSET_RECORD_COUNT', pkg.id);
  if (pkg.record_count !== undefined && manifest.records.length !== pkg.record_count) fail('ASSET_RECORD_COUNT', pkg.id);
  if (!isSafeInteger(manifest.variables, 0) || !isSafeInteger(manifest.pages, 0)) fail('ASSET_MANIFEST_COUNTS', pkg.id);
  if (!Array.isArray(manifest.records)) fail('ASSET_MANIFEST_RECORDS', pkg.id);
  const recordIds = new Set();
  for (const item of manifest.records) {
    if (!item || typeof item.record_id !== 'string' || recordIds.has(item.record_id)) fail('ASSET_DUPLICATE_RECORD', pkg.id);
    recordIds.add(item.record_id);
    const recordHash = sha256Text(item.record_id);
    if (item.file !== `records/${recordHash}.json`) fail('ASSET_RECORD_PATH', item.record_id);
    addExpected(expected, pkg, item.file, item.sha256);
    const { value: descriptor } = await packageJson(root, pkg, item.file, LIMITS.maxDescriptorBytes);
    if (descriptor.format !== 'ushso.dictionary-review.v1' || descriptor.record_id !== item.record_id
      || descriptor.generation !== pkg.generation || descriptor.review_status !== 'pending_owner_review'
      || descriptor.publication_authorized !== false || descriptor.schema_applicability !== 'unresolved') fail('ASSET_RECORD_STATUS', item.record_id);
    if (!Array.isArray(descriptor.pages) || !isSafeInteger(descriptor.variable_count, 0)) fail('ASSET_DESCRIPTOR_SHAPE', item.record_id);
    for (const page of descriptor.pages) {
      if (!page || !HEX.test(page.sha256) || !isSafeInteger(page.count, 1, 50) || !isSafeInteger(page.bytes, 1, LIMITS.maxPageBytes)) fail('ASSET_PAGE_BINDING', item.record_id);
      addExpected(expected, pkg, `pages/${page.sha256}.json`, page.sha256, page.bytes);
      const { value: rows, bytes } = await packageJson(root, pkg, `pages/${page.sha256}.json`, LIMITS.maxPageBytes);
      if (bytes.length !== page.bytes || !Array.isArray(rows) || rows.length !== page.count) fail('ASSET_PAGE_BINDING', item.record_id);
      for (const field of rows) {
        if (!field || typeof field.name !== 'string' || !field.name || field.schema_applicability === 'resolved') fail('ASSET_FIELD_STATUS', item.record_id);
      }
    }
    const parserArtifact = descriptor.parser_issues_artifact;
    if (parserArtifact !== undefined) {
      if (!parserArtifact || typeof parserArtifact !== 'object'
        || parserArtifact.format !== 'ushso.glyph-parser-issues.v1'
        || typeof parserArtifact.file !== 'string'
        || !/^parser-issues\/[a-f0-9]{64}\.json$/.test(parserArtifact.file)
        || !HEX.test(parserArtifact.sha256)
        || !isSafeInteger(parserArtifact.bytes, 1, LIMITS.maxParserIssueBytes)
        || !isSafeInteger(parserArtifact.count, 0, LIMITS.maxRecordCount)
        || parserArtifact.all_parser_issues_preserved !== true
        || parserArtifact.source !== 'glyph-v2-qualified-replay') fail('ASSET_PARSER_ISSUE_BINDING', item.record_id);
      addExpected(expected, pkg, parserArtifact.file, parserArtifact.sha256, parserArtifact.bytes);
      const { value: parserIssues, bytes } = await packageJson(root, pkg, parserArtifact.file, LIMITS.maxParserIssueBytes);
      if (bytes.length !== parserArtifact.bytes || !Array.isArray(parserIssues) || parserIssues.length !== parserArtifact.count) {
        fail('ASSET_PARSER_ISSUE_BINDING', item.record_id);
      }
    }
    const supplements = new Map();
    for (const binding of descriptor.supplements ?? []) {
      if (!binding || !HEX.test(binding.field_sha256) || !HEX.test(binding.descriptor_sha256) || supplements.has(binding.field_sha256)) fail('ASSET_SUPPLEMENT_BINDING', item.record_id);
      supplements.set(binding.field_sha256, binding.descriptor_sha256);
      const relative = `supplements/${binding.descriptor_sha256}.json`;
      addExpected(expected, pkg, relative, binding.descriptor_sha256);
      const { value: supplement } = await packageJson(root, pkg, relative, LIMITS.maxDescriptorBytes);
      if (supplement.format !== 'ushso.dictionary-field-supplement.v1' || supplement.field_sha256 !== binding.field_sha256
        || supplement.review_status !== 'pending_owner_review' || supplement.publication_authorized !== false) fail('ASSET_SUPPLEMENT_STATUS', item.record_id);
      for (const fragment of supplement.fragments ?? []) {
        if (!fragment || !HEX.test(fragment.sha256) || !isSafeInteger(fragment.bytes, 1, LIMITS.maxPageBytes)) fail('ASSET_FRAGMENT_BINDING', item.record_id);
        addExpected(expected, pkg, `supplements/${fragment.sha256}.json`, fragment.sha256, fragment.bytes);
      }
    }
    for (const issue of descriptor.isolated_fields ?? []) {
      if (issue.issue_file) {
        if (issue.issue_file !== `issues/${issue.issue_sha256}.json`) fail('ASSET_ISSUE_PATH', item.record_id);
        addExpected(expected, pkg, issue.issue_file, issue.issue_sha256);
      }
    }
    if (descriptor.source_evidence?.unowned_context) {
      const context = descriptor.source_evidence.unowned_context;
      if (context.file !== `unowned-context/${context.sha256}.json`) fail('ASSET_CONTEXT_PATH', item.record_id);
      addExpected(expected, pkg, context.file, context.sha256);
    }
  }
}

async function inspectScientificReview(root, pkg, manifest) {
  if (manifest.schema !== 'ushso.scientific-review-assets.v1' || manifest.owner_decision !== null
    || manifest.publication_authorized !== false || !Array.isArray(manifest.claims) || manifest.claims.length > 4) fail('ASSET_MANIFEST_CONTRACT', pkg.id);
  if (pkg.claim_count !== undefined && manifest.claims.length !== pkg.claim_count) fail('ASSET_CLAIM_COUNT', pkg.id);
  for (const row of manifest.claims) {
    const claim = row?.claim;
    if (!claim || claim.owner_decision !== null || claim.proposed_value?.state !== 'pending_owner_review') fail('ASSET_CLAIM_STATUS', pkg.id);
  }
}

async function inspectScientificConflicts(root, pkg, manifest, expected) {
  if (manifest.schema !== 'ushso.scientific-conflicts-package.v1' || manifest.review_status !== 'pending_owner_review'
    || manifest.owner_decision !== null || manifest.publication_authorized !== false || manifest.canonical_records_changed !== 0
    || !Array.isArray(manifest.records) || manifest.records.length > 20) fail('ASSET_MANIFEST_CONTRACT', pkg.id);
  if (pkg.record_count !== undefined && manifest.records.length !== pkg.record_count) fail('ASSET_RECORD_COUNT', pkg.id);
  const ids = new Set();
  for (const item of manifest.records) {
    if (!item || typeof item.record_id !== 'string' || ids.has(item.record_id) || !HEX.test(item.sha256)) fail('ASSET_RECORD_BINDING', pkg.id);
    ids.add(item.record_id);
    const relative = `records/${sha256Text(item.record_id)}.json`;
    addExpected(expected, pkg, relative, item.sha256);
    const { value: descriptor } = await packageJson(root, pkg, relative, LIMITS.maxDescriptorBytes);
    if (descriptor.schema !== 'ushso.scientific-conflicts-record.v1' || descriptor.record_id !== item.record_id
      || descriptor.generation !== pkg.generation || descriptor.review_status !== 'pending_owner_review'
      || descriptor.owner_decision !== null || descriptor.publication_authorized !== false || descriptor.canonical_records_changed !== 0
      || !Array.isArray(descriptor.pages)) fail('ASSET_RECORD_STATUS', item.record_id);
    for (const page of descriptor.pages) {
      if (!page || !HEX.test(page.sha256) || !isSafeInteger(page.count, 1, 10) || !isSafeInteger(page.bytes, 1, LIMITS.maxPageBytes)) fail('ASSET_PAGE_BINDING', item.record_id);
      addExpected(expected, pkg, `pages/${page.sha256}.json`, page.sha256, page.bytes);
      const { value: rows, bytes } = await packageJson(root, pkg, `pages/${page.sha256}.json`, LIMITS.maxPageBytes);
      if (bytes.length !== page.bytes || !Array.isArray(rows) || rows.length !== page.count) fail('ASSET_PAGE_BINDING', item.record_id);
      if (rows.some(row => row?.review_status !== 'pending_owner_review' || row.owner_decision !== null || row.publication_authorized !== false || row.eligible_for_schema_promotion !== false)) fail('ASSET_ROW_STATUS', item.record_id);
    }
  }
}

async function inspectPackage(root, pkg, allFiles) {
  const expected = new Map();
  const manifestFile = path.join(root, pkg.manifest_path);
  let manifestDigest;
  try {
    manifestDigest = await hashFile(manifestFile, LIMITS.maxManifestBytes);
  } catch (error) {
    if (error.code === 'ENOENT') fail('ASSET_MISSING_FILE', pkg.manifest_path);
    throw error;
  }
  if (manifestDigest.sha256 !== pkg.manifest_sha256) fail('ASSET_MANIFEST_HASH_MISMATCH', pkg.id);
  addExpected(expected, pkg, 'manifest.json', pkg.manifest_sha256, manifestDigest.bytes);
  const { value: manifest } = await readJson(manifestFile, LIMITS.maxManifestBytes);
  if (manifest.generation !== pkg.generation) fail('ASSET_GENERATION_MISMATCH', pkg.id);
  if (pkg.kind === 'dictionary') await inspectDictionary(root, pkg, manifest, expected);
  else if (pkg.kind === 'scientific-review') await inspectScientificReview(root, pkg, manifest);
  else await inspectScientificConflicts(root, pkg, manifest, expected);
  const actual = new Map(packageFiles(allFiles, pkg.prefix).map(file => [file.relative, file]));
  for (const [relative, reference] of expected) {
    const file = actual.get(relative);
    if (!file) fail('ASSET_MISSING_FILE', relative);
    if (file.sha256 !== reference.sha256) fail('ASSET_HASH_MISMATCH', relative);
    if (reference.bytes !== null && file.bytes !== reference.bytes) fail('ASSET_BYTES_MISMATCH', relative);
  }
  for (const relative of actual.keys()) if (!expected.has(relative)) fail('ASSET_UNEXPECTED_FILE', relative);
  const files = [...actual.values()];
  if (files.length !== pkg.file_count) fail('ASSET_FILE_COUNT_MISMATCH', pkg.id);
  const bytes = files.reduce((total, file) => total + file.bytes, 0);
  if (bytes !== pkg.bytes) fail('ASSET_BYTES_MISMATCH', pkg.id);
  if (treeDigest(files) !== pkg.tree_sha256) fail('ASSET_TREE_HASH_MISMATCH', pkg.id);
  return { manifest, files, bytes, file_count: files.length, tree_sha256: treeDigest(files) };
}

async function verifyArchive(archivePath, archive) {
  let stat;
  try {
    const link = await fs.lstat(archivePath);
    if (link.isSymbolicLink()) fail('SOURCE_ARCHIVE_SYMLINK', archivePath);
    stat = await fs.stat(archivePath);
  } catch (error) {
    if (error.code === 'ENOENT') fail('SOURCE_ARCHIVE_UNAVAILABLE', archivePath);
    throw error;
  }
  if (!stat.isFile()) fail('SOURCE_ARCHIVE_NOT_FILE', archivePath);
  if (stat.size !== archive.bytes) fail('SOURCE_ARCHIVE_BYTES_MISMATCH', archivePath);
  if (stat.size > LIMITS.maxArchiveBytes) fail('SOURCE_ARCHIVE_SIZE_LIMIT', archivePath);
  const digest = await hashFile(archivePath, LIMITS.maxArchiveBytes);
  if (digest.sha256 !== archive.sha256) fail('SOURCE_ARCHIVE_HASH_MISMATCH', archivePath);
  return digest;
}

function lockDigestFromObject(lock) {
  return sha256(Buffer.from(`${JSON.stringify(lock)}\n`, 'utf8'));
}

function indexFor(lock, lockSha256, archiveSha256, packageResults) {
  const packages = packageResults.map(({ pkg, result }) => ({
    id: pkg.id,
    kind: pkg.kind,
    prefix: pkg.prefix,
    manifest_path: pkg.manifest_path,
    manifest_sha256: pkg.manifest_sha256,
    generation: pkg.generation,
    tree_sha256: result.tree_sha256,
    file_count: result.file_count,
    bytes: result.bytes,
    status: {
      review_status: pkg.status.review_status,
      publication_authorized: false,
      scientific_applicability: 'unresolved',
    },
  }));
  const packageFilesCount = packages.reduce((total, pkg) => total + pkg.file_count, 0);
  const packageBytes = packages.reduce((total, pkg) => total + pkg.bytes, 0);
  const maximumFileBytes = Math.max(...packageResults.flatMap(({ result }) => result.files.map(file => file.bytes)), 0);
  const indexWithoutCloudflare = {
    schema: INDEX_FORMAT,
    lock_format: LOCK_FORMAT,
    lock_sha256: lockSha256,
    source_archive_sha256: archiveSha256,
    source_archive_bytes: lock.source.archive.bytes,
    generation: packages[0]?.generation ?? null,
    review_status: 'pending_owner_review',
    publication_authorized: false,
    scientific_applicability: 'unresolved',
    packages,
  };
  const observedFileCount = packageFilesCount + 1;
  let observedBytes = packageBytes;
  let indexBytes = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const cloudflare = {
      scope: 'research_asset_staging_only',
      observed_file_count: observedFileCount,
      observed_bytes: observedBytes,
      maximum_file_bytes: Math.max(maximumFileBytes, indexBytes),
      max_files: LIMITS.cloudflareMaxFiles,
      max_file_bytes: LIMITS.cloudflareMaxFileBytes,
      within_known_upper_bound: observedFileCount <= LIMITS.cloudflareMaxFiles && Math.max(maximumFileBytes, indexBytes) <= LIMITS.cloudflareMaxFileBytes,
      paid_plan_file_limit_satisfied: observedFileCount <= LIMITS.cloudflareMaxFiles,
      free_plan_file_limit_satisfied: observedFileCount <= 20_000,
      account_plan: 'unknown',
      plan_qualification: 'required_before_deployment',
      packing_required: null,
      packing_decision: 'pending_account_plan_qualification_and_final_bundle_count',
      final_bundle_qualification_required: true,
    };
    const candidate = Buffer.byteLength(`${JSON.stringify({ ...indexWithoutCloudflare, cloudflare }, null, 2)}\n`);
    const nextBytes = packageBytes + candidate;
    indexBytes = candidate;
    if (nextBytes === observedBytes) break;
    observedBytes = nextBytes;
  }
  return {
    ...indexWithoutCloudflare,
    cloudflare: {
      scope: 'research_asset_staging_only',
      observed_file_count: observedFileCount,
      observed_bytes: observedBytes,
      maximum_file_bytes: Math.max(maximumFileBytes, indexBytes),
      max_files: LIMITS.cloudflareMaxFiles,
      max_file_bytes: LIMITS.cloudflareMaxFileBytes,
      within_known_upper_bound: observedFileCount <= LIMITS.cloudflareMaxFiles && Math.max(maximumFileBytes, indexBytes) <= LIMITS.cloudflareMaxFileBytes,
      paid_plan_file_limit_satisfied: observedFileCount <= LIMITS.cloudflareMaxFiles,
      free_plan_file_limit_satisfied: observedFileCount <= 20_000,
      account_plan: 'unknown',
      plan_qualification: 'required_before_deployment',
      packing_required: null,
      packing_decision: 'pending_account_plan_qualification_and_final_bundle_count',
      final_bundle_qualification_required: true,
    },
  };
}

async function copyPackageFiles(packageResult, targetRoot, fileSystem = fs) {
  for (const file of packageResult.files.sort((a, b) => compareText(a.relative, b.relative))) {
    const target = path.join(targetRoot, file.relative);
    await fileSystem.mkdir(path.dirname(target), { recursive: true });
    await fileSystem.copyFile(file.absolute, target, fs.constants?.COPYFILE_EXCL ?? 0);
  }
}

async function exists(file, fileSystem = fs) {
  try {
    await fileSystem.lstat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function installAtomically({ outputRoot, packageResults, indexBytes, fileSystem = fs }) {
  await fileSystem.mkdir(outputRoot, { recursive: true });
  const stagingRoot = await fileSystem.mkdtemp(path.join(outputRoot, '.research-assets-staging-'));
  let backupRoot = null;
  const targets = [...packageResults.map(({ pkg }) => pkg.prefix), 'research-assets-v1'];
  const moved = [];
  const installed = [];
  let preserveBackup = false;
  try {
    for (const { result } of packageResults) await copyPackageFiles(result, stagingRoot, fileSystem);
    const indexTarget = path.join(stagingRoot, 'research-assets-v1', 'index.json');
    await fileSystem.mkdir(path.dirname(indexTarget), { recursive: true });
    await fileSystem.writeFile(indexTarget, indexBytes, { flag: 'wx' });
    backupRoot = await fileSystem.mkdtemp(path.join(outputRoot, '.research-assets-backup-'));
    for (const name of targets) {
      const target = path.join(outputRoot, name);
      if (await exists(target, fileSystem)) {
        const backup = path.join(backupRoot, name);
        await fileSystem.mkdir(path.dirname(backup), { recursive: true });
        await fileSystem.rename(target, backup);
        moved.push({ target, backup });
      }
    }
    for (const name of targets) {
      const staged = path.join(stagingRoot, name);
      const target = path.join(outputRoot, name);
      if (await exists(staged, fileSystem)) {
        await fileSystem.rename(staged, target);
        installed.push(target);
      }
    }
  } catch (error) {
    // Remove only paths installed by this attempt. Untouched targets may be
    // the last known-good release and must survive copy, backup, or install
    // failures. Restore every original that was moved to the backup tree.
    const rollbackErrors = [error];
    for (const target of installed.reverse()) {
      try {
        await fileSystem.rm(target, { recursive: true, force: true });
      } catch (rollbackError) {
        preserveBackup = true;
        rollbackErrors.push(rollbackError);
      }
    }
    for (const { target, backup } of moved.reverse()) {
      try {
        if (!await exists(backup, fileSystem)) continue;
        await fileSystem.rename(backup, target);
      } catch (rollbackError) {
        preserveBackup = true;
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 1) {
      const rollbackFailure = new AggregateError(rollbackErrors, `INSTALL_ROLLBACK_INCOMPLETE:${backupRoot ?? 'no-backup'}`);
      rollbackFailure.code = 'INSTALL_ROLLBACK_INCOMPLETE';
      rollbackFailure.recoveryPath = backupRoot;
      throw rollbackFailure;
    }
    throw error;
  } finally {
    await fileSystem.rm(stagingRoot, { recursive: true, force: true });
    if (backupRoot && !preserveBackup) await fileSystem.rm(backupRoot, { recursive: true, force: true });
  }
}

export async function loadLock(lockFile) {
  const bytes = await fs.readFile(lockFile);
  let lock;
  try {
    lock = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail('LOCK_INVALID_JSON', lockFile);
  }
  validateLock(lock);
  return { lock, lock_sha256: sha256(bytes), bytes };
}

export async function stageResearchAssets({ lock, lockSha256 = null, archivePath, outputRoot, temporaryBase = process.env.TMPDIR ?? process.env.RUNNER_TEMP, archiveLimits = {}, installFileSystem = fs }) {
  validateLock(lock);
  if (!archivePath || typeof archivePath !== 'string') fail('SOURCE_ARCHIVE_PATH');
  if (!outputRoot || typeof outputRoot !== 'string') fail('OUTPUT_ROOT');
  if (!temporaryBase || typeof temporaryBase !== 'string' || !path.isAbsolute(temporaryBase)) fail('TEMP_ROOT_REQUIRED');
  const archive = await verifyArchive(archivePath, lock.source.archive);
  const tempRoot = await fs.mkdtemp(path.join(temporaryBase, `ushso-research-assets-${process.pid}-`));
  try {
    await extractArchive(archivePath, tempRoot, lock.packages.map(pkg => pkg.prefix), archiveLimits);
    // The source was hashed before opening the extractor. Verify it again
    // after extraction so a replacement or in-place mutation during the read
    // cannot produce a staged tree whose lock no longer describes its source.
    const stableArchive = await verifyArchive(archivePath, lock.source.archive);
    const allFiles = await walkFiles(tempRoot);
    const packageResults = [];
    for (const pkg of [...lock.packages].sort((a, b) => compareText(a.id, b.id))) {
      const result = await inspectPackage(tempRoot, pkg, allFiles);
      packageResults.push({ pkg, result });
    }
    const index = indexFor(lock, lockSha256 ?? lockDigestFromObject(lock), stableArchive.sha256, packageResults);
    const indexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`, 'utf8');
    if (indexBytes.length > LIMITS.cloudflareMaxFileBytes) fail('CLOUDFLARE_FILE_SIZE_LIMIT', 'research-assets-v1/index.json');
    if (!index.cloudflare.within_known_upper_bound) fail('CLOUDFLARE_BUNDLE_LIMIT');
    await installAtomically({ outputRoot, packageResults, indexBytes, fileSystem: installFileSystem });
    return { index, index_sha256: sha256(indexBytes), index_bytes: indexBytes.length, outputRoot };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const result = { lockFile: null, archivePath: null, outputRoot: null, checkOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check-only') result.checkOnly = true;
    else if (arg === '--lock' || arg === '--archive' || arg === '--source' || arg === '--output') {
      const value = argv[++index];
      if (!value) fail('CLI_ARGUMENT', arg);
      if (arg === '--lock') result.lockFile = value;
      else if (arg === '--output') result.outputRoot = value;
      else result.archivePath = value;
    } else fail('CLI_ARGUMENT', arg);
  }
  return result;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = parseArgs(process.argv.slice(2));
  const lockFile = path.resolve(args.lockFile ?? path.join(root, 'config/research-assets.lock.json'));
  const loaded = await loadLock(lockFile);
  const configuredArchive = args.archivePath ?? process.env.USHSO_RESEARCH_ASSET_SOURCE ?? loaded.lock.source.archive.path;
  const archivePath = path.isAbsolute(configuredArchive) ? configuredArchive : path.resolve(path.dirname(lockFile), configuredArchive);
  const outputRoot = path.resolve(args.outputRoot ?? path.join(root, 'apps/web/public'));
  if (args.checkOnly) {
    const archive = await verifyArchive(archivePath, loaded.lock.source.archive);
    const temporaryBase = process.env.TMPDIR ?? process.env.RUNNER_TEMP;
    if (!temporaryBase || !path.isAbsolute(temporaryBase)) fail('TEMP_ROOT_REQUIRED');
    const tempRoot = await fs.mkdtemp(path.join(temporaryBase, `ushso-research-assets-check-${process.pid}-`));
    try {
      await extractArchive(archivePath, tempRoot, loaded.lock.packages.map(pkg => pkg.prefix));
      const allFiles = await walkFiles(tempRoot);
      for (const pkg of [...loaded.lock.packages].sort((a, b) => compareText(a.id, b.id))) await inspectPackage(tempRoot, pkg, allFiles);
      process.stdout.write(`${JSON.stringify({ status: 'PASS', archive_sha256: archive.sha256, lock_sha256: loaded.lock_sha256 })}\n`);
      return;
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
  const result = await stageResearchAssets({ lock: loaded.lock, lockSha256: loaded.lock_sha256, archivePath, outputRoot });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', archive_sha256: result.index.source_archive_sha256, lock_sha256: loaded.lock_sha256, index_sha256: result.index_sha256, packages: result.index.packages.length, staged_file_count: result.index.cloudflare.observed_file_count })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`RESEARCH_ASSET_STAGE_FAILED:${error.message}\n`);
    process.exitCode = 1;
  });
}

export function measureAssetPage(entries = [], { pageSize = 50, maxPageBytes = LIMITS.maxPageBytes } = {}) {
  if (!Array.isArray(entries)) fail('DICTIONARY_ENTRIES_REQUIRED');
  const pages = [];
  let current = [];
  let bytes = 0;
  for (const entry of entries) {
    const encoded = JSON.stringify(entry);
    const size = Buffer.byteLength(encoded);
    if (size > maxPageBytes) fail('DICTIONARY_ENTRY_TOO_LARGE');
    if (current.length >= pageSize || bytes + size > maxPageBytes) {
      if (current.length) pages.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += size;
  }
  if (current.length) pages.push(current);
  return { page_count: pages.length, page_size: pageSize, max_page_bytes: maxPageBytes, pages, asset_count: entries.length };
}
