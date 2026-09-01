import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runPsql } from '../../../db/tools/common.mjs';
import { semanticErrors } from '../../../contracts/core/v2.0.0/tools/semantics.mjs';
import { canonicalJson } from './canonical.mjs';
import { assertDatabaseImportSemantics } from './database-semantics.mjs';
import { assertImportMappings } from './mapping-reconciliation.mjs';
import { loadLegacyCorpus } from './legacy-loader.mjs';
import { normalizeLegacyCorpus } from './normalize.mjs';

const LOCAL_DEPLOYMENT_FINGERPRINT = '0'.repeat(64);
const AUTHORIZATION_RECEIPT_VERSION = 'ushso-normalization-managed-authorization.v1.0.0';

function dollarQuote(json, seed) {
  for (let index = 0; index < 100; index += 1) {
    const tag = `ushso_wp6_${seed.slice(0, 12)}_${index}`;
    const delimiter = `$${tag}$`;
    if (!json.includes(delimiter)) return `${delimiter}${json}${delimiter}`;
  }
  throw new Error('IMPORT_DOCUMENT_DOLLAR_QUOTE_EXHAUSTED');
}

function exactKeys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\u0000') === [...expected].sort().join('\u0000');
}

export function verifyManagedAuthorizationReceipt(receipt, expected, { now = Date.now() } = {}) {
  const topKeys = [
    'receipt_version', 'authorization_id', 'authorized', 'environment', 'database',
    'deployment_fingerprint', 'action', 'parameters', 'reviewer', 'approved_at', 'expires_at'
  ];
  if (!exactKeys(receipt, topKeys)
      || receipt.receipt_version !== AUTHORIZATION_RECEIPT_VERSION
      || receipt.authorized !== true
      || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{7,239}$/u.test(receipt.authorization_id ?? '')
      || !['staging', 'production'].includes(receipt.environment)
      || receipt.environment !== expected.environment
      || receipt.database !== expected.database
      || receipt.deployment_fingerprint !== expected.deploymentFingerprint
      || receipt.action !== expected.action
      || canonicalJson(receipt.parameters) !== canonicalJson(expected.parameters)
      || typeof receipt.reviewer !== 'string'
      || receipt.reviewer.length < 3
      || receipt.reviewer.length > 240) {
    throw new Error(`authorization receipt does not authorize exact action: ${expected.action}`);
  }
  const approvedAt = Date.parse(receipt.approved_at);
  const expiresAt = Date.parse(receipt.expires_at);
  if (!Number.isFinite(approvedAt) || !Number.isFinite(expiresAt)
      || approvedAt > now || expiresAt <= now || expiresAt <= approvedAt
      || expiresAt - approvedAt > 24 * 60 * 60 * 1000) {
    throw new Error('authorization receipt is not currently valid');
  }
  return Object.freeze({ authorizationId: receipt.authorization_id, approvedAt: receipt.approved_at, expiresAt: receipt.expires_at });
}

function resolveDeploymentFingerprint(environment, deploymentFingerprint) {
  const resolved = deploymentFingerprint ?? (environment === 'local' ? LOCAL_DEPLOYMENT_FINGERPRINT : null);
  if (!/^[a-f0-9]{64}$/u.test(resolved ?? '')) throw new TypeError('deploymentFingerprint must be a 64-character lowercase SHA-256');
  if (environment !== 'local' && resolved === LOCAL_DEPLOYMENT_FINGERPRINT) throw new TypeError('managed deploymentFingerprint cannot be the local sentinel');
  return resolved;
}

async function assertAuthorization({ environment, database, deploymentFingerprint, authorizationReceipt, action, parameters }) {
  if (environment === 'local') return;
  if (!authorizationReceipt) throw new Error(`${action} is pending_external_authorization`);
  const receipt = JSON.parse(await readFile(path.resolve(authorizationReceipt), 'utf8'));
  verifyManagedAuthorizationReceipt(receipt, { environment, database, deploymentFingerprint, action, parameters });
}

export async function buildProductionImportDocument() {
  const legacy = await loadLegacyCorpus();
  const normalized = normalizeLegacyCorpus(legacy);
  const errors = semanticErrors(normalized.bundle);
  if (errors.length) throw new Error(`CANONICAL_SEMANTIC_VALIDATION_FAILED:${JSON.stringify(errors.slice(0, 10))}`);
  assertDatabaseImportSemantics(normalized.bundle);
  assertImportMappings(normalized);
  return normalized;
}

export function applyImportDocument(document, {
  container = null,
  database = 'ushso',
  user = 'ushso_normalize',
  assumeMaintenanceRole = container === null,
  environment = 'local',
  deploymentFingerprint = LOCAL_DEPLOYMENT_FINGERPRINT
} = {}) {
  if (!['local', 'staging', 'production'].includes(environment)
      || !/^[a-f0-9]{64}$/u.test(deploymentFingerprint)) {
    throw new TypeError('exact database environment fence is required');
  }
  const json = JSON.stringify(document);
  assertDatabaseImportSemantics(document.bundle);
  assertImportMappings({ plan: document.plan, bundle: document.bundle });
  const quoted = dollarQuote(json, document.document_fingerprint.slice(7));
  const roleSql = assumeMaintenanceRole ? 'set local role ushso_maintenance;' : '';
  const output = runPsql({
    container, database, user, tuplesOnly: true,
    sql: `begin;
      set local statement_timeout = '60s';
      ${roleSql}
      select catalog.apply_normalization_import_guarded(
        ${quoted}::jsonb, '${environment}', '${deploymentFingerprint}'
      )::text;
      commit;`
  }).stdout.trim();
  return JSON.parse(output);
}

export async function applyProductionImport({ container = null, database = 'ushso', user = 'ushso_normalize', environment, deploymentFingerprint = null, authorizationReceipt = null }) {
  if (!['local', 'staging', 'production'].includes(environment)) throw new TypeError('environment must be local, staging, or production');
  const resolvedDeploymentFingerprint = resolveDeploymentFingerprint(environment, deploymentFingerprint);
  const normalized = await buildProductionImportDocument();
  await assertAuthorization({
    environment,
    database,
    deploymentFingerprint: resolvedDeploymentFingerprint,
    authorizationReceipt,
    action: 'normalization_import_v1_1_0',
    parameters: {
      import_id: normalized.import_id,
      document_fingerprint: normalized.importDocument.document_fingerprint,
      bundle_fingerprint: normalized.plan.bundle_fingerprint,
      projection_fingerprint: normalized.plan.projection_fingerprint,
      normalizer_name: normalized.plan.normalizer.name,
      normalizer_version: normalized.plan.normalizer.version
    }
  });
  const result = applyImportDocument(normalized.importDocument, {
    container,
    database,
    user,
    assumeMaintenanceRole: container === null,
    environment,
    deploymentFingerprint: resolvedDeploymentFingerprint
  });
  if (!['applied', 'already_applied'].includes(result.status)) throw new Error(`DATABASE_IMPORT_UNEXPECTED_STATUS:${result.status}`);
  return { ...result, document_fingerprint: normalized.importDocument.document_fingerprint, bundle_fingerprint: normalized.plan.bundle_fingerprint };
}

export async function rejectProductionImport({ importId, reason, auditEventId, recordedAt, container = null, database = 'ushso', user = 'postgres', environment, deploymentFingerprint = null, authorizationReceipt = null }) {
  if (!['local', 'staging', 'production'].includes(environment)) throw new TypeError('environment must be local, staging, or production');
  const resolvedDeploymentFingerprint = resolveDeploymentFingerprint(environment, deploymentFingerprint);
  await assertAuthorization({
    environment,
    database,
    deploymentFingerprint: resolvedDeploymentFingerprint,
    authorizationReceipt,
    action: 'normalization_import_reject',
    parameters: { import_id: importId, reason, audit_event_id: auditEventId, recorded_at: recordedAt }
  });
  const literals = [importId, reason, auditEventId, recordedAt].map((value, index) => dollarQuote(String(value), `${index}${String(value).length}`));
  const output = runPsql({
    container, database, user, tuplesOnly: true,
    sql: `begin;
      set local statement_timeout = '60s';
      set local role ushso_maintenance;
      select catalog.reject_import_batch_guarded(
        ${literals[0]}, ${literals[1]}, ${literals[2]}, ${literals[3]}::timestamptz,
        '${environment}', '${resolvedDeploymentFingerprint}'
      )::text;
      commit;`
  }).stdout.trim();
  return JSON.parse(output);
}
