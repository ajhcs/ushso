import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { PACKAGE_ROOT, readJson } from './common.mjs';

let cache;

function validUtcInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

export function validationMessage(validate) {
  return (validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`).join('; ');
}

export async function loadSchemas() {
  if (cache) return cache;
  const schemaRoot = path.join(PACKAGE_ROOT, 'schemas');
  const names = (await fs.readdir(schemaRoot)).filter(name => name.endsWith('.schema.json')).sort();
  const ajv = new Ajv2020({
    strict: true,
    strictSchema: true,
    strictTypes: true,
    allErrors: true,
    validateFormats: true
  });
  ajv.addFormat('utc-instant', { type: 'string', validate: validUtcInstant });
  const schemas = [];
  for (const name of names) schemas.push({ name, schema: await readJson(path.join(schemaRoot, name)) });
  for (const { schema } of schemas) ajv.addSchema(schema);
  for (const { schema } of schemas) {
    if (!ajv.getSchema(schema.$id)) throw new Error(`SCHEMA_NOT_COMPILED:${schema.$id}`);
  }
  cache = { ajv, schemas };
  return cache;
}

export async function validatorFor(name) {
  const { ajv, schemas } = await loadSchemas();
  const found = schemas.find(item => item.name === name);
  if (!found) throw new Error(`SCHEMA_NOT_FOUND:${name}`);
  const validate = ajv.getSchema(found.schema.$id);
  if (!validate) throw new Error(`SCHEMA_NOT_COMPILED:${name}`);
  return validate;
}
