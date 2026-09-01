import crypto from 'node:crypto';

export const ATTESTATION_MATERIAL_VERSION = 'ushso-database-origin-attestation.v1';
export const ATTESTATION_ROLE_ORDER = Object.freeze([
  'public', 'scheduler', 'harvest', 'normalize', 'projector', 'ops',
]);
export const ATTESTATION_ROLE_FIELDS = Object.freeze([
  'database_role',
  'login_user',
  'rolsuper',
  'rolbypassrls',
  'rolreplication',
  'rolcreatedb',
  'rolcreaterole',
  'capability_member',
  'neon_superuser_member',
  'unexpected_membership',
]);

const TOP_LEVEL_FIELDS = Object.freeze([
  'environment',
  'neon_project_id',
  'neon_branch_id',
  'neon_endpoint_id',
  'direct_host',
  'verified_at_utc',
  'expires_at_utc',
  'template_sha256',
]);

export function canonicalAttestationMaterial(attestation) {
  const lines = [ATTESTATION_MATERIAL_VERSION];
  for (const field of TOP_LEVEL_FIELDS) lines.push(`${field}=${attestation[field]}`);
  for (const role of ATTESTATION_ROLE_ORDER) {
    for (const field of ATTESTATION_ROLE_FIELDS) {
      lines.push(`roles.${role}.${field}=${attestation.roles[role][field]}`);
    }
  }
  return lines.join('\n');
}

export function attestationEvidenceSha256(attestation) {
  return crypto.createHash('sha256').update(canonicalAttestationMaterial(attestation), 'utf8').digest('hex');
}
