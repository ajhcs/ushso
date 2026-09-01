import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLAN_CONTRACT_VERSION = 'observatory-research-plan.v1.0.0';
export const CANONICALIZATION_ALGORITHM = 'ushso-canonical-json.v1.0.0';

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function assertValidString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('CANONICAL_JSON_LONE_SURROGATE');
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError('CANONICAL_JSON_LONE_SURROGATE');
    }
  }
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    assertValidString(value);
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new TypeError('CANONICAL_JSON_NUMBER_POLICY');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort(compareUtf8);
    return `{${keys.map(key => `${canonicalJson(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError(`CANONICAL_JSON_UNSUPPORTED:${typeof value}`);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalDigest(value) {
  return `sha256:${sha256(Buffer.from(canonicalJson(value), 'utf8'))}`;
}

export async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function canonicalPlanBody(plan) {
  const body = structuredClone(plan);
  delete body.plan_id;
  return body;
}

export function planDigest(plan) {
  return canonicalDigest(canonicalPlanBody(plan));
}

export function normalizedRequestDigest(request) {
  const body = structuredClone(request);
  delete body.normalized_request_hash;
  return canonicalDigest(body);
}

export function clarificationQuestionSetDigest(questions) {
  return canonicalDigest(questions.map(question => {
    const stable = structuredClone(question);
    delete stable.answered;
    return stable;
  }));
}

export function criticalClaimProjection(plan) {
  const exactContributions = plan.asset_contributions.filter(contribution => contribution.selection_level === 'exact_distribution' && !['rejected', 'unavailable'].includes(contribution.recommendation_state));
  return {
    plan_status: plan.plan_status,
    plan_status_reason_codes: [...plan.plan_status_reason_codes],
    essential_role_ids: plan.interpreted_need.required_roles.filter(role => role.essential).map(role => role.role_id),
    exact_contribution_ids: exactContributions.map(contribution => contribution.contribution_id),
    exact_selections: exactContributions.map(contribution => ({
      contribution_id: contribution.contribution_id,
      role_id: contribution.role_id,
      asset_id: contribution.asset_id,
      release_id: contribution.release_id,
      distribution_id: contribution.distribution_id,
      access_route_id: contribution.access_route_id,
      source_id: contribution.source_id
    })),
    coverage: {
      requested: structuredClone(plan.bundle_assessment.requested_coverage),
      source_supported: structuredClone(plan.bundle_assessment.source_supported_coverage),
      common_supported: structuredClone(plan.bundle_assessment.common_supported_coverage)
    },
    access: exactContributions.map(contribution => ({
      contribution_id: contribution.contribution_id,
      access_class: contribution.access.access_class,
      authorization_state: contribution.access.authorization_state,
      requirements: contribution.access.requirements.map(requirement => ({ requirement_id: requirement.requirement_id, kind: requirement.kind, state: requirement.state })),
      human_gates: contribution.access.human_gates.map(gate => ({ gate_id: gate.gate_id, kind: gate.kind, state: gate.state }))
    })),
    operations: plan.operations.map(operation => ({
      operation_id: operation.operation_id,
      operation_kind: operation.operation_kind,
      evidence_state: operation.evidence_state,
      basis_evidence_state: operation.basis_evidence_state,
      compatibility: operation.compatibility,
      requirements: operation.requirements.map(requirement => ({ requirement_id: requirement.requirement_id, kind: requirement.kind, state: requirement.state })),
      blockers: operation.blockers.map(blocker => ({ blocker_id: blocker.blocker_id, kind: blocker.kind, state: blocker.state, fatal: blocker.fatal }))
    })),
    downstream_support: plan.downstream_handoff.analysis_decisions.map(decision => ({
      analysis_id: decision.analysis_id,
      classification: decision.classification,
      source_support_state: decision.source_support_state
    })),
    limitation_ids: plan.important_limitations.map(item => item.claim_id),
    gap_ids: plan.unresolved_gaps.map(item => item.claim_id),
    truth_boundary: structuredClone(plan.truth_boundary)
  };
}

export function criticalClaimDigest(plan) {
  return canonicalDigest(criticalClaimProjection(plan));
}

export function decodePointer(pointer) {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new TypeError(`INVALID_JSON_POINTER:${pointer}`);
  return pointer.slice(1).split('/').map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

export function getPointer(value, pointer) {
  let cursor = value;
  for (const segment of decodePointer(pointer)) {
    if (cursor === null || typeof cursor !== 'object' || !(segment in cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

export function applyMutation(value, mutation) {
  const copy = structuredClone(value);
  const segments = decodePointer(mutation.json_pointer);
  if (segments.length === 0) throw new TypeError('ROOT_MUTATION_FORBIDDEN');
  const leaf = segments.pop();
  let parent = copy;
  for (const segment of segments) {
    if (parent === null || typeof parent !== 'object' || !(segment in parent)) throw new TypeError(`MUTATION_POINTER_NOT_FOUND:${mutation.json_pointer}`);
    parent = parent[segment];
  }
  if (mutation.operation === 'set') parent[leaf] = structuredClone(mutation.value);
  else if (mutation.operation === 'delete') delete parent[leaf];
  else if (mutation.operation === 'push') {
    if (!Array.isArray(parent[leaf])) throw new TypeError(`MUTATION_TARGET_NOT_ARRAY:${mutation.json_pointer}`);
    parent[leaf].push(structuredClone(mutation.value));
  } else throw new TypeError(`MUTATION_OPERATION_UNKNOWN:${mutation.operation}`);
  return copy;
}

export async function walkFiles(root, relative = '') {
  const absolute = path.join(root, relative);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => compareUtf8(left.name, right.name))) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

export async function writeAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.partial-${process.pid}`;
  await fs.writeFile(temporary, content, { flag: 'wx' });
  await fs.rename(temporary, file);
}
