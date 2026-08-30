import Ajv2020 from 'ajv/dist/2020.js';
import path from 'node:path';
import { PACKAGE_ROOT, PROJECT_ROOT, readJson } from './package-common.mjs';

function addFormats(ajv) {
  ajv.addFormat('date-time', value => typeof value === 'string' && value.includes('T') && !Number.isNaN(Date.parse(value)));
  ajv.addFormat('date', value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
  ajv.addFormat('uri', value => { try { return Boolean(new URL(value).protocol); } catch { return false; } });
  ajv.addFormat('uri-reference', value => { try { new URL(value, 'https://fixture.invalid'); return true; } catch { return false; } });
}

export async function loadRetrievalValidators() {
  const schemaPaths = {
    record: path.join(PROJECT_ROOT, 'observatory/index/v1.0.0/schemas/observatory-record.schema.json'),
    query: path.join(PACKAGE_ROOT, 'schemas/discovery-query.schema.json'),
    intent: path.join(PACKAGE_ROOT, 'schemas/discovery-intent.schema.json'),
    route: path.join(PACKAGE_ROOT, 'schemas/join-route.schema.json'),
    result: path.join(PACKAGE_ROOT, 'schemas/discovery-result.schema.json'),
    searchDocument: path.join(PACKAGE_ROOT, 'schemas/search-document.schema.json')
  };
  const schemas = {};
  for (const [name, filePath] of Object.entries(schemaPaths)) schemas[name] = await readJson(filePath);
  const ajv = new Ajv2020({ strict: true, strictSchema: true, strictTypes: true, allErrors: true, validateFormats: true });
  addFormats(ajv);
  for (const schema of Object.values(schemas)) ajv.addSchema(schema);
  const validators = {};
  for (const [name, schema] of Object.entries(schemas)) validators[name] = ajv.getSchema(schema.$id) ?? ajv.compile(schema);
  return { ajv, schemas, schemaPaths, validators };
}

export function validationErrors(validate) {
  return (validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`).join('; ');
}
