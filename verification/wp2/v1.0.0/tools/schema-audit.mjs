import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { PROJECT_ROOT, readJson, walkFiles } from './common.mjs';

export const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
export const PROBE_PROPERTY = '__wp2_unexpected_property_probe__';

function rootMayBeObject(schema) {
  if (schema.type === 'object' || schema.properties || schema.required) return true;
  if (Array.isArray(schema.allOf) && schema.allOf.some(item => item?.type === 'object' || item?.properties || item?.required)) return true;
  if (Array.isArray(schema.oneOf) && schema.oneOf.every(item => item?.type === 'object' || item?.properties || item?.required)) return true;
  if (Array.isArray(schema.anyOf) && schema.anyOf.every(item => item?.type === 'object' || item?.properties || item?.required)) return true;
  return false;
}

function rejectsProbeProperty(validate, probe) {
  validate(probe);
  return (validate.errors ?? []).some(error => {
    if (error.keyword === 'additionalProperties') return error.params?.additionalProperty === PROBE_PROPERTY;
    if (error.keyword === 'unevaluatedProperties') return error.params?.unevaluatedProperty === PROBE_PROPERTY;
    return false;
  });
}

export async function auditSchemas(registry, probe) {
  const errors = [];
  const records = [];
  const idOwners = new Map();
  for (const packageDefinition of registry.packages) {
    const packageRoot = path.join(PROJECT_ROOT, packageDefinition.path);
    const relativeFiles = (await walkFiles(packageRoot)).filter(relative => relative.endsWith('.schema.json'));
    if (packageDefinition.schemas_required && relativeFiles.length === 0) errors.push(`SCHEMA_SET_EMPTY:${packageDefinition.package_id}`);
    if (!packageDefinition.schemas_required && relativeFiles.length !== 0) errors.push(`UNEXPECTED_SCHEMA_SET:${packageDefinition.package_id}:${relativeFiles.length}`);
    for (const relative of relativeFiles) {
      const absolute = path.join(packageRoot, relative);
      let schema;
      try { schema = await readJson(absolute); }
      catch (error) { errors.push(`SCHEMA_JSON_INVALID:${packageDefinition.package_id}:${relative}:${error.message}`); continue; }
      if (schema.$schema !== DRAFT_2020_12) errors.push(`SCHEMA_DIALECT_INVALID:${packageDefinition.package_id}:${relative}:${schema.$schema ?? 'missing'}`);
      if (typeof schema.$id === 'string' && schema.$id.length > 0) {
        if (idOwners.has(schema.$id)) errors.push(`SCHEMA_ID_DUPLICATE:${schema.$id}:${idOwners.get(schema.$id)}:${packageDefinition.package_id}/${relative}`);
        else idOwners.set(schema.$id, `${packageDefinition.package_id}/${relative}`);
      }
      const registryKey = typeof schema.$id === 'string' && schema.$id.length > 0
        ? schema.$id
        : `urn:ushso:wp2-schema-audit:${packageDefinition.package_id}:${relative}`;
      records.push({
        package_id: packageDefinition.package_id,
        relative,
        absolute,
        schema,
        registryKey,
        root_object: rootMayBeObject(schema)
      });
    }
  }

  const ajv = new Ajv2020({
    strict: true,
    strictSchema: true,
    strictTypes: true,
    allErrors: true,
    validateFormats: false
  });
  for (const record of records) {
    try { ajv.addSchema(record.schema, record.registryKey); }
    catch (error) { errors.push(`SCHEMA_REGISTRATION_FAILED:${record.package_id}:${record.relative}:${error.message}`); }
  }

  const packageResults = new Map(registry.packages.map(item => [item.package_id, {
    package_id: item.package_id,
    schema_count: 0,
    compiled_schema_count: 0,
    root_object_schema_count: 0,
    unexpected_property_probe_count: 0,
    schema_ids_sha256_material: []
  }]));
  for (const record of records) {
    const result = packageResults.get(record.package_id);
    result.schema_count += 1;
    result.schema_ids_sha256_material.push(record.registryKey);
    let validate;
    try {
      validate = ajv.getSchema(record.registryKey);
      if (!validate) throw new Error('validator not returned');
      result.compiled_schema_count += 1;
    } catch (error) {
      errors.push(`SCHEMA_COMPILE_FAILED:${record.package_id}:${record.relative}:${error.message}`);
      continue;
    }
    if (record.root_object) {
      result.root_object_schema_count += 1;
      if (rejectsProbeProperty(validate, probe)) result.unexpected_property_probe_count += 1;
      else errors.push(`UNEXPECTED_PROPERTY_NOT_REJECTED:${record.package_id}:${record.relative}`);
    }
  }
  for (const result of packageResults.values()) result.schema_ids_sha256_material.sort();
  return { packageResults, errors, records };
}

export async function validateReceiptSchema(receipt) {
  const schema = await readJson(path.join(PROJECT_ROOT, 'verification/wp2/v1.0.0/schemas/validation-receipt.schema.json'));
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  const validate = ajv.compile(schema);
  return { valid: validate(receipt), errors: validate.errors ?? [] };
}
