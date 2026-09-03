import { createHash } from "node:crypto";

export const REBUILD_TARGETS = Object.freeze([
  "identity_clusters",
  "aliases",
  "search_projections",
  "join_views",
  "plan_fixtures",
]);

export const AUTOMATIC_GATE_FLOORS = Object.freeze({
  adjudicated_positive_pairs: 50,
  hard_negative_pairs: 50,
  temporal_reuse_conflict_cases: 20,
  false_automatic_merges: 0,
  candidate_recall: 0.95,
});

export function assert(condition, message, code = "invalid_input") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

export function stableId(prefix, value, length = 24) {
  return `${prefix}:${sha256(value).slice(0, length)}`;
}

export function orderedPair(leftId, rightId) {
  assert(leftId !== rightId, "An identity candidate cannot pair an object with itself", "self_pair");
  return [leftId, rightId].sort((left, right) => left.localeCompare(right));
}

export function uniqueSorted(values = []) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function requireIsoDateTime(value, label) {
  assert(typeof value === "string" && Number.isFinite(Date.parse(value)), `${label} must be an ISO timestamp`, "invalid_time");
  return value;
}

export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function clone(value) {
  return structuredClone(value);
}
