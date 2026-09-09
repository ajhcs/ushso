import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
export async function createSuccessorValidators({ schemaDirectory = new URL('../schemas/', import.meta.url), dependencyRoot = new URL('../../../', import.meta.url) } = {}) {
  const ajv = new Ajv2020({ strict: false, validateFormats: false, loadSchema: async id => {
    const url = new URL(id);
    if (url.origin !== 'https://ushso.org' || !url.pathname.startsWith('/contracts/')) throw Error('SCHEMA_REFERENCE_OUT_OF_SCOPE');
    const relative = url.pathname.slice('/contracts/'.length);
    if (relative.split('/').some(x => !x || x === '.' || x === '..')) throw Error('SCHEMA_REFERENCE_OUT_OF_SCOPE');
    return JSON.parse(await fs.readFile(new URL(relative, dependencyRoot)));
  } });
  for (const name of ['common.schema.json', 'result-types.schema.json']) ajv.addSchema(JSON.parse(await fs.readFile(new URL(name, schemaDirectory))));
  const validators = new Map();
  for (const name of (await fs.readdir(schemaDirectory)).filter(name => name.endsWith('-response.schema.json')).sort()) {
    validators.set(name.replace('-response.schema.json', '').replaceAll('-', '_'), await ajv.compileAsync(JSON.parse(await fs.readFile(new URL(name, schemaDirectory)))));
  }
  if (validators.size !== 9) throw Error('SUCCESSOR_SCHEMA_COUNT');
  return validators;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const validators = await createSuccessorValidators();
  console.log(JSON.stringify({ status: 'pass', compiled_response_schemas: [...validators.keys()], approval: 'pending', historical_contracts_modified: false }));
}
