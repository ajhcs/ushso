import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { LIMITS, sha256, sha256Text, stageResearchAssets, treeDigest, validateLock } from '../scripts/stage-research-assets.mjs';

const tempBase = process.env.TMPDIR ?? process.env.RUNNER_TEMP;
assert.ok(tempBase && path.isAbsolute(tempBase), 'tests require TMPDIR or RUNNER_TEMP');

function octal(value, width) {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function tarHeader(name, size, type = '0') {
  const header = Buffer.alloc(512, 0);
  const write = (offset, length, value) => Buffer.from(String(value), 'utf8').copy(header, offset, 0, length);
  // USTAR stores a long path as a 155-byte prefix plus a 100-byte basename.
  // The real package has record paths long enough to exercise this split.
  let nameField = name;
  let prefixField = '';
  if (Buffer.byteLength(nameField) > 100) {
    const split = nameField.lastIndexOf('/', 100);
    assert.ok(split > 0, `test tar path cannot fit USTAR fields: ${name}`);
    prefixField = nameField.slice(0, split);
    nameField = nameField.slice(split + 1);
    assert.ok(Buffer.byteLength(prefixField) <= 155 && Buffer.byteLength(nameField) <= 100);
  }
  write(0, 100, nameField);
  write(100, 8, octal(0o644, 8));
  write(108, 8, octal(0, 8));
  write(116, 8, octal(0, 8));
  write(124, 12, octal(size, 12));
  write(136, 12, octal(0, 12));
  header.fill(0x20, 148, 156);
  write(156, 1, type);
  write(257, 6, 'ustar');
  write(263, 2, '00');
  write(345, 155, prefixField);
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  Buffer.from(octal(checksum, 8), 'ascii').copy(header, 148);
  return header;
}

function tarFile(name, bytes) {
  const body = Buffer.from(bytes);
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([tarHeader(name, body.length), body, padding]);
}

async function sourceFiles(root) {
  const result = [];
  async function visit(current, relative = '') {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute, next);
      else result.push({ relative: next, absolute, bytes: await fs.readFile(absolute) });
    }
  }
  await visit(root);
  return result;
}

async function writeArchive(root, archive, extraEntries = []) {
  const files = await sourceFiles(root);
  const body = Buffer.concat([
    ...files.map(file => tarFile(file.relative, file.bytes)),
    ...extraEntries,
    Buffer.alloc(1024),
  ]);
  await fs.writeFile(archive, body);
  return { bytes: body.length, sha256: sha256(body) };
}

async function packageStats(root, prefix) {
  const files = (await sourceFiles(path.join(root, prefix))).map(file => ({
    relative: `${prefix}/${file.relative}`,
    bytes: file.bytes.length,
    sha256: sha256(file.bytes),
  }));
  return { file_count: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), tree_sha256: treeDigest(files) };
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(tempBase, 'ushso-research-staging-fixture-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  for (const prefix of ['research-dictionaries-v1', 'scientific-review-v1', 'scientific-conflicts-v1']) await fs.mkdir(path.join(source, prefix), { recursive: true });
  const generation = 'generation-test';
  const page = Buffer.from(JSON.stringify([{ name: 'field_a', evidence_ids: [] }]));
  const pageSha = sha256(page);
  const parserIssues = Buffer.from(JSON.stringify([{ code: 'PARSER_TEST', message: 'retained parser issue' }]));
  const parserIssuesSha = sha256(parserIssues);
  const recordId = 'record-a';
  const recordFile = `records/${sha256Text(recordId)}.json`;
  const descriptor = Buffer.from(JSON.stringify({
    format: 'ushso.dictionary-review.v1', record_id: recordId, generation,
    publication_authorized: false, review_status: 'pending_owner_review', schema_applicability: 'unresolved',
    variable_count: 1, full_field_count: 1, supplemental_field_count: 0, isolated_fields: [], supplements: [],
    pages: [{ sha256: pageSha, count: 1, bytes: page.length }],
    parser_issues_artifact: {
      format: 'ushso.glyph-parser-issues.v1',
      file: `parser-issues/${parserIssuesSha}.json`, sha256: parserIssuesSha,
      bytes: parserIssues.length, count: 1, all_parser_issues_preserved: true,
      source: 'glyph-v2-qualified-replay',
    },
  }));
  const dictionaryManifest = Buffer.from(JSON.stringify({
    format: 'ushso.dictionary-review-package.v1', generation, review_status: 'pending_owner_review', publication_authorized: false,
    canonical_records_changed: 0, records: [{ record_id: recordId, file: recordFile, sha256: sha256(descriptor), variables: 1, isolated_fields: 0, full_fields: 1, supplemental_fields: 0 }],
    variables: 1, pages: 1, maximum_page_bytes: page.length,
  }));
  await fs.mkdir(path.join(source, 'research-dictionaries-v1', 'records'), { recursive: true });
  await fs.mkdir(path.join(source, 'research-dictionaries-v1', 'pages'), { recursive: true });
  await fs.mkdir(path.join(source, 'research-dictionaries-v1', 'parser-issues'), { recursive: true });
  await fs.writeFile(path.join(source, 'research-dictionaries-v1', 'manifest.json'), dictionaryManifest);
  await fs.writeFile(path.join(source, 'research-dictionaries-v1', recordFile), descriptor);
  await fs.writeFile(path.join(source, 'research-dictionaries-v1', 'pages', `${pageSha}.json`), page);
  await fs.writeFile(path.join(source, 'research-dictionaries-v1', 'parser-issues', `${parserIssuesSha}.json`), parserIssues);
  await fs.writeFile(path.join(source, 'scientific-review-v1', 'manifest.json'), JSON.stringify({
    schema: 'ushso.scientific-review-assets.v1', generation, draft_sha256: sha256Text('draft'), source_packet_sha256: sha256Text('source'), owner_decision: null, publication_authorized: false, claims: [],
  }));
  await fs.writeFile(path.join(source, 'scientific-conflicts-v1', 'manifest.json'), JSON.stringify({
    schema: 'ushso.scientific-conflicts-package.v1', generation, source_packet_sha256: sha256Text('source'), draft_sha256: sha256Text('draft'),
    review_status: 'pending_owner_review', owner_decision: null, publication_authorized: false, canonical_records_changed: 0, records: [],
  }));
  const archivePath = path.join(root, 'research-assets.tar');
  const archive = await writeArchive(source, archivePath);
  const packages = [];
  for (const [id, kind, prefix, extra] of [
    ['dictionary', 'dictionary', 'research-dictionaries-v1', { record_count: 1 }],
    ['scientific-review', 'scientific-review', 'scientific-review-v1', { claim_count: 0 }],
    ['scientific-conflicts', 'scientific-conflicts', 'scientific-conflicts-v1', { record_count: 0 }],
  ]) {
    const manifestPath = path.join(source, prefix, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const stats = await packageStats(source, prefix);
    packages.push({ id, kind, prefix, manifest_path: `${prefix}/manifest.json`, manifest_sha256: sha256(await fs.readFile(manifestPath)), generation: manifest.generation, ...stats, ...extra,
      status: { review_status: 'pending_owner_review', publication_authorized: false, scientific_applicability: 'unresolved' } });
  }
  const lock = { format: 'ushso.research-assets-lock.v1', source: { archive: { path: archivePath, ...archive } }, packages,
    cloudflare: { max_files: LIMITS.cloudflareMaxFiles, max_file_bytes: LIMITS.cloudflareMaxFileBytes, plan_qualification: 'required_before_deployment' } };
  return { root, source, archivePath, archive, lock, parserIssuesSha };
}

async function errorCode(promise, expected) {
  await assert.rejects(promise, error => error?.code === expected || error?.message?.startsWith(`${expected}:`), `expected ${expected}`);
}

function pinnedArchive(lock, archivePath, archive) {
  return { ...lock, source: { archive: { ...lock.source.archive, path: archivePath, ...archive } } };
}

function failOnceAt(method, callNumber) {
  let calls = 0;
  return new Proxy(fs, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== method) return value;
      return async (...args) => {
        calls += 1;
        if (calls === callNumber) {
          const error = new Error(`injected ${method} failure`);
          error.code = 'INJECTED_INSTALL_FAILURE';
          throw error;
        }
        return value(...args);
      };
    },
  });
}

function failDuringRestore() {
  let installFailed = false;
  let restoreFailed = false;
  return new Proxy(fs, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== 'rename') return value;
      return async (from, to, ...rest) => {
        if (!installFailed && String(from).includes('.research-assets-staging-')) {
          installFailed = true;
          const error = new Error('injected install failure');
          error.code = 'INJECTED_RESTORE_FAILURE';
          throw error;
        }
        if (!restoreFailed && String(from).includes('.research-assets-backup-')) {
          restoreFailed = true;
          const error = new Error('injected restore failure');
          error.code = 'INJECTED_RESTORE_FAILURE';
          throw error;
        }
        return value(from, to, ...rest);
      };
    },
  });
}

test('imports an exact archive and emits a deterministic bounded index', async t => {
  const f = await fixture(t);
  const outA = path.join(f.root, 'out-a');
  const outB = path.join(f.root, 'out-b');
  const first = await stageResearchAssets({ lock: f.lock, lockSha256: sha256(Buffer.from(`${JSON.stringify(f.lock)}\n`)), archivePath: f.archivePath, outputRoot: outA, temporaryBase: tempBase });
  const second = await stageResearchAssets({ lock: f.lock, lockSha256: sha256(Buffer.from(`${JSON.stringify(f.lock)}\n`)), archivePath: f.archivePath, outputRoot: outB, temporaryBase: tempBase });
  const firstIndex = await fs.readFile(path.join(outA, 'research-assets-v1/index.json'), 'utf8');
  const secondIndex = await fs.readFile(path.join(outB, 'research-assets-v1/index.json'), 'utf8');
  assert.equal(firstIndex, secondIndex);
  assert.equal(first.index_sha256, second.index_sha256);
  assert.equal(first.index.cloudflare.within_known_upper_bound, true);
  assert.equal(first.index.cloudflare.free_plan_file_limit_satisfied, true);
  assert.equal(first.index.cloudflare.packing_required, null);
  assert.equal(first.index.cloudflare.plan_qualification, 'required_before_deployment');
  assert.equal(first.index.review_status, 'pending_owner_review');
  assert.equal(first.index.publication_authorized, false);
  assert.equal(first.index.scientific_applicability, 'unresolved');
  assert.equal(first.index.source_archive_bytes, f.archive.bytes);
  assert.equal(first.index.source_archive_sha256, f.archive.sha256);
  assert.equal(first.index.packages.length, 3);
  assert.equal(JSON.stringify(first.index).includes(f.archivePath), false);
  assert.equal(await fs.readFile(path.join(outA, 'research-dictionaries-v1/manifest.json'), 'utf8'), await fs.readFile(path.join(f.source, 'research-dictionaries-v1/manifest.json'), 'utf8'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(outA, 'research-dictionaries-v1', 'parser-issues', `${f.parserIssuesSha}.json`))), [{ code: 'PARSER_TEST', message: 'retained parser issue' }]);
});

test('lock validation requires all three bounded review packages and explicit plan qualification', async t => {
  const f = await fixture(t);
  validateLock(f.lock);
  validateLock({ ...f.lock, source: { archive: { ...f.lock.source.archive, url: 'https://github.com/example/ushso/releases/download/research-assets/research-assets.tar.gz' } } });
  await errorCode(Promise.resolve().then(() => validateLock({ ...f.lock, cloudflare: { ...f.lock.cloudflare, max_files: 20_000 } })), 'LOCK_CLOUDFLARE_LIMITS');
  await errorCode(Promise.resolve().then(() => validateLock({ ...f.lock, packages: f.lock.packages.slice(0, 2) })), 'LOCK_PACKAGES');
  await errorCode(Promise.resolve().then(() => validateLock({ ...f.lock, packages: f.lock.packages.map(pkg => pkg.id === 'scientific-review' ? { ...pkg, kind: 'dictionary' } : pkg) })), 'LOCK_PACKAGE_KIND');
  await errorCode(Promise.resolve().then(() => validateLock({ ...f.lock, packages: f.lock.packages.map(pkg => pkg.id === 'scientific-review' ? { ...pkg, generation: 'other-generation' } : pkg) })), 'LOCK_GENERATION_MISMATCH');
  await errorCode(Promise.resolve().then(() => validateLock({ ...f.lock, source: { archive: { ...f.lock.source.archive, url: 'http://example.test/archive.tar' } } })), 'LOCK_ARCHIVE_URL');
  await errorCode(Promise.resolve().then(() => validateLock({ ...f.lock, packages: f.lock.packages.map(pkg => pkg.id === 'dictionary' ? { ...pkg, status: { ...pkg.status, publication_authorized: true } } : pkg) })), 'LOCK_REVIEW_STATUS');
});

test('archive bytes must match the committed archive digest before extraction', async t => {
  const f = await fixture(t);
  const bytes = await fs.readFile(f.archivePath);
  bytes[bytes.length - 1025] ^= 1;
  await fs.writeFile(f.archivePath, bytes);
  await errorCode(stageResearchAssets({ lock: f.lock, archivePath: f.archivePath, outputRoot: path.join(f.root, 'out'), temporaryBase: tempBase }), 'SOURCE_ARCHIVE_HASH_MISMATCH');
  await assert.rejects(fs.stat(path.join(f.root, 'out')), { code: 'ENOENT' });
});

test('changed archive with a new archive pin cannot hide a missing referenced file', async t => {
  const f = await fixture(t);
  const sourceFilesList = await sourceFiles(f.source);
  const withoutPage = sourceFilesList.filter(file => !file.relative.includes('/pages/'));
  const archiveBytes = Buffer.concat([...withoutPage.map(file => tarFile(file.relative, file.bytes)), Buffer.alloc(1024)]);
  await fs.writeFile(f.archivePath, archiveBytes);
  const lock = { ...f.lock, source: { archive: { ...f.lock.source.archive, bytes: archiveBytes.length, sha256: sha256(archiveBytes) } } };
  await errorCode(stageResearchAssets({ lock, archivePath: f.archivePath, outputRoot: path.join(f.root, 'out'), temporaryBase: tempBase }), 'ASSET_MISSING_FILE');
});

test('unexpected files and tar symlinks are rejected', async t => {
  const f = await fixture(t);
  const extraArchive = path.join(f.root, 'extra.tar');
  const extra = await writeArchive(f.source, extraArchive, [tarFile('research-dictionaries-v1/extra.json', Buffer.from('{}'))]);
  const extraLock = { ...f.lock, source: { archive: { ...f.lock.source.archive, ...extra } } };
  await errorCode(stageResearchAssets({ lock: extraLock, archivePath: extraArchive, outputRoot: path.join(f.root, 'extra-out'), temporaryBase: tempBase }), 'ASSET_UNEXPECTED_FILE');
  const symlinkArchive = path.join(f.root, 'symlink.tar');
  const symlinkBody = Buffer.concat([tarHeader('research-dictionaries-v1/link', 0, '2'), Buffer.alloc(1024)]);
  await fs.writeFile(symlinkArchive, symlinkBody);
  const symlinkLock = { ...f.lock, source: { archive: { ...f.lock.source.archive, bytes: symlinkBody.length, sha256: sha256(symlinkBody) } } };
  await errorCode(stageResearchAssets({ lock: symlinkLock, archivePath: symlinkArchive, outputRoot: path.join(f.root, 'symlink-out'), temporaryBase: tempBase }), 'ARCHIVE_SPECIAL_ENTRY');
});

test('archive entries over the Cloudflare per-file bound fail before package parsing', async t => {
  const f = await fixture(t);
  const largeArchive = path.join(f.root, 'large.tar');
  const largeBody = Buffer.concat([tarHeader('scientific-review-v1/too-large.json', LIMITS.cloudflareMaxFileBytes + 1), Buffer.alloc(1024)]);
  await fs.writeFile(largeArchive, largeBody);
  const lock = { ...f.lock, source: { archive: { ...f.lock.source.archive, bytes: largeBody.length, sha256: sha256(largeBody) } } };
  await errorCode(stageResearchAssets({ lock, archivePath: largeArchive, outputRoot: path.join(f.root, 'large-out'), temporaryBase: tempBase }), 'ARCHIVE_FILE_TOO_LARGE');
});

test('decompressed tar bytes include headers, padding, and a long zero tail', async t => {
  const f = await fixture(t);
  const exactOut = path.join(f.root, 'exact-out');
  await stageResearchAssets({
    lock: f.lock,
    archivePath: f.archivePath,
    outputRoot: exactOut,
    temporaryBase: tempBase,
    archiveLimits: { maxUnpackedBytes: f.archive.bytes },
  });

  const tailed = path.join(f.root, 'tailed.tar');
  const base = await fs.readFile(f.archivePath);
  const tailedBody = Buffer.concat([base, Buffer.alloc(4096)]);
  await fs.writeFile(tailed, tailedBody);
  const lock = pinnedArchive(f.lock, tailed, { bytes: tailedBody.length, sha256: sha256(tailedBody) });
  const scratch = path.join(f.root, 'tail-scratch');
  await fs.mkdir(scratch);
  await errorCode(stageResearchAssets({
    lock,
    archivePath: tailed,
    outputRoot: path.join(f.root, 'tail-out'),
    temporaryBase: scratch,
    archiveLimits: { maxUnpackedBytes: base.length + 512 },
  }), 'ARCHIVE_UNPACKED_SIZE_LIMIT');
  assert.deepEqual(await fs.readdir(scratch), []);
});

test('custom tar parsing rejects truncated headers, unsafe paths, bad checksums, and excess entries', async t => {
  const f = await fixture(t);
  const cases = [
    ['truncated', Buffer.alloc(100), 'ARCHIVE_TRUNCATED'],
    ['unsafe-path', Buffer.concat([tarHeader('../escape.json', 0), Buffer.alloc(1024)]), 'ARCHIVE_PATH'],
    ['bad-checksum', (() => {
      const header = tarHeader('scientific-review-v1/bad.json', 0);
      header[0] ^= 1;
      return Buffer.concat([header, Buffer.alloc(1024)]);
    })(), 'ARCHIVE_HEADER_CHECKSUM'],
    ['bad-format', (() => {
      const header = tarHeader('scientific-review-v1/bad-format.json', 0);
      Buffer.from('v7\0\0\0').copy(header, 257);
      header.fill(0x20, 148, 156);
      const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
      Buffer.from(octal(checksum, 8), 'ascii').copy(header, 148);
      return Buffer.concat([header, Buffer.alloc(1024)]);
    })(), 'ARCHIVE_HEADER_FORMAT'],
    ['entry-limit', Buffer.concat([
      tarHeader('research-dictionaries-v1/directory', 0, '5'),
      tarFile('research-dictionaries-v1/file.json', Buffer.from('{}')),
      Buffer.alloc(1024),
    ]), 'ARCHIVE_ENTRY_LIMIT'],
  ];
  for (const [name, body, expected] of cases) {
    const archivePath = path.join(f.root, `${name}.tar`);
    await fs.writeFile(archivePath, body);
    const lock = pinnedArchive(f.lock, archivePath, { bytes: body.length, sha256: sha256(body) });
    await errorCode(stageResearchAssets({
      lock,
      archivePath,
      outputRoot: path.join(f.root, `${name}-out`),
      temporaryBase: tempBase,
      archiveLimits: name === 'entry-limit' ? { maxEntries: 1 } : {},
    }), expected);
  }
});

test('gzip expansion and decompression errors stay bounded and clean extraction scratch', async t => {
  const f = await fixture(t);
  const base = await fs.readFile(f.archivePath);
  const gzipArchive = path.join(f.root, 'research-assets.tar.gz');
  const compressed = gzipSync(base);
  await fs.writeFile(gzipArchive, compressed);
  const lock = pinnedArchive(f.lock, gzipArchive, { bytes: compressed.length, sha256: sha256(compressed) });
  await errorCode(stageResearchAssets({
    lock,
    archivePath: gzipArchive,
    outputRoot: path.join(f.root, 'gzip-out'),
    temporaryBase: tempBase,
    archiveLimits: { maxUnpackedBytes: base.length - 1 },
  }), 'ARCHIVE_UNPACKED_SIZE_LIMIT');

  const corrupt = path.join(f.root, 'corrupt.tar.gz');
  const corruptBody = Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08]), Buffer.from('not-gzip')]);
  await fs.writeFile(corrupt, corruptBody);
  const corruptLock = pinnedArchive(f.lock, corrupt, { bytes: corruptBody.length, sha256: sha256(corruptBody) });
  const scratch = path.join(f.root, 'gzip-scratch');
  await fs.mkdir(scratch);
  await errorCode(stageResearchAssets({
    lock: corruptLock,
    archivePath: corrupt,
    outputRoot: path.join(f.root, 'corrupt-out'),
    temporaryBase: scratch,
  }), 'ARCHIVE_DECOMPRESSION_FAILED');
  assert.deepEqual(await fs.readdir(scratch), []);
});

test('atomic install preserves the previous release across copy, backup, and install failures', async t => {
  for (const [method, callNumber] of [['copyFile', 1], ['rename', 2], ['rename', 6]]) {
    const f = await fixture(t);
    const outputRoot = path.join(f.root, `rollback-${method}-${callNumber}`);
    await stageResearchAssets({ lock: f.lock, archivePath: f.archivePath, outputRoot, temporaryBase: tempBase });
    const beforeIndex = await fs.readFile(path.join(outputRoot, 'research-assets-v1/index.json'));
    const beforeManifest = await fs.readFile(path.join(outputRoot, 'research-dictionaries-v1/manifest.json'));
    await assert.rejects(stageResearchAssets({
      lock: f.lock,
      archivePath: f.archivePath,
      outputRoot,
      temporaryBase: tempBase,
      installFileSystem: failOnceAt(method, callNumber),
    }), error => error?.code === 'INJECTED_INSTALL_FAILURE');
    assert.deepEqual(await fs.readFile(path.join(outputRoot, 'research-assets-v1/index.json')), beforeIndex);
    assert.deepEqual(await fs.readFile(path.join(outputRoot, 'research-dictionaries-v1/manifest.json')), beforeManifest);
    assert.deepEqual((await fs.readdir(outputRoot)).sort(), [
      'research-assets-v1',
      'research-dictionaries-v1',
      'scientific-conflicts-v1',
      'scientific-review-v1',
    ].sort());
  }
});

test('incomplete rollback retains a recovery directory and reports its path', async t => {
  const f = await fixture(t);
  const outputRoot = path.join(f.root, 'rollback-recovery');
  await stageResearchAssets({ lock: f.lock, archivePath: f.archivePath, outputRoot, temporaryBase: tempBase });
  let failure;
  await assert.rejects(stageResearchAssets({
    lock: f.lock,
    archivePath: f.archivePath,
    outputRoot,
    temporaryBase: tempBase,
    installFileSystem: failDuringRestore(),
  }), error => {
    failure = error;
    return error?.code === 'INSTALL_ROLLBACK_INCOMPLETE' && typeof error.recoveryPath === 'string';
  });
  const entries = await fs.readdir(outputRoot);
  const recovery = entries.find(entry => entry.startsWith('.research-assets-backup-'));
  assert.ok(recovery, `missing retained recovery directory: ${entries.join(',')}`);
  assert.equal(failure.recoveryPath, path.join(outputRoot, recovery));
  assert.ok((await fs.readdir(path.join(outputRoot, recovery))).length > 0);
});
