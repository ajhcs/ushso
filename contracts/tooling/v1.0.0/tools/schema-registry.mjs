import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { readStrictJson } from './strict-json.mjs';

export const TOOLING_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TOOLING_SCHEMA_DIRECTORY = path.join(TOOLING_ROOT, 'schemas');

function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf())
    && date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]);
}

export const PINNED_FORMATS = Object.freeze({
  date: value => typeof value === 'string' && validDate(value),
  'date-time': value => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/u.test(value)
    && !Number.isNaN(Date.parse(value))
    && validDate(value.slice(0, 10)),
  time: value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/u.test(value),
  uri: value => {
    if (typeof value !== 'string') return false;
    try { const url = new URL(value); return Boolean(url.protocol) && url.username === '' && url.password === ''; } catch { return false; }
  },
  'https-uri': value => {
    if (typeof value !== 'string') return false;
    try { const url = new URL(value); return url.protocol === 'https:' && Boolean(url.hostname) && url.username === '' && url.password === ''; } catch { return false; }
  },
  uuid: value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value),
  'sha256-hex': value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value),
  'json-pointer': value => typeof value === 'string' && /^(?:\/(?:[^~/]|~[01])*)*$/u.test(value),
  semver: value => typeof value === 'string' && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(value),
  'media-type': value => typeof value === 'string' && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(value)
});

function errorRows(validate) {
  return (validate.errors ?? []).map(error => ({
    instance_path: error.instancePath || '',
    schema_path: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? 'schema validation failed'
  }));
}

function versionAtLeast(actual, minimum) {
  const parsed = actual.replace(/^v/u, '').split('.').slice(0, 3).map(value => Number.parseInt(value, 10));
  const required = [minimum.major, minimum.minor, minimum.patch];
  for (let index = 0; index < 3; index += 1) {
    if (parsed[index] > required[index]) return true;
    if (parsed[index] < required[index]) return false;
  }
  return true;
}

export async function verifyDependencyPins({ packageRoot, dependencyPin, packageJson }) {
  const errors = [];
  if (!versionAtLeast(process.version, dependencyPin.node_runtime.minimum)) {
    errors.push({ code: 'NODE_RUNTIME_BELOW_PIN', actual: process.version, minimum: dependencyPin.node_runtime.minimum });
  }
  const require = createRequire(path.join(packageRoot, 'package.json'));
  for (const pin of dependencyPin.dependencies) {
    const declared = packageJson.dependencies?.[pin.name];
    if (declared !== pin.version) errors.push({ code: 'DEPENDENCY_DECLARATION_MISMATCH', name: pin.name, declared: declared ?? null, pinned: pin.version });
    try {
      const installed = require(`${pin.name}/package.json`).version;
      if (installed !== pin.version) errors.push({ code: 'DEPENDENCY_INSTALL_MISMATCH', name: pin.name, installed, pinned: pin.version });
    } catch (error) {
      errors.push({ code: 'DEPENDENCY_NOT_RESOLVABLE', name: pin.name, message: error.code ?? error.message });
    }
  }
  const declaredFormats = new Set(dependencyPin.formats);
  for (const name of dependencyPin.formats) if (!Object.hasOwn(PINNED_FORMATS, name)) errors.push({ code: 'FORMAT_IMPLEMENTATION_MISSING', name });
  for (const name of Object.keys(PINNED_FORMATS)) if (!declaredFormats.has(name)) errors.push({ code: 'FORMAT_PIN_MISSING', name });
  return { ok: errors.length === 0, errors };
}

export async function createSchemaRegistry({ schemaDirectory, schemaDirectories = [], dependencyPinPath, packageJsonPath, packageRoot = path.dirname(packageJsonPath) }) {
  const [dependencyPin, packageJson] = await Promise.all([
    readStrictJson(dependencyPinPath),
    readStrictJson(packageJsonPath)
  ]);
  const dependencyCheck = await verifyDependencyPins({ packageRoot, dependencyPin, packageJson });
  if (!dependencyCheck.ok) {
    const error = new Error('DEPENDENCY_PIN_VERIFICATION_FAILED');
    error.code = 'DEPENDENCY_PIN_VERIFICATION_FAILED';
    error.errors = dependencyCheck.errors;
    throw error;
  }

  const ajv = new Ajv2020({
    strict: true,
    strictSchema: true,
    strictTypes: true,
    strictTuples: true,
    strictRequired: true,
    allErrors: true,
    validateFormats: true,
    allowUnionTypes: false,
    ownProperties: true
  });
  for (const name of dependencyPin.formats) ajv.addFormat(name, PINNED_FORMATS[name]);

  const directories = [...new Set([TOOLING_SCHEMA_DIRECTORY, schemaDirectory, ...schemaDirectories].filter(Boolean).map(directory => path.resolve(directory)))];
  const schemas = [];
  for (const directory of directories) {
    const names = (await fs.readdir(directory)).filter(name => name.endsWith('.schema.json')).sort();
    for (const name of names) {
      schemas.push({
        name: directories.length === 1 ? name : `${path.basename(path.dirname(directory))}/${path.basename(directory)}/${name}`,
        file: path.join(directory, name),
        schema: await readStrictJson(path.join(directory, name))
      });
    }
  }
  schemas.sort((left, right) => {
    const leftCommon = path.basename(left.file) === 'common.schema.json';
    const rightCommon = path.basename(right.file) === 'common.schema.json';
    if (leftCommon !== rightCommon) return leftCommon ? -1 : 1;
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });
  const ids = new Set();
  for (const row of schemas) {
    if (row.schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') throw new Error(`SCHEMA_DRAFT_NOT_2020_12:${row.name}`);
    if (typeof row.schema.$id !== 'string' || ids.has(row.schema.$id)) throw new Error(`SCHEMA_ID_INVALID_OR_DUPLICATE:${row.name}`);
    ids.add(row.schema.$id);
    ajv.addSchema(row.schema, row.schema.$id);
  }
  for (const row of schemas) {
    const validate = ajv.getSchema(row.schema.$id);
    if (!validate) throw new Error(`SCHEMA_NOT_COMPILED:${row.name}`);
  }

  const registry = {
    ajv,
    schemas,
    dependencyPin,
    dependencyCheck,
    get(schemaId) {
      const validate = ajv.getSchema(schemaId);
      if (!validate) throw new Error(`SCHEMA_NOT_REGISTERED:${schemaId}`);
      return validate;
    },
    validate(schemaId, value) {
      const validate = this.get(schemaId);
      const valid = validate(value);
      return { valid, errors: valid ? [] : errorRows(validate) };
    }
  };

  const pinSchemaId = 'https://ushso.local/contracts/tooling/v1.0.0/dependency-pin.schema.json';
  const pinValidation = registry.validate(pinSchemaId, dependencyPin);
  if (!pinValidation.valid) {
    const error = new Error('DEPENDENCY_PIN_SCHEMA_INVALID');
    error.code = 'DEPENDENCY_PIN_SCHEMA_INVALID';
    error.errors = pinValidation.errors;
    throw error;
  }
  return registry;
}

export { errorRows as schemaValidationErrors };
