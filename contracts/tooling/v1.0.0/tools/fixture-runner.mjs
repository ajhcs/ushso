import fs from 'node:fs/promises';
import path from 'node:path';
import { parseStrictJson, StrictJsonParseError } from './strict-json.mjs';

async function resolveContained(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes('..')) {
    throw new Error(`FIXTURE_PATH_UNSAFE:${relative}`);
  }
  const resolved = path.resolve(root, relative);
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!resolved.startsWith(prefix)) throw new Error(`FIXTURE_PATH_UNSAFE:${relative}`);
  const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(resolved)]);
  if (!realFile.startsWith(`${realRoot}${path.sep}`)) throw new Error(`FIXTURE_PATH_ESCAPES_ROOT:${relative}`);
  return realFile;
}

function rejected(phase, code, details = []) {
  return { accepted: false, rejection: { phase, code, details } };
}

export async function runFixtureManifest({ packageRoot, registry, manifestPath, semanticValidators = {} }) {
  const manifest = parseStrictJson(await fs.readFile(manifestPath, 'utf8'));
  const manifestResult = registry.validate('https://ushso.local/contracts/tooling/v1.0.0/fixture-manifest.schema.json', manifest);
  if (!manifestResult.valid) {
    const error = new Error('FIXTURE_MANIFEST_SCHEMA_INVALID');
    error.errors = manifestResult.errors;
    throw error;
  }
  const ids = new Set();
  for (const entry of manifest.entries) {
    if (ids.has(entry.id)) throw new Error(`FIXTURE_ID_DUPLICATE:${entry.id}`);
    ids.add(entry.id);
  }
  const results = [];
  for (const entry of [...manifest.entries].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
    let outcome;
    try {
      const file = await resolveContained(packageRoot, entry.path);
      const text = await fs.readFile(file, 'utf8');
      let value;
      try {
        value = parseStrictJson(text);
      } catch (error) {
        if (error instanceof StrictJsonParseError) outcome = rejected('parse', error.code);
        else throw error;
      }
      if (!outcome) {
        const schemaResult = registry.validate(entry.schema_id, value);
        if (!schemaResult.valid) outcome = rejected('schema', schemaResult.errors[0]?.keyword ?? 'schema', schemaResult.errors);
      }
      if (!outcome && entry.semantic_validator !== null) {
        const validator = semanticValidators[entry.semantic_validator];
        if (typeof validator !== 'function') outcome = rejected('runner', 'SEMANTIC_VALIDATOR_NOT_REGISTERED');
        else {
          const semantic = await validator(value, { entry, manifest });
          if (semantic !== true && semantic?.ok !== true) outcome = rejected('semantic', semantic?.code ?? 'SEMANTIC_REJECTED', semantic?.errors ?? []);
        }
      }
      outcome ??= { accepted: true, rejection: null };
    } catch (error) {
      outcome = rejected('runner', error.code ?? error.message ?? 'FIXTURE_RUNNER_ERROR');
    }

    const expected = entry.expectation;
    const matchesExpectation = expected === 'valid'
      ? outcome.accepted
      : !outcome.accepted
        && outcome.rejection.phase === entry.expected_rejection.phase
        && (entry.expected_rejection.code === null || outcome.rejection.code === entry.expected_rejection.code);
    results.push({ id: entry.id, expectation: expected, passed: matchesExpectation, outcome });
  }
  return {
    ok: results.every(result => result.passed),
    fixture_count: results.length,
    valid_fixture_count: results.filter(result => result.expectation === 'valid').length,
    adversarial_fixture_count: results.filter(result => result.expectation === 'rejected').length,
    passed_count: results.filter(result => result.passed).length,
    results
  };
}
