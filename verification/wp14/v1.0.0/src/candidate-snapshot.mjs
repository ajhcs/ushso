import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canonicalJson,
  packageRoot,
  readJson,
  repoPath,
  repoRoot,
  sha256Bytes,
  sha256File,
  withCanonicalDigest,
} from "./common.mjs";

export const RELEASE_GATE_PLAN_FINGERPRINT = "886170d2355e59531b1647795b298eeb7d503eaa0b22ee487a4be26bd5c3b0fc";

function resolveHeadCommit() {
  const gitDir = resolve(repoRoot, ".git");
  const head = readFileSync(resolve(gitDir, "HEAD"), "utf8").trim();
  if (!head.startsWith("ref: ")) return head;
  const ref = head.slice(5);
  const looseRef = resolve(gitDir, ref);
  if (existsSync(looseRef)) return readFileSync(looseRef, "utf8").trim();
  const packed = readFileSync(resolve(gitDir, "packed-refs"), "utf8")
    .split("\n")
    .find((line) => line.endsWith(` ${ref}`));
  if (!packed) throw new Error(`cannot resolve Git HEAD ref ${ref}`);
  return packed.slice(0, 40);
}

export function loadArtifactBindings() {
  return readJson(resolve(packageRoot, "policy/artifact-bindings.v1.0.0.json"));
}

export function buildArtifactPins(bindings = loadArtifactBindings()) {
  return bindings.bindings.map(({ role, path }) => {
    const absolutePath = repoPath(path);
    if (!existsSync(absolutePath)) throw new Error(`required WP14 binding is missing: ${path}`);
    return { role, path, sha256: `sha256:${sha256File(absolutePath)}` };
  });
}

export function buildCandidateSnapshot() {
  const artifactPins = buildArtifactPins();
  const authorizationPin = artifactPins.find((pin) => pin.role === "authorization_register");
  const corpusPin = artifactPins.find((pin) => pin.path === "apps/web/public/corpus-v1.1.0/corpus.json");
  const workerPin = artifactPins.find((pin) => pin.path === "worker/index.mjs");
  const headCommit = resolveHeadCommit();
  const repositoryPin = readJson(resolve(packageRoot, "policy/repository-base-pin.v1.0.0.json"));
  if (repositoryPin.head_commit !== headCommit) {
    throw new Error(`repository HEAD changed from the reviewed WP14 base pin: ${repositoryPin.head_commit} -> ${headCommit}`);
  }
  const contentManifestSha256 = `sha256:${sha256Bytes(canonicalJson(artifactPins))}`;

  return withCanonicalDigest({
    schema_version: "ushso-wp14-candidate-envelope.v1.0.0",
    candidate_id: "wp14-local-zero-traffic-foundation-2026-08-30",
    candidate_class: "local_fixture_rehearsal",
    environment: "local_fixture_only",
    git: {
      head_commit: headCommit,
      head_tree_oid: repositoryPin.head_tree_oid,
      working_tree_status: repositoryPin.working_tree_status,
      exact_candidate_tree_sealed: false,
      note: "The Git OID pins the checked-out HEAD tree; uncommitted candidate content is separately bound by the artifact manifest digest and is not a production release candidate."
    },
    release_gate: {
      authority: "local-exact-tree",
      policy_source: "detected",
      plan_fingerprint_sha256: `sha256:${RELEASE_GATE_PLAN_FINGERPRINT}`,
      status: "PLAN_ONLY_NO_EXACT_CANDIDATE_RUN",
      receipt_sha256: null,
      reason: "A moving shared dirty worktree is not one exact release candidate. No detached candidate build was run or claimed."
    },
    artifact_pins: artifactPins,
    artifact_pin_count: artifactPins.length,
    candidate_content_manifest_sha256: contentManifestSha256,
    authorization_register_sha256: authorizationPin.sha256,
    component_gates: {
      configuration: "LOCAL_STATIC_VALIDATION_ONLY",
      migrations: "NOT_APPLIED_AUTH_03_AUTH_11",
      search_generation: "BLOCKED_WP8_PRE_TUNING_AUTH_13",
      static_artifact: "PRESENT_RUNTIME_UNCHANGED",
      coverage: "BLOCKED_AUTH_15_OWNER_WORDING",
      planner: "BLOCKED_AUTH_12_RUNTIME_ABSENT",
      machine_toolkit: "CANDIDATE_UNWIRED_PUBLIC_DISABLED",
      seo: "CANDIDATE_SEALED_UNWIRED_PUBLIC_DISABLED"
    },
    fixture_topology: {
      worker_version_n_minus_one: `fixture-worker-n-1:${workerPin.sha256.slice(-16)}`,
      worker_version_n: `fixture-worker-n:${contentManifestSha256.slice(-16)}`,
      static_emergency_worker_version: `fixture-worker-static:${corpusPin.sha256.slice(-16)}`,
      search_generation_n_minus_one: "fixture-search-generation-n-1",
      search_generation_n: "fixture-search-generation-n",
      asset_bundle_n_minus_one_sha256: `sha256:${sha256Bytes("fixture-asset-bundle-n-minus-one")}`,
      asset_bundle_n_sha256: `sha256:${sha256Bytes("fixture-asset-bundle-n")}`,
      static_artifact_sha256: corpusPin.sha256
    },
    execution_boundary: {
      network_requests: 0,
      provider_mutations: 0,
      deployments: 0,
      public_requests: 0,
      source_requests: 0,
      payload_downloads: 0,
      analyses_executed: 0,
      raw_user_queries_persisted: 0
    },
    runtime_boundary: {
      runtime_jsonl_loader_present: true,
      stage_corpus_dependency_present: true,
      jsonl_archives_retained: true,
      static_emergency_artifact_deployable: true
    },
    production_eligibility: false,
    production_blockers: [
      "exact clean candidate tree and exact-candidate release-gate receipt absent",
      "AUTH-03, AUTH-05, AUTH-06, AUTH-07, AUTH-08, AUTH-09, and AUTH-11 are not authorized",
      "search final quality and production-like performance gates not passed",
      "coverage owner wording review pending AUTH-15",
      "planner governance pending AUTH-12 and compiler runtime absent",
      "machine toolkit and SEO candidates are sealed but unwired/publicly disabled and not release-activated",
      "managed recovery, internal canary, public promotion, soak, and retirement evidence absent"
    ]
  }, "candidate_digest_sha256");
}
