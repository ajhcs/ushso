import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

import { PACKAGE_ROOT, readJson } from './common.mjs';

let cached;

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validDateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  return !Number.isNaN(new Date(value).valueOf());
}

export async function loadSchemas() {
  if (cached) return cached;
  const schemaRoot = path.join(PACKAGE_ROOT, 'schemas');
  const names = (await fs.readdir(schemaRoot)).filter(name => name.endsWith('.schema.json')).sort();
  const ajv = new Ajv2020({
    strict: true,
    strictSchema: true,
    strictTypes: true,
    strictRequired: true,
    allErrors: true,
    validateFormats: true,
    allowUnionTypes: false
  });
  ajv.addFormat('date', validDate);
  ajv.addFormat('date-time', validDateTime);
  const schemas = [];
  for (const name of names) schemas.push({ name, schema: await readJson(path.join(schemaRoot, name)) });
  for (const { schema } of schemas) ajv.addSchema(schema);
  for (const { schema } of schemas) ajv.getSchema(schema.$id);
  cached = { ajv, schemas };
  return cached;
}

export async function validatorFor(name) {
  const { ajv, schemas } = await loadSchemas();
  const row = schemas.find(item => item.name === name);
  if (!row) throw new Error(`SCHEMA_NOT_FOUND:${name}`);
  const validate = ajv.getSchema(row.schema.$id);
  if (!validate) throw new Error(`SCHEMA_NOT_COMPILED:${name}`);
  return validate;
}

export function schemaErrors(validate) {
  return (validate.errors ?? []).map(error => ({
    code: 'SCHEMA_INVALID',
    path: error.instancePath || '/',
    message: `${error.keyword}: ${error.message}`
  }));
}
