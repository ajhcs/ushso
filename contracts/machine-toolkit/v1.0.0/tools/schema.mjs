import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { REPOSITORY_ROOT, ROOT, readJson } from './common.mjs';

function addFormats(ajv) {
  ajv.addFormat('date-time', value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && !Number.isNaN(Date.parse(value)));
  ajv.addFormat('date', value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
  ajv.addFormat('uri', value => {
    try {
      const parsed = new URL(value);
      return ['https:', 'http:'].includes(parsed.protocol) && parsed.username === '' && parsed.password === '';
    } catch { return false; }
  });
}

async function jsonSchemas(directory, dependency = false) {
  const rows = [];
  for (const name of (await fs.readdir(directory)).filter(value => value.endsWith('.schema.json')).sort()) {
    rows.push({ name: dependency ? `research-plan/${name}` : name, schema: await readJson(path.join(directory, name)), dependency });
  }
  return rows;
}

export async function loadSchemas() {
  const local = await jsonSchemas(path.join(ROOT, 'schemas'));
  const researchPlan = await jsonSchemas(path.join(REPOSITORY_ROOT, 'contracts', 'research-plan', 'v1.0.0', 'schemas'), true);
  const rows = [...researchPlan, ...local];
  const ajv = new Ajv2020({ strict: true, strictSchema: true, strictTypes: true, strictRequired: true, allErrors: true, validateFormats: true });
  addFormats(ajv);
  for (const row of rows) ajv.addSchema(row.schema, row.schema.$id ?? row.name);
  return { ajv, rows, localRows: local, dependencyRows: researchPlan };
}

export function schemaErrors(validate, prefix = '') {
  return (validate.errors ?? []).map(error => ({
    code: 'SCHEMA_INVALID',
    path: `${prefix}${error.instancePath || '/'}`,
    message: `${error.keyword}: ${error.message}`
  }));
}
