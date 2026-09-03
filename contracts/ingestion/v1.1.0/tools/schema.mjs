import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { PACKAGE_ROOT, readJson } from './common.mjs';

let cache;

function validDateTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validHostname(value) {
  if (typeof value !== 'string' || value.length > 253 || value.endsWith('.') || /[^A-Za-z0-9.-]/.test(value)) return false;
  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[.*\])$/i.test(value)) return false;
  return value.split('.').length >= 2 && value.split('.').every(label => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}

function validHttpsUri(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && validHostname(parsed.hostname) && !parsed.username && !parsed.password && !parsed.hash;
  } catch { return false; }
}

function validHttpDate(value) {
  return typeof value === 'string' && /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value) && Number.isFinite(Date.parse(value));
}

export function validationMessage(validate) {
  return (validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`).join('; ');
}

export async function loadSchemas() {
  if (cache) return cache;
  const ajv = new Ajv2020({ strict: true, strictSchema: true, strictTypes: true, allErrors: true, validateFormats: true });
  ajv.addFormat('date-time', validDateTime);
  ajv.addFormat('date', validDate);
  ajv.addFormat('hostname', validHostname);
  ajv.addFormat('https-uri', validHttpsUri);
  ajv.addFormat('http-date', validHttpDate);
  const schemaRoot = path.join(PACKAGE_ROOT, 'schemas');
  const names = (await fs.readdir(schemaRoot)).filter(name => name.endsWith('.schema.json')).sort();
  const schemas = [];
  for (const name of names) {
    const schema = await readJson(path.join(schemaRoot, name));
    ajv.addSchema(schema);
    schemas.push({ name, schema });
  }
  for (const { name, schema } of schemas) {
    if (!ajv.getSchema(schema.$id)) throw new Error(`SCHEMA_NOT_COMPILED:${name}`);
  }
  cache = { ajv, schemas };
  return cache;
}

export async function validatorForFile(name) {
  const { ajv, schemas } = await loadSchemas();
  const found = schemas.find(entry => entry.name === name);
  if (!found) throw new Error(`SCHEMA_NOT_FOUND:${name}`);
  const validate = ajv.getSchema(found.schema.$id);
  if (!validate) throw new Error(`SCHEMA_NOT_COMPILED:${name}`);
  return validate;
}
