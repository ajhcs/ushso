import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ROOT, readJson } from './common.mjs';

function formats(ajv) {
  ajv.addFormat('date-time', value => typeof value === 'string' && value.includes('T') && !Number.isNaN(Date.parse(value)));
  ajv.addFormat('date', value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
  ajv.addFormat('uri-reference', value => { try { new URL(value, 'https://fixture.invalid'); return true; } catch { return false; } });
}

export async function loadSchemas() {
  const directory = path.join(ROOT, 'schemas');
  const rows = [];
  for (const name of (await fs.readdir(directory)).filter(name => name.endsWith('.schema.json')).sort()) rows.push({ name, schema: await readJson(path.join(directory, name)) });
  const ajv = new Ajv2020({ strict: true, strictSchema: true, strictTypes: true, allErrors: true, validateFormats: true });
  formats(ajv);
  for (const row of rows) ajv.addSchema(row.schema, row.schema.$id ?? row.name);
  return { ajv, rows };
}

export function schemaError(validate) { return (validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`).join('; '); }
