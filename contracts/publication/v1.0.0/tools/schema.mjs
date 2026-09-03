import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { PACKAGE_ROOT } from './common.mjs';

export async function loadSchemas() {
  const directory = path.join(PACKAGE_ROOT, 'schemas');
  const names = (await fs.readdir(directory)).filter(name => name.endsWith('.schema.json')).sort();
  const schemas = await Promise.all(names.map(async name => JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'))));
  const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: false });
  for (const schema of schemas) ajv.addSchema(schema);
  return { ajv, schemas };
}

export function validatorFor(ajv, name) {
  const validate = ajv.getSchema(`https://ushso.local/contracts/publication/v1.0.0/${name}`);
  if (!validate) throw new Error(`SCHEMA_NOT_LOADED:${name}`);
  return validate;
}

export function validationMessage(validate) {
  return (validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`).join('; ');
}
