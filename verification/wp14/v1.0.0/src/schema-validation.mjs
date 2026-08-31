import Ajv2020 from "ajv/dist/2020.js";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { packageRoot, readJson } from "./common.mjs";

const schemasDirectory = resolve(packageRoot, "schemas");

function buildAjv() {
  return new Ajv2020({
    allErrors: true,
    coerceTypes: false,
    messages: true,
    ownProperties: true,
    removeAdditional: false,
    strict: true,
    strictNumbers: true,
    strictRequired: true,
    strictSchema: true,
    strictTuples: true,
    strictTypes: true,
    useDefaults: false,
    validateFormats: false,
    validateSchema: true,
  });
}

function formatErrors(errors = []) {
  return errors
    .map((error) => ({
      instance_path: error.instancePath || "/",
      keyword: error.keyword,
      message: error.message ?? "schema validation failed",
      params: error.params,
      schema_path: error.schemaPath,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function compileSchemaRegistry() {
  const ajv = buildAjv();
  const files = readdirSync(schemasDirectory)
    .filter((name) => name.endsWith(".schema.json"))
    .sort();
  const records = files.map((file) => {
    const schema = readJson(resolve(schemasDirectory, file));
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
      throw new Error(`SCHEMA_DIALECT_INVALID:${file}`);
    }
    if (typeof schema.$id !== "string" || schema.$id.length === 0) {
      throw new Error(`SCHEMA_ID_MISSING:${file}`);
    }
    return { file, schema };
  });
  const ids = records.map(({ schema }) => schema.$id);
  if (new Set(ids).size !== ids.length) throw new Error("SCHEMA_ID_DUPLICATE");
  for (const { schema } of records) ajv.addSchema(schema);
  const validators = new Map(records.map(({ file, schema }) => {
    const validate = ajv.getSchema(schema.$id);
    if (!validate) throw new Error(`SCHEMA_NOT_COMPILED:${file}`);
    return [file, validate];
  }));
  return { ajv, files, records, validators };
}

let registry;

export function schemaRegistry() {
  registry ??= compileSchemaRegistry();
  return registry;
}

export function validateSchema(schemaFile, value) {
  const validate = schemaRegistry().validators.get(schemaFile);
  if (!validate) throw new Error(`SCHEMA_UNKNOWN:${schemaFile}`);
  const ok = validate(value);
  return { ok: Boolean(ok), errors: ok ? [] : formatErrors(validate.errors) };
}

export function assertSchema(schemaFile, value, errorCode = "SCHEMA_VALIDATION_FAILED") {
  const result = validateSchema(schemaFile, value);
  if (!result.ok) {
    const error = new Error(`${errorCode}:${schemaFile}:${JSON.stringify(result.errors)}`);
    error.code = errorCode;
    error.details = { schema: schemaFile, errors: result.errors };
    throw error;
  }
  return true;
}

export function resetSchemaRegistryForTests() {
  registry = undefined;
}
