#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

export const PACKAGE_VERSION = '1.2.0';
export const SCHEMA_VERSION = 'ushso.variable-identity.v1.2.0';
export const SCHEMA_ID =
  'https://ushso.org/contracts/machine-toolkit/v1.2.0/schemas/variable-identity.schema.json';
export const EXPECTED_REQUIRED_FIELDS = [
  'schema_version',
  'variable_id',
  'context_binding',
  'wire_name',
  'publisher_label',
  'publisher_concept',
  'definition',
  'source_type',
  'observed_type',
  'semantic_role',
  'unit',
  'code_values',
  'missingness',
  'mapping',
  'provenance',
  'evidence_ids',
  'evidence_state',
  'completeness',
  'limitations',
  'publication_authorized',
  'promotion_eligible',
];

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = path.join(PACKAGE_ROOT, 'schemas', 'variable-identity.schema.json');

export async function readVariableIdentitySchema() {
  const bytes = await readFile(SCHEMA_PATH);
  return {
    bytes,
    schema: JSON.parse(bytes.toString('utf8')),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function visitSchema(value, visitor) {
  if (Array.isArray(value)) {
    for (const item of value) visitSchema(item, visitor);
    return;
  }
  if (value !== null && typeof value === 'object') {
    visitor(value);
    for (const child of Object.values(value)) visitSchema(child, visitor);
  }
}

export function assertSchemaBoundary(schema) {
  if (schema.$id !== SCHEMA_ID) throw new Error('VARIABLE_SCHEMA_ID');
  if (schema.title !== 'USHSO variable identity') throw new Error('VARIABLE_SCHEMA_TITLE');
  if (schema.type !== 'object' || schema.additionalProperties !== false) {
    throw new Error('VARIABLE_SCHEMA_CLOSED_OBJECT');
  }
  if (schema.properties?.schema_version?.const !== SCHEMA_VERSION) {
    throw new Error('VARIABLE_SCHEMA_VERSION');
  }
  if (
    JSON.stringify(schema.required) !== JSON.stringify(EXPECTED_REQUIRED_FIELDS)
  ) {
    throw new Error('VARIABLE_SCHEMA_REQUIRED_FIELDS');
  }
  visitSchema(schema, value => {
    if (typeof value.$ref === 'string' && !value.$ref.startsWith('#/')) {
      throw new Error('VARIABLE_SCHEMA_EXTERNAL_REF');
    }
  });
  return schema;
}

export async function createVariableIdentityValidator() {
  const loaded = await readVariableIdentitySchema();
  assertSchemaBoundary(loaded.schema);
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictSchema: true,
    strictTypes: true,
    validateFormats: false,
  });
  return {
    ...loaded,
    validate: ajv.compile(loaded.schema),
  };
}

export async function verify() {
  const { schema, sha256, validate } = await createVariableIdentityValidator();
  if (schema.$id !== SCHEMA_ID || !validate) throw new Error('VARIABLE_SCHEMA_COMPILE');
  return {
    status: 'pass',
    package: '@ushso/machine-toolkit-variable-identity-v1.2',
    version: PACKAGE_VERSION,
    schema_id: SCHEMA_ID,
    schema_version: SCHEMA_VERSION,
    schema_sha256: sha256,
    external_references: 0,
    publication_authorized: false,
    promotion_eligible: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await verify()));
}
