import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY_ROOT, ROOT, readJson, sha256File, writeAtomic } from './common.mjs';
import { ADVERSARIAL_CASES, buildFixtureBundle } from './fixture-data.mjs';

export async function buildFixtures() {
  const manifest = await readJson(path.join(ROOT, 'contracts', 'toolkit-manifest.json'));
  const bundle = buildFixtureBundle(manifest);
  const dependencyPath = path.join(REPOSITORY_ROOT, 'contracts', 'research-plan', 'v1.0.0', 'schemas', 'research-plan.schema.json');
  const dependencyPin = {
    contract_version: 'observatory-machine-toolkit-dependency-pin.v1.0.0',
    dependency_package: '@ushso/research-plan-contract',
    dependency_version: '1.0.0',
    schema_id: 'https://ushso.org/contracts/research-plan/v1.0.0/schemas/research-plan.schema.json',
    schema_path: 'contracts/research-plan/v1.0.0/schemas/research-plan.schema.json',
    schema_file_sha256: await sha256File(dependencyPath),
    compatibility: 'exact_external_schema_reference_no_local_redefinition'
  };
  await writeAtomic(path.join(ROOT, 'fixtures', 'conformance.json'), `${JSON.stringify(bundle, null, 2)}\n`);
  await writeAtomic(path.join(ROOT, 'fixtures', 'adversarial-cases.json'), `${JSON.stringify(ADVERSARIAL_CASES, null, 2)}\n`);
  await writeAtomic(path.join(ROOT, 'contracts', 'dependency-pin.json'), `${JSON.stringify(dependencyPin, null, 2)}\n`);
  return { bundle, adversarial: ADVERSARIAL_CASES, dependencyPin };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await buildFixtures();
  process.stdout.write(`${JSON.stringify({
    status: 'built',
    conformance_cases: result.bundle.conformance_cases.length,
    adversarial_cases: result.adversarial.cases.length,
    dependency_schema_file_sha256: result.dependencyPin.schema_file_sha256
  })}\n`);
}
