#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ATTESTATION_ROLE_ORDER,
  attestationEvidenceSha256,
  canonicalAttestationMaterial,
} from './attestation-material.mjs';

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleRoot, '../../../..');
const templatePath = path.resolve(moduleRoot, 'prebinding-attestation.sql.tftpl');

function execute(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 60_000,
  });
  if (result.signal || result.status !== 0 || result.error) {
    const detail = String(result.stderr ?? '').slice(0, 4000);
    throw new Error(`${options.label ?? command} failed without emitting credential material (${result.signal ?? result.status ?? result.error?.code}): ${detail}`);
  }
  return result.stdout;
}

function terraformOutput(environmentRoot, name) {
  return JSON.parse(execute('terraform', [`-chdir=${environmentRoot}`, 'output', '-json', name], {
    label: `terraform output ${name}`,
  }));
}

function exactArguments(argv) {
  assert.deepEqual(argv.slice(2, 3), ['--environment'], 'usage: run-prebinding-attestation.mjs --environment staging|production');
  assert.equal(argv.length, 4, 'the attestation runner accepts no host, project, branch, or endpoint override');
  assert.ok(['staging', 'production'].includes(argv[3]), 'environment must be staging or production');
  return argv[3];
}

function isoSeconds(date) {
  return date.toISOString().replace(/\.\d{3}Z$/u, 'Z');
}

export function runPrebindingAttestation(argv = process.argv) {
  const environment = exactArguments(argv);
  const environmentRoot = path.resolve(repositoryRoot, 'infra/terraform/environments', environment);
  const terraformVersion = JSON.parse(execute('terraform', ['version', '-json'], { label: 'terraform version' }));
  assert.equal(terraformVersion.terraform_version, '1.16.0', 'the attestation runner requires pinned Terraform 1.16.0');

  const connection = terraformOutput(environmentRoot, 'neon_bootstrap_maintenance_connection');
  const contract = terraformOutput(environmentRoot, 'neon_bootstrap_contract');
  assert.equal(connection.environment, environment);
  assert.equal(contract.environment, environment);
  for (const field of ['project_id', 'default_branch_id', 'default_endpoint_id', 'direct_host', 'database_name', 'bootstrap_login']) {
    assert.equal(connection[field], contract[field], `resolved Neon output mismatch: ${field}`);
  }
  assert.match(connection.project_id, /^\S+$/u);
  assert.match(connection.default_branch_id, /^\S+$/u);
  assert.match(connection.default_endpoint_id, /^\S+$/u);
  assert.match(connection.direct_host, /^(?!.*(?:^|[.-])pooler(?:[.-]|$))[a-z0-9.-]+$/u, 'only the resolved direct Neon TLS host is permitted');
  assert.equal(connection.database_name, 'ushso');
  assert.equal(connection.bootstrap_login, `ushso_${environment}_bootstrap`);
  assert.equal(typeof connection.password, 'string');
  assert.ok(connection.password.length > 0, 'bootstrap password is absent from the sensitive Terraform output');
  assert.deepEqual(Object.keys(connection.worker_logins).sort(), [...ATTESTATION_ROLE_ORDER].sort());

  const templateSha256 = crypto.createHash('sha256').update(readFileSync(templatePath)).digest('hex');
  assert.equal(contract.verify_template, templateSha256, 'reviewed attestation template differs from the state-bound digest');
  const verifiedAt = new Date();
  verifiedAt.setUTCMilliseconds(0);
  const expiresAt = new Date(verifiedAt.getTime() + 10 * 60 * 1000);

  const variables = {
    environment,
    neon_project_id: connection.project_id,
    neon_branch_id: connection.default_branch_id,
    neon_endpoint_id: connection.default_endpoint_id,
    direct_host: connection.direct_host,
    database_name: connection.database_name,
    bootstrap_login: connection.bootstrap_login,
    verified_at_utc: isoSeconds(verifiedAt),
    expires_at_utc: isoSeconds(expiresAt),
    template_sha256: templateSha256,
  };
  for (const role of ATTESTATION_ROLE_ORDER) variables[`${role}_login`] = connection.worker_logins[role];

  const psqlArguments = [
    '-X', '-A', '-t', '-q', '--no-password',
    `--host=${connection.direct_host}`,
    '--port=5432',
    `--dbname=${connection.database_name}`,
    `--username=${connection.bootstrap_login}`,
    ...Object.entries(variables).map(([name, value]) => `--set=${name}=${value}`),
    `--file=${templatePath}`,
  ];
  const stdout = execute('psql', psqlArguments, {
    label: 'direct TLS catalog attestation',
    env: {
      ...process.env,
      PGPASSWORD: connection.password,
      PGSSLMODE: 'verify-full',
      PGCONNECT_TIMEOUT: '10',
    },
  });
  connection.password = undefined;

  const lines = stdout.split(/\r?\n/u);
  const materialPrefix = 'USHSO_ATTESTATION_MATERIAL_BASE64=';
  const envelopePrefix = 'USHSO_ATTESTATION_ENVELOPE=';
  const materialLine = lines.find((line) => line.startsWith(materialPrefix));
  const envelopeLine = lines.find((line) => line.startsWith(envelopePrefix));
  assert.ok(materialLine, 'SQL did not emit canonical attestation material');
  assert.ok(envelopeLine, 'SQL did not emit the attestation envelope');
  const envelope = JSON.parse(envelopeLine.slice(envelopePrefix.length));
  for (const [field, value] of Object.entries({
    environment,
    neon_project_id: connection.project_id,
    neon_branch_id: connection.default_branch_id,
    neon_endpoint_id: connection.default_endpoint_id,
    direct_host: connection.direct_host,
    verified_at_utc: variables.verified_at_utc,
    expires_at_utc: variables.expires_at_utc,
    template_sha256: templateSha256,
  })) assert.equal(envelope[field], value, `SQL envelope mismatch: ${field}`);

  const material = canonicalAttestationMaterial(envelope);
  assert.equal(
    materialLine.slice(materialPrefix.length),
    Buffer.from(material, 'utf8').toString('base64'),
    'SQL and runner canonical attestation material differ',
  );
  const result = { ...envelope, evidence_sha256: attestationEvidenceSha256(envelope) };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runPrebindingAttestation();
