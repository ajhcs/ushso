import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { capture, metadataUrl } from "./refresh.mjs";
import { extractRecord, verifyClaim } from "./source-extractors.mjs";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const stable = (value) => JSON.stringify(value);
const DEFAULT_STORAGE_ROOT = "/mnt/d/tmp/plumbob";
function resolveStorageRoot(storageRoot = DEFAULT_STORAGE_ROOT) {
  if (typeof storageRoot !== "string" || !path.isAbsolute(storageRoot)) throw Error("UPDATE_STORAGE_ROOT");
  const root = path.resolve(storageRoot);
  if (root === path.parse(root).root) throw Error("UPDATE_STORAGE_ROOT");
  return root;
}
function isStrictDescendant(candidate, root) {
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return candidate.startsWith(prefix);
}
async function immutable(directory, value, suffix = ".json") {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(stable(value)), hash = sha(bytes), file = path.join(directory, hash + suffix);
  try {
    await fs.writeFile(file, bytes, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST" || sha(await fs.readFile(file)) !== hash) throw error;
  }
  return { sha256: hash, file };
}
function sourceKey(job) {
  return sha(stable({ record_id: job?.record?.record_id ?? null, generation: job?.generation ?? null }));
}
async function runBoundedUpdate({ plan, directory, runId, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), extract = extractRecord, verify = verifyClaim, externalReviewReceipt = null, storageRoot } = {}) {
  if (plan?.format !== "ushso.bounded-update.v1" || !Array.isArray(plan.sources) || plan.sources.length > 100 || !/^[a-zA-Z0-9_-]{1,80}$/.test(runId)) throw Error("UPDATE_PLAN_INVALID");
  if (new Set(plan.sources.map(sourceKey)).size !== plan.sources.length) throw Error("UPDATE_DUPLICATE_SOURCE");
  const scope = resolveStorageRoot(storageRoot);
  const base = path.resolve(directory);
  if (!isStrictDescendant(base, scope)) throw Error("UPDATE_STORAGE_SCOPE");
  await fs.mkdir(base, { recursive: true });
  if (!isStrictDescendant(await fs.realpath(base), await fs.realpath(scope))) throw Error("UPDATE_STORAGE_ESCAPE");
  const lock = await fs.open(path.join(base, ".update-lock"), "wx");
  try {
    for (const name of ["captures", "proposals", "runs"]) await fs.mkdir(path.join(base, name), { recursive: true });
    const run = path.join(base, "runs", runId);
    await fs.mkdir(run, { recursive: true });
    const planBytes = Buffer.from(stable(plan)), planHash = sha(planBytes);
    try {
      await fs.writeFile(path.join(run, "plan.json"), planBytes, { flag: "wx" });
    } catch (e) {
      if (e.code !== "EEXIST" || sha(await fs.readFile(path.join(run, "plan.json"))) !== planHash) throw Error("UPDATE_RESUME_PLAN_MISMATCH");
    }
    let state = {};
    try {
      state = JSON.parse(await fs.readFile(path.join(base, "state.json")));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const parserFiles = ["source-extractors.mjs", "refresh.mjs"];
    const parserHashes = await Promise.all(parserFiles.map(async (file) => ({ file, sha256: sha(await fs.readFile(new URL(file, import.meta.url))) })));
    if (externalReviewReceipt && externalReviewReceipt.status !== "blocked_external_review") throw Error("UPDATE_EXTERNAL_RECEIPT_STATE");
    const modelReview = externalReviewReceipt ? { status: "blocked_external_review", receipt_sha256: sha(stable(externalReviewReceipt)), receipt: externalReviewReceipt } : { status: "pending_external_review" };
    const result = { format: "ushso.bounded-update-result.v1", run_id: runId, plan_sha256: planHash, parser_version: "source-extractors-content-bound-v1", parser_hashes: parserHashes, model_review: modelReview, sources: [], publication_authorized: false, owner_approval: null };
    const hex = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    async function readObject(folder, hash, suffix = ".json") {
      if (!hex(hash)) throw Error("UPDATE_REFERENCE_HASH_INVALID");
      let bytes;
      try {
        bytes = await fs.readFile(path.join(base, folder, hash + suffix));
      } catch {
        throw Error("UPDATE_REFERENCE_MISSING");
      }
      if (sha(bytes) !== hash) throw Error("UPDATE_REFERENCE_TAMPERED");
      return suffix === ".json" ? JSON.parse(bytes) : bytes;
    }
    async function checkedCheckpoint(completed, job, key) {
      if (completed.source_key !== key || completed.record_id !== job?.record?.record_id || completed.generation !== job?.generation || completed.record_sha256 !== sha(stable(job.record)) || completed.plan_sha256 !== planHash || stable(completed.parser_hashes) !== stable(parserHashes) || completed.approval !== null || completed.publication_authorized !== false) throw Error("UPDATE_CHECKPOINT_IDENTITY");
      for (const binding of completed.captures ?? []) {
        const receipt = await readObject("captures", binding.receipt_sha256);
        if (receipt.url !== binding.url || (receipt.sha256 ?? null) !== binding.sha256 || receipt.status !== binding.status || job.locators[binding.slot] !== binding.url) throw Error("UPDATE_CHECKPOINT_CAPTURE_BINDING");
        if (binding.sha256) await readObject("captures", binding.sha256, ".body");
      }
      if (completed.proposal_sha256) {
        const proposal = await readObject("proposals", completed.proposal_sha256);
        if (proposal.record_id !== job.record.record_id || proposal.generation !== job.generation || proposal.record_sha256 !== sha(stable(job.record)) || stable(proposal.parser_hashes) !== stable(parserHashes) || proposal.owner_approval !== null || proposal.publication_authorized !== false || stable(proposal.capture_bindings) !== stable(completed.captures.map(({ receipt_sha256, ...b }) => b))) throw Error("UPDATE_CHECKPOINT_PROPOSAL_BINDING");
      }
      if (completed.previous_proposal_sha256) await readObject("proposals", completed.previous_proposal_sha256);
      if (completed.proposal_sha256) {
        const proposal = await readObject("proposals", completed.proposal_sha256), previous = completed.previous_proposal_sha256 ? await readObject("proposals", completed.previous_proposal_sha256) : null;
        if (previous && (previous.record_id !== job.record.record_id || previous.generation !== job.generation)) throw Error("UPDATE_PREVIOUS_IDENTITY");
        const old = new Map((previous?.fields ?? []).map((f) => [f.field, f])), next = new Map(proposal.fields.map((f) => [f.field, f]));
        const changes = [.../* @__PURE__ */ new Set([...old.keys(), ...next.keys()])].sort().flatMap((field) => stable(old.get(field)?.value ?? null) === stable(next.get(field)?.value ?? null) ? [] : [{ field, before: old.get(field)?.value ?? null, after: next.get(field)?.value ?? null, evidence: next.get(field)?.evidence ?? null }]);
        if (stable(changes) !== stable(completed.changes)) throw Error("UPDATE_CHECKPOINT_DIFF_TAMPERED");
      } else if (completed.changes?.length) throw Error("UPDATE_CHECKPOINT_DIFF_TAMPERED");
    }
    let requests = 0, totalBytes = 0;
    for (const job of plan.sources) {
      const key = sourceKey(job), checkpoint = path.join(run, key + ".json");
      try {
        const completed = JSON.parse(await fs.readFile(checkpoint));
        await checkedCheckpoint(completed, job, key);
        // A checkpoint proves this historical run, not that its proposal is still latest.
        // Never reconstruct a lost latest-state pointer from an arbitrary resumed run:
        // a newer completed run may exist even when state.json is absent.
        const currentProposal = state[key]?.proposal_sha256 ?? null;
        result.sources.push(completed.proposal_sha256 && currentProposal !== completed.proposal_sha256
          ? { ...completed, resume_state: currentProposal ? "historical_checkpoint_current_preserved" : "latest_state_missing_not_restored", current_proposal_sha256: currentProposal }
          : completed);
        continue;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      let outcome = { source_key: key, plan_sha256: planHash, parser_hashes: parserHashes, record_sha256: sha(stable(job?.record ?? null)), record_id: job?.record?.record_id, generation: job?.generation, status: "failed", changes: [], approval: null, publication_authorized: false };
      try {
        if (job.public_metadata_only !== true || !job.record?.record_id || typeof job.generation !== "string" || !job.locators || Object.keys(job.locators).length > 4) throw Error("UPDATE_SOURCE_SCOPE");
        if (/restricted/i.test(job.record.title ?? "") || ["controlled", "application_required", "dua_required", "registration_required", "licensed_paid"].includes(job.record.access?.status)) throw Error("UPDATE_RESTRICTED_ASSET_EXCLUDED");
        const captures = {}, evidence = /* @__PURE__ */ new Map(), bindings = [];
        for (const [slot, url] of Object.entries(job.locators)) {
          if (!["metadata", "variables", "geography", "documentation"].includes(slot) || !metadataUrl(url)) throw Error("UPDATE_LOCATOR_INVALID");
          let observation;
          for (let attempt = 0; attempt < 3; attempt++) {
            if (requests >= 300 || totalBytes + 2 * 1024 * 1024 > 64 * 1024 * 1024) throw Error("UPDATE_CAPTURE_BUDGET");
            requests++;
            observation = await capture(url, { fetchImpl, maxBytes: 2 * 1024 * 1024, timeoutMs: 2e4 });
            totalBytes += observation.bytes ?? 2 * 1024 * 1024;
            if (!["fetch_failed", "timed_out"].includes(observation.status) && ![429, 500, 502, 503, 504].includes(observation.http_status)) break;
            if (attempt < 2) await sleep(250 * 2 ** attempt);
          }
          const { text, ...receipt } = observation;
          const captureReceipt = await immutable(path.join(base, "captures"), receipt);
          bindings.push({ slot, url, status: receipt.status, sha256: receipt.sha256 ?? null, receipt_sha256: captureReceipt.sha256 });
          if (text !== void 0) {
            await immutable(path.join(base, "captures"), Buffer.from(text), ".body");
            try {
              observation.data = JSON.parse(text);
            } catch {
            }
          }
          captures[slot] = observation;
          evidence.set(url, observation);
        }
        if (Object.values(captures).some((c) => c.status !== "captured")) throw Object.assign(Error("UPDATE_CAPTURE_INCOMPLETE"), { bindings });
        const extracted = extract(job.record, captures, job.generation), fields = [];
        for (const claim of extracted.claims ?? []) {
          if (verify(claim, evidence, job.record, job.generation) !== true) throw Error("UPDATE_CLAIM_NOT_VERIFIED");
          const { observed_at, ...stableEvidence } = claim.evidence ?? {};
          fields.push({ field: claim.field, value: claim.value, evidence: stableEvidence, scope: claim.scope });
        }
        if (!fields.length) throw Error("UPDATE_NO_VERIFIED_FIELDS");
        fields.sort((a, b) => a.field.localeCompare(b.field));
        if (new Set(fields.map((f) => f.field)).size !== fields.length) throw Error("UPDATE_FIELD_CONFLICT");
        const contentBinding = bindings.map(({ receipt_sha256, ...b }) => b);
        const proposal = { record_id: job.record.record_id, record_sha256: sha(stable(job.record)), generation: job.generation, parser_hashes: parserHashes, capture_bindings: contentBinding, fields, review_status: "pending_owner_review", owner_approval: null, publication_authorized: false };
        const saved = await immutable(path.join(base, "proposals"), proposal);
        let previous = null;
        if (state[key]?.proposal_sha256) {
          if (!hex(state[key].proposal_sha256)) throw Error("UPDATE_REFERENCE_HASH_INVALID");
          const bytes = await fs.readFile(path.join(base, "proposals", state[key].proposal_sha256 + ".json"));
          if (sha(bytes) !== state[key].proposal_sha256) throw Error("UPDATE_PREVIOUS_HASH");
          previous = JSON.parse(bytes);
          if (previous.record_id !== job.record.record_id || previous.generation !== job.generation) throw Error("UPDATE_PREVIOUS_IDENTITY");
        }
        const old = new Map((previous?.fields ?? []).map((f) => [f.field, f])), next = new Map(fields.map((f) => [f.field, f]));
        const changes = [.../* @__PURE__ */ new Set([...old.keys(), ...next.keys()])].sort().flatMap((field) => stable(old.get(field)?.value ?? null) === stable(next.get(field)?.value ?? null) ? [] : [{ field, before: old.get(field)?.value ?? null, after: next.get(field)?.value ?? null, evidence: next.get(field)?.evidence ?? null }]);
        outcome = { ...outcome, status: previous && saved.sha256 === state[key].proposal_sha256 ? "unchanged" : "proposed_update", proposal_sha256: saved.sha256, previous_proposal_sha256: state[key]?.proposal_sha256 ?? null, approval_binding_changed: !!previous && saved.sha256 !== state[key].proposal_sha256, captures: bindings, changes };
        state[key] = { record_id: job.record.record_id, generation: job.generation, proposal_sha256: saved.sha256, last_successful_run: runId };
      } catch (error) {
        outcome = { ...outcome, status: error.message.includes("EXCLUDED") ? "blocked_scope" : "failed", error: error.message, captures: error.bindings ?? [], previous_proposal_sha256: state[key]?.proposal_sha256 ?? null };
      }
      await fs.writeFile(checkpoint, stable(outcome), { flag: "wx" });
      await fs.writeFile(path.join(base, "state.next.json"), stable(state));
      await fs.rename(path.join(base, "state.next.json"), path.join(base, "state.json"));
      result.sources.push(outcome);
    }
    result.requests_this_invocation = requests;
    result.response_budget_charged_bytes = totalBytes;
    result.summary = { sources: result.sources.length, changed: result.sources.filter((s) => s.status === "proposed_update").length, unchanged: result.sources.filter((s) => s.status === "unchanged").length, failed: result.sources.filter((s) => s.status === "failed").length, blocked: result.sources.filter((s) => s.status === "blocked_scope").length };
    await fs.writeFile(path.join(run, "report.json"), JSON.stringify(result, null, 2));
    return result;
  } finally {
    await lock.close();
    await fs.unlink(path.join(base, ".update-lock"));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [planFile, directory, runId, externalReceiptFile] = process.argv.slice(2);
  if (!runId) throw Error("usage: node scripts/research/update-cycle.mjs PLAN STATE_DIRECTORY RUN_ID");
  console.log(JSON.stringify(await runBoundedUpdate({ plan: JSON.parse(await fs.readFile(planFile)), directory, runId, externalReviewReceipt: externalReceiptFile ? JSON.parse(await fs.readFile(externalReceiptFile)) : null })));
}
export {
  runBoundedUpdate
};
