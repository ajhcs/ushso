import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { canonicalJson, sha256 } from '../../connectors/src/canonical.mjs';
import { exactKeys, LocalCollectionError, requireLocal } from './collection-job.mjs';
import { JOURNAL_BOUNDS } from './local-fixture-catalog.mjs';

const HEX = /^[a-f0-9]{64}$/;
const KINDS = new Set([
  'header',
  'child_admitted',
  'child_bound',
  'attempt_started',
  'attempt_outcome',
  'scheduler_seed',
  'scheduler_transaction',
  'connector_operation',
  'request_intent',
  'response',
  'strict_outcome',
  'wrapper_outcome',
  'capture_reference',
  'request_ledger',
  'replay_session'
]);
const UNSAFE_KEYS =
  /^(?:__proto__|constructor|prototype|authorization|cookie|password|secret|raw_body|body|text)$/i;
const UNSAFE_TEXT = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{16,}/;
const FORMAT = 'ushso.local-collection-journal.v1';

export async function encodeLocalValue(
  value,
  putBytes = async (bytes) => ({ sha256: sha256(bytes), byte_length: bytes.byteLength })
) {
  let nodes = 0;
  async function encode(item, depth) {
    requireLocal(++nodes <= 20000 && depth <= 40, 'VALUE_BOUND_EXCEEDED');
    if (item === null) return { t: 'null' };
    if (item === undefined) return { t: 'undefined' };
    if (typeof item === 'boolean') return { t: 'boolean', v: item };
    if (typeof item === 'number') {
      requireLocal(Number.isFinite(item) && !Object.is(item, -0), 'VALUE_NUMBER_INVALID');
      return { t: 'number', v: item };
    }
    if (typeof item === 'string') {
      requireLocal(item.length <= 100000 && !UNSAFE_TEXT.test(item), 'UNSAFE_VALUE');
      return { t: 'string', v: item };
    }
    if (item instanceof Uint8Array) {
      requireLocal(
        (Object.getPrototypeOf(item) === Uint8Array.prototype || Buffer.isBuffer(item)) &&
          Reflect.ownKeys(item).length === item.byteLength,
        'BYTES_TYPE_UNSUPPORTED'
      );
      const bytes = new Uint8Array(item),
        reference = await putBytes(bytes);
      exactKeys(reference, ['sha256', 'byte_length']);
      requireLocal(
        reference.sha256 === sha256(bytes) && reference.byte_length === bytes.byteLength,
        'BYTES_REFERENCE_INVALID'
      );
      return { t: 'bytes_ref', ...reference };
    }
    if (item instanceof Map) {
      requireLocal(
        Object.getPrototypeOf(item) === Map.prototype && Reflect.ownKeys(item).length === 0,
        'MAP_TYPE_UNSUPPORTED'
      );
      const entries = [];
      for (const [key, val] of item) {
        requireLocal(typeof key === 'string', 'MAP_KEY_INVALID');
        entries.push([await encode(key, depth + 1), await encode(val, depth + 1)]);
      }
      return { t: 'map', v: entries };
    }
    requireLocal(
      item &&
        typeof item === 'object' &&
        (Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype),
      'VALUE_TYPE_UNSUPPORTED'
    );
    if (Array.isArray(item)) {
      requireLocal(Object.getPrototypeOf(item) === Array.prototype, 'ARRAY_TYPE_UNSUPPORTED');
      requireLocal(
        Reflect.ownKeys(item).length === item.length + 1 &&
          Object.keys(item).length === item.length,
        'VALUE_ARRAY_NOT_DENSE'
      );
      const values = [];
      for (let i = 0; i < item.length; i++) {
        requireLocal(
          Object.hasOwn(item, i) &&
            !('get' in Object.getOwnPropertyDescriptor(item, String(i))) &&
            !('set' in Object.getOwnPropertyDescriptor(item, String(i))),
          'VALUE_ARRAY_NOT_DENSE'
        );
        values.push(await encode(item[i], depth + 1));
      }
      return { t: 'array', v: values };
    }
    requireLocal(
      Reflect.ownKeys(item).length === Object.keys(item).length,
      'VALUE_HIDDEN_PROPERTY'
    );
    const values = [];
    for (const key of Object.keys(item).sort()) {
      requireLocal(
        !UNSAFE_KEYS.test(key) &&
          !('get' in Object.getOwnPropertyDescriptor(item, key)) &&
          !('set' in Object.getOwnPropertyDescriptor(item, key)),
        'UNSAFE_VALUE_FIELD'
      );
      requireLocal(
        key !== 'token' ||
          /^scheduler_[a-f0-9]{32}_source_fixture_catalog_e[1-9][0-9]*$/.test(item[key]),
        'UNSAFE_VALUE_FIELD'
      );
      values.push([key, await encode(item[key], depth + 1)]);
    }
    return { t: 'object', v: values };
  }
  return encode(value, 0);
}

export async function decodeLocalValue(encoded, getBytes) {
  let nodes = 0;
  async function decode(item, depth) {
    requireLocal(++nodes <= 20000 && depth <= 40, 'VALUE_BOUND_EXCEEDED');
    requireLocal(
      item && Object.getPrototypeOf(item) === Object.prototype && typeof item.t === 'string',
      'VALUE_ENCODING_INVALID'
    );
    if (['null', 'undefined'].includes(item.t)) {
      exactKeys(item, ['t']);
      return item.t === 'null' ? null : undefined;
    }
    if (item.t === 'bytes_ref') {
      exactKeys(item, ['t', 'sha256', 'byte_length']);
      requireLocal(
        HEX.test(item.sha256) && Number.isSafeInteger(item.byte_length) && item.byte_length >= 0,
        'BYTES_REFERENCE_INVALID'
      );
      const bytes = await getBytes(item.sha256);
      requireLocal(bytes.byteLength === item.byte_length, 'BYTES_REFERENCE_SIZE');
      requireLocal(sha256(bytes) === item.sha256, 'BYTES_REFERENCE_HASH');
      return new Uint8Array(bytes);
    }
    exactKeys(item, ['t', 'v']);
    if (item.t === 'boolean') {
      requireLocal(typeof item.v === 'boolean', 'VALUE_ENCODING_INVALID');
      return item.v;
    }
    if (item.t === 'number') {
      requireLocal(
        typeof item.v === 'number' && Number.isFinite(item.v) && !Object.is(item.v, -0),
        'VALUE_ENCODING_INVALID'
      );
      return item.v;
    }
    if (item.t === 'string') {
      requireLocal(
        typeof item.v === 'string' && item.v.length <= 100000 && !UNSAFE_TEXT.test(item.v),
        'UNSAFE_VALUE'
      );
      return item.v;
    }
    requireLocal(Array.isArray(item.v), 'VALUE_ENCODING_INVALID');
    if (item.t === 'array') {
      const values = [];
      for (const val of item.v) values.push(await decode(val, depth + 1));
      return values;
    }
    if (item.t === 'map') {
      const result = new Map();
      for (const pair of item.v) {
        requireLocal(Array.isArray(pair) && pair.length === 2, 'VALUE_ENCODING_INVALID');
        const key = await decode(pair[0], depth + 1);
        requireLocal(typeof key === 'string' && !result.has(key), 'MAP_KEY_INVALID');
        result.set(key, await decode(pair[1], depth + 1));
      }
      return result;
    }
    requireLocal(item.t === 'object', 'VALUE_TAG_UNSUPPORTED');
    const result = {};
    let previous = null;
    for (const pair of item.v) {
      requireLocal(
        Array.isArray(pair) &&
          pair.length === 2 &&
          typeof pair[0] === 'string' &&
          !UNSAFE_KEYS.test(pair[0]) &&
          (previous === null || pair[0] > previous),
        'VALUE_OBJECT_INVALID'
      );
      previous = pair[0];
      result[pair[0]] = await decode(pair[1], depth + 1);
      requireLocal(
        pair[0] !== 'token' ||
          /^scheduler_[a-f0-9]{32}_source_fixture_catalog_e[1-9][0-9]*$/.test(result[pair[0]]),
        'UNSAFE_VALUE_FIELD'
      );
    }
    return result;
  }
  return decode(encoded, 0);
}

export async function valueDigest(value) {
  return sha256(canonicalJson(await encodeLocalValue(value)));
}

export function localScratchRoot() {
  const configured = process.env.TMPDIR ?? process.env.RUNNER_TEMP ?? '/mnt/d/tmp/plumbob';
  requireLocal(
    path.isAbsolute(configured) && path.resolve(configured) !== path.parse(configured).root,
    'SCRATCH_ROOT_INVALID'
  );
  return path.resolve(configured);
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function noLinkComponents(candidate, root, { create = false } = {}) {
  requireLocal(path.isAbsolute(candidate), 'STATE_PATH_NOT_ABSOLUTE');
  const resolved = path.resolve(candidate);
  requireLocal(
    resolved.startsWith(root + path.sep) && resolved !== root,
    'STATE_PATH_OUTSIDE_SCRATCH'
  );
  requireLocal((await fs.stat(root)).isDirectory(), 'SCRATCH_ROOT_UNAVAILABLE');
  const realRoot = await fs.realpath(root);
  let current = root;
  for (const segment of path.relative(root, resolved).split(path.sep)) {
    requireLocal(segment.length > 0 && segment !== '.' && segment !== '..', 'STATE_PATH_INVALID');
    current = path.join(current, segment);
    if (create) {
      try {
        await fs.mkdir(current, { mode: 0o700 });
        await syncDirectory(path.dirname(current));
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    const info = await fs.lstat(current);
    requireLocal(info.isDirectory() && !info.isSymbolicLink(), 'STATE_PATH_SYMLINK');
  }
  requireLocal((await fs.realpath(resolved)).startsWith(realRoot + path.sep), 'STATE_PATH_ESCAPE');
  return resolved;
}

/** The parent's open file description retains flock after the helper exits. */
async function kernelLock(directory, { readOnly = false } = {}) {
  requireLocal(process.platform === 'linux', 'LOCAL_LOCK_UNSUPPORTED');
  const handle = await fs.open(
    path.join(directory, '.writer.lock'),
    (readOnly ? constants.O_RDONLY : constants.O_CREAT | constants.O_RDWR) | constants.O_NOFOLLOW,
    0o600
  );
  try {
    requireLocal((await handle.stat()).isFile(), 'LOCK_FILE_INVALID');
    const result = spawnSync(
      '/usr/bin/flock',
      ['--nonblock', ...(readOnly ? ['--shared'] : []), '3'],
      { stdio: ['ignore', 'pipe', 'pipe', handle.fd] }
    );
    requireLocal(
      !result.error && result.status === 0,
      result.status === 1 ? 'WRITER_BUSY' : 'LOCAL_LOCK_UNSUPPORTED'
    );
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export class LocalCollectionStore {
  constructor(directory, { pins, readOnly = false, fault = null, lock }) {
    this.directory = directory;
    this.pins = pins;
    this.readOnly = readOnly;
    this.fault = fault;
    this.lock = lock;
    this.records = [];
    this.operations = new Map();
    this.poisoned = false;
    this.closed = false;
    this.closing = false;
    this.tail = Promise.resolve();
    this.objectBytes = 0;
  }
  static async open(directory, { pins, readOnly = false, fault = null } = {}) {
    const root = localScratchRoot();
    if (root.startsWith('/mnt/d/')) {
      const mountInfo = await fs.readFile('/proc/self/mountinfo', 'utf8');
      requireLocal(
        mountInfo.split('\n').some((line) => line.split(' ')[4] === '/mnt/d'),
        'DEVELOPMENT_MOUNT_UNAVAILABLE'
      );
    }
    directory = await noLinkComponents(directory, root, { create: !readOnly });
    const lock = await kernelLock(directory, { readOnly });
    const store = new LocalCollectionStore(directory, { pins, readOnly, fault, lock });
    try {
      if (!readOnly)
        for (const name of ['objects', 'journal']) {
          try {
            await fs.mkdir(path.join(directory, name), { mode: 0o700 });
            await syncDirectory(directory);
          } catch (error) {
            if (error.code !== 'EEXIST') throw error;
          }
        }
      for (const name of ['objects', 'journal']) {
        const info = await fs.lstat(path.join(directory, name));
        requireLocal(info.isDirectory() && !info.isSymbolicLink(), 'STATE_INTERNAL_PATH_INVALID');
      }
      await store.load();
      if (!store.records.length) {
        requireLocal(!readOnly, 'STATE_NOT_INITIALIZED');
        await store.record('header', 'header', { pins }, null);
      }
      requireLocal(
        store.records[0].kind === 'header' &&
          canonicalJson(store.records[0].payload.pins) === canonicalJson(pins),
        'STATE_PIN_MISMATCH'
      );
      return store;
    } catch (error) {
      await lock?.close();
      throw error;
    }
  }
  assertUsable(write = false) {
    requireLocal(!this.poisoned, 'LOCAL_STORE_POISONED');
    requireLocal(!this.closed, 'LOCAL_STORE_CLOSED');
    if (write) requireLocal(!this.readOnly && this.lock, 'WRITER_LOCK_REQUIRED');
  }
  poison() {
    this.poisoned = true;
  }
  async hit(point, detail = {}) {
    await this.fault?.(point, detail);
  }
  async exclusive(work) {
    requireLocal(!this.closing, 'LOCAL_STORE_CLOSING');
    const predecessor = this.tail;
    let release;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      this.assertUsable(true);
      return await work();
    } finally {
      release();
    }
  }
  async readFile(file, limit) {
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      requireLocal(info.isFile() && info.size <= limit, 'ARTIFACT_BOUND_OR_TYPE');
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }
  async getObject(hash) {
    this.assertUsable();
    requireLocal(HEX.test(hash), 'OBJECT_HASH_INVALID');
    const bytes = await this.readFile(
      path.join(this.directory, 'objects', hash),
      JOURNAL_BOUNDS.maximum_object_bytes
    );
    requireLocal(sha256(bytes) === hash, 'OBJECT_HASH_MISMATCH');
    return bytes;
  }
  async immutableUnlocked(folder, name, bytes) {
    this.assertUsable(true);
    const base = path.join(this.directory, folder);
    const final = path.join(base, name);
    const temporary = path.join(base, `.pending-${randomUUID()}`);
    let file;
    try {
      file = await fs.open(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600
      );
      await file.writeFile(bytes);
      await file.sync();
      await this.hit('after_file_sync', { folder, name });
      await file.close();
      file = null;
      try {
        await fs.link(temporary, final);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        requireLocal(
          (
            await this.readFile(
              final,
              Math.max(JOURNAL_BOUNDS.maximum_record_bytes, JOURNAL_BOUNDS.maximum_object_bytes)
            )
          ).equals(bytes),
          'IMMUTABLE_ARTIFACT_CONFLICT'
        );
      }
      await fs.unlink(temporary);
      await this.hit('before_directory_sync', { folder, name });
      const directory = await fs.open(base, constants.O_RDONLY | constants.O_DIRECTORY);
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      await this.hit('after_directory_sync', { folder, name });
    } catch (error) {
      this.poison();
      await file?.close().catch(() => {});
      throw error;
    }
  }
  async putObject(bytes) {
    return this.exclusive(() => this.putObjectUnlocked(bytes));
  }
  async putObjectUnlocked(bytes) {
    this.assertUsable(true);
    requireLocal(
      bytes instanceof Uint8Array && bytes.byteLength <= JOURNAL_BOUNDS.maximum_object_bytes,
      'OBJECT_BOUND_EXCEEDED'
    );
    const hash = sha256(bytes);
    try {
      const prior = await this.getObject(hash);
      requireLocal(prior.byteLength === bytes.byteLength, 'OBJECT_SIZE_CONFLICT');
      return { sha256: hash, byte_length: bytes.byteLength };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    requireLocal(
      this.objectBytes + bytes.byteLength <= JOURNAL_BOUNDS.maximum_total_object_bytes,
      'OBJECT_TOTAL_BOUND_EXCEEDED'
    );
    await this.immutableUnlocked('objects', hash, Buffer.from(bytes));
    this.objectBytes += bytes.byteLength;
    return { sha256: hash, byte_length: bytes.byteLength };
  }
  async load() {
    const objectNames = await fs.readdir(path.join(this.directory, 'objects'));
    for (const name of objectNames) {
      if (name.startsWith('.pending-')) continue;
      requireLocal(HEX.test(name), 'UNKNOWN_OBJECT_FILE');
      const data = await this.getObject(name);
      this.objectBytes += data.byteLength;
      requireLocal(
        this.objectBytes <= JOURNAL_BOUNDS.maximum_total_object_bytes,
        'OBJECT_TOTAL_BOUND_EXCEEDED'
      );
    }
    const names = (await fs.readdir(path.join(this.directory, 'journal')))
      .filter((name) => !name.startsWith('.pending-'))
      .sort();
    requireLocal(names.length <= JOURNAL_BOUNDS.maximum_records, 'JOURNAL_BOUND_EXCEEDED');
    let previous = null;
    for (let index = 0; index < names.length; index++) {
      requireLocal(
        names[index] === `${String(index + 1).padStart(8, '0')}.json`,
        'JOURNAL_SEQUENCE_INVALID'
      );
      const bytes = await this.readFile(
        path.join(this.directory, 'journal', names[index]),
        JOURNAL_BOUNDS.maximum_record_bytes
      );
      const raw = JSON.parse(bytes);
      requireLocal(Buffer.from(canonicalJson(raw)).equals(bytes), 'JOURNAL_NONCANONICAL');
      exactKeys(raw, [
        'format',
        'sequence',
        'previous_record_sha256',
        'kind',
        'operation_id',
        'pins_digest',
        'payload',
        'result',
        'result_digest'
      ]);
      requireLocal(
        raw.format === FORMAT &&
          raw.sequence === index + 1 &&
          raw.previous_record_sha256 === previous &&
          KINDS.has(raw.kind),
        'JOURNAL_RECORD_INVALID'
      );
      requireLocal(raw.pins_digest === sha256(canonicalJson(this.pins)), 'STATE_PIN_MISMATCH');
      requireLocal(
        typeof raw.operation_id === 'string' &&
          raw.operation_id.length > 0 &&
          raw.operation_id.length <= 512,
        'JOURNAL_OPERATION_INVALID'
      );
      requireLocal(!this.operations.has(raw.operation_id), 'JOURNAL_OPERATION_DUPLICATE');
      requireLocal(sha256(canonicalJson(raw.result)) === raw.result_digest, 'JOURNAL_RESULT_HASH');
      const payload = await decodeLocalValue(raw.payload, (hash) => this.getObject(hash));
      const result = await decodeLocalValue(raw.result, (hash) => this.getObject(hash));
      previous = sha256(bytes);
      const record = { ...raw, payload, result, sha256: previous };
      this.records.push(record);
      this.operations.set(raw.operation_id, record);
    }
  }
  find(id) {
    this.assertUsable();
    return this.operations.get(id) ?? null;
  }
  byKind(kind) {
    this.assertUsable();
    return this.records.filter((record) => record.kind === kind);
  }
  async appendUnlocked(kind, id, payload, result) {
    this.assertUsable(true);
    requireLocal(
      KINDS.has(kind) && typeof id === 'string' && id.length > 0 && id.length <= 512,
      'JOURNAL_OPERATION_INVALID'
    );
    const prior = this.operations.get(id);
    if (prior) {
      requireLocal(
        prior.kind === kind &&
          (await valueDigest(prior.payload)) === (await valueDigest(payload)) &&
          (await valueDigest(prior.result)) === (await valueDigest(result)),
        'JOURNAL_IDEMPOTENCY_CONFLICT'
      );
      return prior.result;
    }
    requireLocal(this.records.length < JOURNAL_BOUNDS.maximum_records, 'JOURNAL_BOUND_EXCEEDED');
    const encodedPayload = await encodeLocalValue(payload, (bytes) =>
      this.putObjectUnlocked(bytes)
    );
    const encodedResult = await encodeLocalValue(result, (bytes) => this.putObjectUnlocked(bytes));
    const sequence = this.records.length + 1;
    const raw = {
      format: FORMAT,
      sequence,
      previous_record_sha256: this.records.at(-1)?.sha256 ?? null,
      kind,
      operation_id: id,
      pins_digest: sha256(canonicalJson(this.pins)),
      payload: encodedPayload,
      result: encodedResult,
      result_digest: sha256(canonicalJson(encodedResult))
    };
    const bytes = Buffer.from(canonicalJson(raw));
    requireLocal(bytes.byteLength <= JOURNAL_BOUNDS.maximum_record_bytes, 'JOURNAL_RECORD_BOUND');
    await this.immutableUnlocked('journal', `${String(sequence).padStart(8, '0')}.json`, bytes);
    const record = {
      ...raw,
      payload: structuredClone(payload),
      result: structuredClone(result),
      sha256: sha256(bytes)
    };
    this.records.push(record);
    this.operations.set(id, record);
    try {
      await this.hit('after_record_commit', { kind, id, sequence });
    } catch (error) {
      this.poison();
      throw error;
    }
    return structuredClone(result);
  }
  async record(kind, id, payload, result) {
    return this.exclusive(() => this.appendUnlocked(kind, id, payload, result));
  }
  async mutation(kind, payload, reduce) {
    return this.exclusive(async () => {
      try {
        const result = await reduce();
        return await this.appendUnlocked(
          kind,
          `${kind}:${this.records.length + 1}`,
          payload,
          result
        );
      } catch (error) {
        this.poison();
        throw error;
      }
    });
  }
  async transactionRecord(label, work) {
    return this.exclusive(async () => {
      try {
        const { calls, result } = await work();
        return await this.appendUnlocked(
          'scheduler_transaction',
          `scheduler_transaction:${this.records.length + 1}`,
          { label, calls },
          result
        );
      } catch (error) {
        this.poison();
        throw error;
      }
    });
  }
  async close() {
    if (this.closed) return;
    this.closing = true;
    await this.tail;
    this.closed = true;
    await this.lock?.close();
    this.lock = null;
  }
}
