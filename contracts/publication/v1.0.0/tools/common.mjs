import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const COMPONENT_KINDS = Object.freeze([
  'asset_search',
  'release_distribution_search',
  'schema_field_search',
  'source_search',
  'join_edge_search',
  'seo',
  'coverage'
]);

export const BARRIERS = Object.freeze([
  'complete_sealed_enumeration',
  'membership_checkpoint_committed',
  'terminal_normalized_or_excluded',
  'w1_sealed',
  'all_projection_obligations_acknowledged',
  'references_resolved',
  'checksums_verified',
  'visibility_reconciled',
  'search_seo_coverage_reconciled'
]);

export const DOMAIN_PREFIX = Object.freeze({
  canonical_revision_membership: 'ushso:publication:canonical_revision_membership:v1',
  projection_document: 'ushso:publication:projection_document:v1',
  projection_set: 'ushso:publication:projection_set:v1',
  component_generation: 'ushso:publication:component_generation:v1',
  full_snapshot_build: 'ushso:publication:full_snapshot_build:v1',
  publication_manifest: 'ushso:publication:publication_manifest:v1',
  legacy_static_compatibility: 'ushso:publication:legacy_static_compatibility:v1',
  package_manifest: 'ushso:publication:package_manifest:v1'
});

export function compareUnicodeCodePoints(left, right) {
  const leftPoints = Array.from(left, character => character.codePointAt(0));
  const rightPoints = Array.from(right, character => character.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compareUnicodeCodePoints).map(key => [key, canonicalValue(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function canonicalDigestValue(domain, value) {
  const prefix = DOMAIN_PREFIX[domain];
  if (!prefix) throw new Error(`UNKNOWN_DIGEST_DOMAIN:${domain}`);
  return sha256Bytes(`${prefix}\n${canonicalJson(value)}`);
}

export function digest(domain, value) {
  return { algorithm: 'sha256', canonicalization: 'ushso-canonical-json-v1', domain, value: canonicalDigestValue(domain, value) };
}

export function membershipMaterial(manifest) {
  return {
    selection_model: manifest.selection_model,
    canonical_as_of: manifest.canonical_as_of,
    member_order: manifest.member_order,
    members: manifest.members
  };
}

export function projectionDocumentMaterial(document) {
  return {
    projection_version: document.projection_version,
    document_id: document.document_id,
    document_type: document.document_type,
    projection_schema_version: document.projection_schema_version,
    canonical_revisions: document.canonical_revisions,
    projection_input_refs: document.projection_input_refs,
    visibility_state: document.visibility_state,
    truth_refs: document.truth_refs,
    content: document.content,
    source_of_truth: document.source_of_truth
  };
}

export function projectionSetMaterial(component) {
  return [...component.document_refs]
    .sort((left, right) => left.document_id.localeCompare(right.document_id))
    .map(item => ({ document_id: item.document_id, document_checksum: item.document_checksum }));
}

export function componentMaterial(component, acknowledgements) {
  const normalized = acknowledgements
    .filter(item => item.generation_id === component.generation_id)
    .sort((left, right) => compareUnicodeCodePoints(`${left.canonical_id}\u0000${left.revision_id}`, `${right.canonical_id}\u0000${right.revision_id}`))
    .map(item => ({
      canonical_id: item.canonical_id,
      revision_id: item.revision_id,
      visibility_state: item.visibility_state,
      result: item.result,
      document_refs: item.document_refs,
      exclusion: item.exclusion
    }));
  return {
    component_kind: component.component_kind,
    canonical_manifest_ref: component.canonical_manifest_ref,
    projector: component.projector,
    projection_schema_version: component.projection_schema_version,
    build_strategy: component.build_strategy,
    document_refs: projectionSetMaterial(component),
    acknowledgements: normalized
  };
}

export function buildMaterial(receipt, components) {
  const checksums = receipt.component_generation_refs
    .map(ref => components.find(item => item.generation_id === ref.generation_id))
    .filter(Boolean)
    .sort((left, right) => left.component_kind.localeCompare(right.component_kind))
    .map(item => ({ component_kind: item.component_kind, component_checksum: item.component_checksum }));
  return {
    build_strategy: receipt.build_strategy,
    candidate_outcome: receipt.candidate_outcome,
    canonical_manifest_ref: receipt.canonical_manifest_ref,
    component_checksums: checksums,
    barriers: receipt.barriers,
    counts: receipt.counts,
    degraded_optional_stages: receipt.degraded_optional_stages
  };
}

export function publicationMaterial(manifest) {
  const { publication_digest: ignoredDigest, immutable: ignoredImmutable, ...material } = manifest;
  return material;
}

export function legacyMaterial(manifest) {
  const { manifest_digest: ignoredDigest, immutable: ignoredImmutable, ...material } = manifest;
  return material;
}

export async function pathExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function sha256File(file) {
  return sha256Bytes(await fs.readFile(file));
}

export async function walkFiles(root) {
  const output = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.git'].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) output.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  }
  await visit(root);
  return output.sort();
}

export function clone(value) {
  return structuredClone(value);
}

export function mutateAtPath(value, pointer, replacement) {
  const result = clone(value);
  const parts = pointer.split('/').slice(1).map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let cursor = result;
  for (const part of parts.slice(0, -1)) cursor = cursor[Array.isArray(cursor) ? Number(part) : part];
  const final = parts.at(-1);
  if (replacement && typeof replacement === 'object' && replacement.$delete === true) {
    if (Array.isArray(cursor)) cursor.splice(Number(final), 1);
    else delete cursor[final];
  } else cursor[Array.isArray(cursor) ? Number(final) : final] = replacement;
  return result;
}
