import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ROOT, readJson } from './common.mjs';

function addFormats(ajv) {
  ajv.addFormat('date-time', value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && !Number.isNaN(Date.parse(value)));
  ajv.addFormat('date', value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
  ajv.addFormat('uri', value => {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && url.username === '' && url.password === '';
    } catch { return false; }
  });
}

export async function loadSchemas() {
  const directory = path.join(ROOT, 'schemas');
  const rows = [];
  for (const name of (await fs.readdir(directory)).filter(name => name.endsWith('.schema.json')).sort()) {
    rows.push({ name, schema: await readJson(path.join(directory, name)) });
  }
  const ajv = new Ajv2020({
    strict: true,
    strictSchema: true,
    strictTypes: true,
    strictRequired: true,
    allErrors: true,
    validateFormats: true,
    allowUnionTypes: false
  });
  addFormats(ajv);
  for (const { name, schema } of rows) ajv.addSchema(schema, schema.$id ?? name);
  return { ajv, rows };
}

export function schemaErrors(validate, prefix = '') {
  return (validate.errors ?? []).map(error => ({
    code: 'SCHEMA_INVALID',
    path: `${prefix}${error.instancePath || '/'}`,
    message: `${error.keyword}: ${error.message}`
  }));
}
