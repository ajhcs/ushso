import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { PACKAGE_ROOT, readJson } from './common.mjs';

let cache;

export function validationMessage(validate) {
  return (validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`).join('; ');
}

export async function loadSchemas() {
  if (cache) return cache;
  const schemaRoot = path.join(PACKAGE_ROOT, 'schemas');
  const names = (await fs.readdir(schemaRoot)).filter(name => name.endsWith('.schema.json')).sort();
  const ajv = new Ajv2020({ strict: true, strictSchema: true, strictTypes: true, allErrors: true, validateFormats: true });
  ajv.addFormat('https-uri', value => {
    try { const url = new URL(value); return url.protocol === 'https:' && Boolean(url.hostname); } catch { return false; }
  });
  const schemas = [];
  for (const name of names) {
    const schema = await readJson(path.join(schemaRoot, name));
    ajv.addSchema(schema);
    schemas.push({ name, schema });
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
  return { ajv, schemas, validate };
}
