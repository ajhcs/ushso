import { createHash } from "node:crypto";
import {
  readFile,
  mkdir,
  rename,
  rm,
  open,
  access,
  realpath,
  stat,
} from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { hostname } from "node:os";

const hash = (x) => createHash("sha256").update(x).digest("hex");
const integer = (x) => Number.isSafeInteger(x) && x >= 0;
const text = (x) =>
  typeof x === "string" && x.trim().length > 0 && x.length <= 1000;
const fail = (reason, status = "blocked") => ({ status, reason });
const validId = (x) =>
  typeof x === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(x);
const nowMonth = () => new Date().toISOString().slice(0, 7);
const stateFile = (dir) => join(dir, "state.json");
async function workspacePath(path, directory = false) {
  const absolute = resolve(path);
  if (!absolute.startsWith("/workspace/")) throw Error("path");
  const actual = await realpath(absolute);
  if (
    actual !== absolute ||
    (await stat(actual)).dev !== (await stat("/workspace")).dev
  )
    throw Error("path");
  if (directory && !(await stat(actual)).isDirectory()) throw Error("path");
  return actual;
}
async function safeRead(path, max) {
  await workspacePath(path);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await file.stat();
    if (!st.isFile() || st.size > max) throw Error("path");
    return await file.readFile();
  } finally {
    await file.close();
  }
}
export async function readWorkspaceJson(path) {
  return JSON.parse(await safeRead(path, 1000000));
}
async function lock(dir, fn) {
  await workspacePath(dir, true);
  const path = join(dir, ".lock");
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (e) {
    if (e.code === "EEXIST") return fail("ledger_locked");
    throw e;
  }
  try {
    const owner = {
      pid: process.pid,
      host: hostname(),
      boot_id: (
        await readFile("/proc/sys/kernel/random/boot_id", "utf8")
      ).trim(),
      created_at: new Date().toISOString(),
    };
    const file = await open(join(path, "owner.json"), "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(owner));
      await file.sync();
    } finally {
      await file.close();
    }
    const directory = await open(path, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return await fn();
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}
async function load(dir) {
  let initialized = false;
  try {
    await safeRead(join(dir, "INITIALIZED"), 100);
    initialized = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    const s = JSON.parse(await safeRead(stateFile(dir), 10000000));
    if (
      !initialized ||
      s.version !== 1 ||
      !s.jobs ||
      Array.isArray(s.jobs) ||
      typeof s.killed !== "boolean"
    )
      throw Error("invalid_ledger");
    for (const [id, job] of Object.entries(s.jobs)) {
      if (
        !validId(id) ||
        !job ||
        !integer(job.reserved_micro_usd) ||
        !/^[a-f0-9]{64}$/.test(job.fingerprint || "") ||
        !/^\d{4}-\d{2}$/.test(job.month || "") ||
        !Array.isArray(job.months) ||
        !job.months.includes(job.month) ||
        job.months.some((m) => !/^\d{4}-\d{2}$/.test(m)) ||
        ![
          "reserved",
          "charge_unknown",
          "stopped",
          "provider_failed",
          "draft",
          "invalid_draft",
          "reconciled",
        ].includes(job.status)
      )
        throw Error("invalid_ledger");
      const uncertain = ["reserved", "charge_unknown"].includes(job.status);
      if (uncertain && job.accounted_micro_usd != null)
        throw Error("invalid_ledger");
      if (
        !uncertain &&
        (!integer(job.accounted_micro_usd) ||
          job.accounted_micro_usd > job.reserved_micro_usd)
      )
        throw Error("invalid_ledger");
    }
    return s;
  } catch (error) {
    if (error.code === "ENOENT" && !initialized)
      return { version: 1, killed: false, jobs: {} };
    throw Error("invalid_ledger");
  }
}
async function initialize(dir) {
  try {
    const file = await open(join(dir, "INITIALIZED"), "wx", 0o600);
    try {
      await file.writeFile("ushso-ai-ledger-v1\n");
      await file.sync();
    } finally {
      await file.close();
    }
    const directory = await open(dir, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}
async function save(dir, s) {
  const tmp = join(dir, `.${process.pid}-${crypto.randomUUID()}.tmp`);
  const f = await open(tmp, "wx", 0o600);
  try {
    await f.writeFile(JSON.stringify(s));
    await f.sync();
  } finally {
    await f.close();
  }
  await rename(tmp, stateFile(dir));
  const d = await open(dir, "r");
  try {
    await d.sync();
  } finally {
    await d.close();
  }
}
function budget(s, month) {
  let total = 0,
    monthly = 0;
  for (const j of Object.values(s.jobs)) {
    const n = j.accounted_micro_usd ?? j.reserved_micro_usd;
    if (!integer(n)) throw Error("invalid_ledger");
    total += n;
    if (
      j.status === "reserved" ||
      j.status === "charge_unknown" ||
      (j.months || [j.month]).includes(month)
    )
      monthly += n;
  }
  if (!integer(total) || !integer(monthly)) throw Error("invalid_ledger");
  return { total, monthly };
}
function validateConfig(c) {
  if (!c || c.enabled !== true) return "disabled";
  if (!validId(c.budget_scope_id) || !validId(c.ledger_id))
    return "budget_identity";
  if (
    !c.provider ||
    c.provider.protocol !== "meta-responses" ||
    !c.provider.vetted ||
    c.provider.endpoint !== "https://api.meta.ai/v1/responses" ||
    c.provider.model !== "muse-ember-1.0" ||
    !c.provider.key_env
  )
    return "provider_config";
  if (
    ![
      c.input_micro_usd_per_million,
      c.output_micro_usd_per_million,
      c.max_input_tokens,
      c.max_output_tokens,
      c.per_job_micro_usd,
      c.monthly_micro_usd,
      c.total_micro_usd,
      c.timeout_ms,
      c.max_response_bytes,
    ].every(integer) ||
    c.input_micro_usd_per_million < 100000 ||
    c.output_micro_usd_per_million < 500000 ||
    c.max_input_tokens > 179000 ||
    !c.max_input_tokens ||
    !c.max_output_tokens ||
    c.timeout_ms < 100 ||
    c.timeout_ms > 120000 ||
    c.max_response_bytes < 1 ||
    c.max_response_bytes > 1000000 ||
    ![0, 1].includes(c.retries)
  )
    return "limits";
}
async function capture(input) {
  if (
    !input ||
    !validId(input.capture_id) ||
    !input.path ||
    !/^[a-f0-9]{64}$/.test(input.sha256 || "")
  )
    throw Error("capture");
  const bytes = await safeRead(input.path, 1000000);
  if (
    bytes.length > 1000000 ||
    hash(bytes) !== input.sha256 ||
    !Buffer.from(bytes.toString("utf8")).equals(bytes)
  )
    throw Error("capture_bytes");
  if (!input.rights_path || !/^[a-f0-9]{64}$/.test(input.rights_sha256 || ""))
    throw Error("rights");
  const policyBytes = await safeRead(input.rights_path, 100000);
  if (hash(policyBytes) !== input.rights_sha256) throw Error("rights");
  const r = JSON.parse(policyBytes);
  if (
    !r ||
    r.capture_sha256 !== input.sha256 ||
    r.scope !== input.capture_id ||
    r.actions?.send_to_provider !== "allowed" ||
    !r.reviewer ||
    !r.terms_url ||
    !/^https:\/\//.test(r.terms_url) ||
    !Number.isFinite(Date.parse(r.checked_at)) ||
    !Number.isFinite(Date.parse(r.expires_at)) ||
    Date.parse(r.checked_at) > Date.now() ||
    Date.parse(r.expires_at) <= Date.now() ||
    r.deleted ||
    (r.retention_until &&
      (!Number.isFinite(Date.parse(r.retention_until)) ||
        Date.parse(r.retention_until) <= Date.now()))
  )
    throw Error("rights");
  return bytes.toString("utf8");
}
const reserveAmount = (c) =>
  Math.ceil(
    (c.max_input_tokens * c.input_micro_usd_per_million +
      c.max_output_tokens * c.output_micro_usd_per_million) /
      1000000,
  ) *
  (c.retries + 1);
export async function dryRun({ config, input }) {
  const reason = validateConfig(config);
  if (reason)
    return fail(reason, reason === "disabled" ? "disabled" : "blocked");
  try {
    const text = await capture(input);
    if (Buffer.byteLength(text) + 4000 > config.max_input_tokens)
      return fail("input_limit");
    const amount = reserveAmount(config);
    if (!integer(amount) || amount > config.per_job_micro_usd)
      return fail("per_job_limit");
    return {
      status: "ready",
      reserved_micro_usd: amount,
      capture_sha256: input.sha256,
    };
  } catch (e) {
    return fail(
      ["capture", "capture_bytes", "rights"].includes(e.message)
        ? e.message
        : "capture_unavailable",
    );
  }
}
export async function initializeLedger({ dir, config }) {
  const reason = validateConfig(config);
  if (reason) return fail(reason);
  try {
    return await lock(dir, async () => {
      const state = await load(dir);
      if (state.ledger_id || Object.keys(state.jobs).length)
        return fail("already_initialized");
      state.ledger_id = config.ledger_id;
      state.budget_scope_id = config.budget_scope_id;
      state.ledger_directory = await workspacePath(dir, true);
      state.budget_pin = hash(
        JSON.stringify({
          per_job_micro_usd: config.per_job_micro_usd,
          monthly_micro_usd: config.monthly_micro_usd,
          total_micro_usd: config.total_micro_usd,
        }),
      );
      await initialize(dir);
      await save(dir, state);
      return {
        status: "initialized",
        ledger_id: state.ledger_id,
        ledger_directory: state.ledger_directory,
        budget_scope_id: state.budget_scope_id,
      };
    });
  } catch {
    return fail("ledger_unavailable", "failed");
  }
}
export async function status({ dir }) {
  try {
    const result = await lock(dir, async () => {
      const s = await load(dir);
      return {
        status: "ok",
        killed: s.killed || (await stopped(dir)),
        state_sha256: hash(await safeRead(stateFile(dir), 10000000)),
        ...budget(s, nowMonth()),
        jobs: Object.entries(s.jobs).map(([id, j]) => ({
          id,
          fingerprint: j.fingerprint,
          status: j.status,
          reserved_micro_usd: j.reserved_micro_usd,
          accounted_micro_usd: j.accounted_micro_usd,
        })),
      };
    });
    if (result.reason === "ledger_locked") {
      try {
        result.owner_sha256 = hash(
          await safeRead(join(dir, ".lock", "owner.json"), 10000),
        );
      } catch {}
    }
    return result;
  } catch {
    return fail("ledger_unavailable", "failed");
  }
}
export async function shutdown({ dir }) {
  try {
    await workspacePath(dir, true);
    const f = await open(
      join(dir, "STOP"),
      constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await f.sync();
    } finally {
      await f.close();
    }
    const d = await open(dir, "r");
    try {
      await d.sync();
    } finally {
      await d.close();
    }
    return { status: "shutdown" };
  } catch {
    return fail("ledger_unavailable", "failed");
  }
}
async function stopped(dir) {
  try {
    await access(join(dir, "STOP"));
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
async function durablePrivateFile(path, bytes) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  const directory = await open(resolve(path, ".."), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function recoverLock({ dir, expected_owner_sha256 }) {
  try {
    await workspacePath(dir, true);
    if (!(await stopped(dir))) return fail("shutdown_required");
    if (!/^[a-f0-9]{64}$/.test(expected_owner_sha256 || ""))
      return fail("owner_hash");
    const guard = join(dir, ".recovery");
    try {
      await mkdir(guard, { mode: 0o700 });
    } catch (e) {
      if (e.code === "EEXIST") return fail("recovery_locked");
      throw e;
    }
    try {
      const path = join(dir, ".lock");
      const before = await stat(path);
      const bytes = await safeRead(join(path, "owner.json"), 10000);
      if (hash(bytes) !== expected_owner_sha256) return fail("owner_hash");
      const owner = JSON.parse(bytes);
      const boot = (
        await readFile("/proc/sys/kernel/random/boot_id", "utf8")
      ).trim();
      if (
        !Number.isSafeInteger(owner.pid) ||
        owner.pid < 1 ||
        owner.host !== hostname() ||
        owner.boot_id !== boot ||
        !Number.isFinite(Date.parse(owner.created_at))
      )
        return fail("owner_invalid");
      try {
        process.kill(owner.pid, 0);
        return fail("owner_live");
      } catch (e) {
        if (e.code !== "ESRCH") return fail("owner_unverifiable");
      }
      const after = await stat(path);
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        hash(await safeRead(join(path, "owner.json"), 10000)) !==
          expected_owner_sha256
      )
        return fail("owner_changed");
      const receipt = {
        action: "recover_lock",
        owner,
        owner_sha256: expected_owner_sha256,
        recovered_at: new Date().toISOString(),
        operator_pid: process.pid,
      };
      const receiptPath = join(dir, `recovery-${expected_owner_sha256}.json`);
      try {
        await durablePrivateFile(receiptPath, JSON.stringify(receipt));
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const prior = JSON.parse(await safeRead(receiptPath, 10000));
        if (
          prior.action !== "recover_lock" ||
          prior.owner_sha256 !== expected_owner_sha256 ||
          JSON.stringify(prior.owner) !== JSON.stringify(owner) ||
          !Number.isFinite(Date.parse(prior.recovered_at)) ||
          !Number.isSafeInteger(prior.operator_pid)
        )
          throw Error("invalid_recovery_receipt");
      }
      await rm(path, { recursive: true });
      const d = await open(dir, "r");
      try {
        await d.sync();
      } finally {
        await d.close();
      }
      return { status: "recovered", owner_sha256: expected_owner_sha256 };
    } finally {
      await rm(guard, { recursive: true, force: true });
    }
  } catch {
    return fail("recovery_unavailable", "failed");
  }
}

export async function reconcile({
  dir,
  jobId,
  expected_state_sha256,
  expected_fingerprint,
  amount_micro_usd,
  billing_evidence_path,
  billing_evidence_sha256,
  approval,
}) {
  try {
    return await lock(dir, async () => {
      if (!(await stopped(dir))) return fail("shutdown_required");
      const bytes = await safeRead(stateFile(dir), 10000000);
      if (hash(bytes) !== expected_state_sha256) return fail("state_hash");
      const s = await load(dir),
        job = s.jobs[jobId];
      if (
        !s.ledger_id ||
        !job ||
        !["reserved", "charge_unknown"].includes(job.status) ||
        job.fingerprint !== expected_fingerprint
      )
        return fail("job_mismatch");
      if (
        !integer(amount_micro_usd) ||
        amount_micro_usd > job.reserved_micro_usd
      )
        return fail("amount");
      const evidence = await safeRead(billing_evidence_path, 1000000);
      if (
        !/^[a-f0-9]{64}$/.test(billing_evidence_sha256 || "") ||
        hash(evidence) !== billing_evidence_sha256
      )
        return fail("billing_evidence");
      const bill = JSON.parse(evidence);
      if (
        bill.type !== "provider_billing_evidence" ||
        bill.job_id !== jobId ||
        bill.ledger_id !== s.ledger_id ||
        bill.amount_micro_usd !== amount_micro_usd ||
        !text(bill.provider_reference) ||
        !bill.observed_at ||
        !Number.isFinite(Date.parse(bill.observed_at))
      )
        return fail("billing_evidence");
      if (
        !approval ||
        approval.action !== "reconcile_charge" ||
        approval.evidence_class !== "actual_human" ||
        approval.job_id !== jobId ||
        approval.ledger_id !== s.ledger_id ||
        approval.state_sha256 !== expected_state_sha256 ||
        approval.job_fingerprint !== expected_fingerprint ||
        approval.billing_evidence_sha256 !== billing_evidence_sha256 ||
        approval.amount_micro_usd !== amount_micro_usd ||
        !text(approval.approver) ||
        !text(approval.role) ||
        !text(approval.attestation) ||
        !Number.isFinite(Date.parse(approval.reviewed_at)) ||
        Date.parse(approval.reviewed_at) > Date.now() ||
        Date.parse(bill.observed_at) > Date.parse(approval.reviewed_at)
      )
        return fail("approval_required");
      const evidenceCopy = join(dir, `billing-${billing_evidence_sha256}.json`);
      try {
        await durablePrivateFile(evidenceCopy, evidence);
      } catch (e) {
        if (
          e.code !== "EEXIST" ||
          hash(await safeRead(evidenceCopy, 1000000)) !==
            billing_evidence_sha256
        )
          throw e;
      }
      const receipt = {
        action: "reconcile_charge",
        job_id: jobId,
        prior_status: job.status,
        prior_state_sha256: expected_state_sha256,
        job_fingerprint: expected_fingerprint,
        amount_micro_usd,
        billing_evidence_sha256,
        approval,
        reconciled_at: new Date().toISOString(),
      };
      const receiptBytes = JSON.stringify(receipt),
        receiptHash = hash(receiptBytes);
      await durablePrivateFile(
        join(dir, `reconciliation-${receiptHash}.json`),
        receiptBytes,
      );
      job.prior_status = job.status;
      job.status = "reconciled";
      job.accounted_micro_usd = amount_micro_usd;
      job.reconciliation_sha256 = receiptHash;
      if (!job.months.includes(nowMonth())) job.months.push(nowMonth());
      await save(dir, s);
      return {
        status: "reconciled",
        job_id: jobId,
        receipt_sha256: receiptHash,
        accounted_micro_usd: amount_micro_usd,
      };
    });
  } catch {
    return fail("reconciliation_unavailable", "failed");
  }
}

async function boundedResponse(res, max) {
  const reader = res.body?.getReader();
  if (!reader) throw Error("response");
  let n = 0,
    chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await reader.cancel();
      throw Error("response_limit");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function parseDraft(body, text) {
  if (body.status !== "completed" || !Array.isArray(body.output))
    throw Error("draft");
  const messages = body.output.filter((x) => x.type === "message");
  if (
    !messages.length ||
    body.output.some((x) => !["message", "reasoning"].includes(x.type)) ||
    messages.some(
      (x) =>
        x.role !== "assistant" ||
        x.status !== "completed" ||
        !Array.isArray(x.content) ||
        !x.content.length ||
        x.content.some(
          (y) => y.type !== "output_text" || typeof y.text !== "string",
        ),
    )
  )
    throw Error("draft");
  const content = messages
    .flatMap((x) => x.content)
    .map((x) => x.text)
    .join("");
  const obj = JSON.parse(content);
  if (
    !obj ||
    Object.keys(obj).join() !== "claims" ||
    !Array.isArray(obj.claims) ||
    obj.claims.length > 100
  )
    throw Error("draft");
  const claims = obj.claims.map((claim) => {
    if (
      !claim ||
      Object.keys(claim).sort().join() !== "evidence,text" ||
      typeof claim.text !== "string" ||
      !claim.text ||
      typeof claim.evidence !== "string" ||
      !claim.evidence
    )
      throw Error("draft");
    const at = text.indexOf(claim.evidence);
    if (at < 0 || text.indexOf(claim.evidence, at + 1) !== -1)
      throw Error("evidence_span");
    const start = Buffer.byteLength(text.slice(0, at));
    return {
      text: claim.text,
      evidence: claim.evidence,
      byte_start: start,
      byte_end: start + Buffer.byteLength(claim.evidence),
      quote_sha256: hash(claim.evidence),
    };
  });
  return {
    claims,
    review_status: "human_review_required",
    authoritative: false,
  };
}
export async function executeDraft({
  dir,
  jobId,
  config,
  input,
  approval,
  fetchImpl = fetch,
}) {
  if (!validId(jobId)) return fail("job_id");
  if (
    [input?.path, input?.rights_path].some(
      (p) =>
        p &&
        (resolve(p) === resolve(dir) ||
          resolve(p).startsWith(resolve(dir) + "/")),
    )
  )
    return fail("path");
  const pre = await dryRun({ config, input });
  if (pre.status !== "ready") return pre;
  if (
    !approval ||
    approval.ledger_directory !== resolve(dir) ||
    approval.ledger_id !== config.ledger_id ||
    approval.budget_scope_id !== config.budget_scope_id ||
    approval.config_sha256 !== hash(JSON.stringify(config)) ||
    approval.rights_sha256 !== input.rights_sha256 ||
    !approval.role ||
    !approval.attestation ||
    !Number.isFinite(Date.parse(approval.issued_at)) ||
    Date.parse(approval.issued_at) > Date.now() ||
    approval.action !== "execute_paid_draft" ||
    approval.job_id !== jobId ||
    approval.capture_sha256 !== input.sha256 ||
    approval.reserved_micro_usd !== pre.reserved_micro_usd ||
    !approval.approver ||
    !Number.isFinite(Date.parse(approval.expires_at)) ||
    Date.parse(approval.expires_at) <= Date.now()
  )
    return fail("approval_required");
  if (!process.env[config.provider.key_env])
    return fail("credential_unavailable");
  try {
    return await lock(dir, async () => {
      const s = await load(dir);
      if (s.killed || (await stopped(dir))) return fail("shutdown");
      if (
        s.ledger_id !== config.ledger_id ||
        s.budget_scope_id !== config.budget_scope_id ||
        s.ledger_directory !== (await workspacePath(dir, true))
      )
        return fail("ledger_identity");
      const budgetPin = hash(
        JSON.stringify({
          per_job_micro_usd: config.per_job_micro_usd,
          monthly_micro_usd: config.monthly_micro_usd,
          total_micro_usd: config.total_micro_usd,
        }),
      );
      if (s.budget_pin && s.budget_pin !== budgetPin)
        return fail("budget_policy_mismatch");
      if (!s.budget_pin) return fail("budget_policy_missing");
      const fingerprint = hash(JSON.stringify({ input, config, approval }));
      if (s.jobs[jobId])
        return s.jobs[jobId].fingerprint === fingerprint
          ? { status: s.jobs[jobId].status, reason: "existing_job" }
          : fail("job_id_conflict");
      const b = budget(s, nowMonth()),
        amount = pre.reserved_micro_usd;
      if (
        b.total + amount > config.total_micro_usd ||
        b.monthly + amount > config.monthly_micro_usd
      )
        return fail("aggregate_budget");
      const text = await capture(input); // recheck immediately before reservation
      s.jobs[jobId] = {
        status: "reserved",
        fingerprint,
        month: nowMonth(),
        months: [nowMonth()],
        reserved_micro_usd: amount,
      };
      await initialize(dir);
      await save(dir, s);
      let charge = 0;
      const usage = [];
      for (let attempt = 0; attempt <= config.retries; attempt++) {
        const stopReason = (await stopped(dir))
          ? "shutdown"
          : Date.parse(approval.expires_at) <= Date.now()
            ? "approval_expired"
            : s.jobs[jobId].month !== nowMonth()
              ? "month_rollover"
              : null;
        if (stopReason) {
          s.jobs[jobId].status = "stopped";
          s.jobs[jobId].accounted_micro_usd = charge;
          await save(dir, s);
          return fail(stopReason);
        }
        // The stop marker is checked before each dispatch and again before output.
        let body, res;
        try {
          await capture(input);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), config.timeout_ms);
          const stopPoll = setInterval(() => {
            stopped(dir)
              .then((v) => {
                if (v) controller.abort();
              })
              .catch(() => controller.abort());
          }, 50);
          try {
            res = await fetchImpl(config.provider.endpoint, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${process.env[config.provider.key_env]}`,
              },
              redirect: "error",
              body: JSON.stringify({
                model: config.provider.model,
                store: false,
                reasoning: { effort: "minimal" },
                max_output_tokens: config.max_output_tokens,
                text: {
                  format: {
                    type: "json_schema",
                    name: "draft",
                    strict: true,
                    schema: {
                      type: "object",
                      properties: {
                        claims: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              text: { type: "string" },
                              evidence: { type: "string" },
                            },
                            required: ["text", "evidence"],
                            additionalProperties: false,
                          },
                        },
                      },
                      required: ["claims"],
                      additionalProperties: false,
                    },
                  },
                },
                input: [
                  {
                    role: "system",
                    content:
                      "Propose metadata claims only from the capture. Evidence must be an exact verbatim substring. No unsupported claims.",
                  },
                  { role: "user", content: text },
                ],
              }),
              signal: controller.signal,
            });
            body = await boundedResponse(res, config.max_response_bytes);
          } finally {
            clearTimeout(timer);
            clearInterval(stopPoll);
          }
        } catch {
          s.jobs[jobId].status = "charge_unknown";
          await save(dir, s);
          return fail("charge_unknown", "unavailable");
        }
        if (!s.jobs[jobId].months.includes(nowMonth()))
          s.jobs[jobId].months.push(nowMonth());
        const u = body?.usage;
        if (
          !integer(u?.input_tokens) ||
          !integer(u?.output_tokens) ||
          u.input_tokens > config.max_input_tokens ||
          u.output_tokens > config.max_output_tokens
        ) {
          s.jobs[jobId].status = "charge_unknown";
          await save(dir, s);
          return fail("charge_unknown", "unavailable");
        }
        usage.push({
          input_tokens: u.input_tokens,
          output_tokens: u.output_tokens,
        });
        s.jobs[jobId].observed_usage = usage;
        charge += Math.ceil(
          (u.input_tokens * config.input_micro_usd_per_million +
            u.output_tokens * config.output_micro_usd_per_million) /
            1000000,
        );
        if (!integer(charge) || charge > amount) {
          s.jobs[jobId].status = "charge_unknown";
          await save(dir, s);
          return fail("charge_unknown", "unavailable");
        }
        if (!res.ok) {
          if (
            attempt < config.retries &&
            [429, 500, 502, 503, 504].includes(res.status)
          ) {
            const delay = res.headers.get("retry-after");
            if (delay && (!/^\d+$/.test(delay) || Number(delay) > 5)) {
              s.jobs[jobId].status = "provider_failed";
              s.jobs[jobId].accounted_micro_usd = charge;
              await save(dir, s);
              return fail("retry_after", "failed");
            }
            if (delay)
              await new Promise((r) => setTimeout(r, Number(delay) * 1000));
            continue;
          }
          s.jobs[jobId].status = "provider_failed";
          s.jobs[jobId].accounted_micro_usd = charge;
          await save(dir, s);
          return fail("provider_failed", "failed");
        }
        try {
          if (await stopped(dir)) throw Error("shutdown");
          await capture(input);
          const draft = parseDraft(body, text);
          draft.capture_id = input.capture_id;
          draft.capture_sha256 = input.sha256;
          s.jobs[jobId].status = "draft";
          s.jobs[jobId].accounted_micro_usd = charge;
          await save(dir, s);
          return {
            status: "draft",
            draft,
            accounted_micro_usd: charge,
            observed_usage: usage,
            capture_sha256: input.sha256,
          };
        } catch {
          s.jobs[jobId].status = "invalid_draft";
          s.jobs[jobId].accounted_micro_usd = charge;
          await save(dir, s);
          return fail("invalid_draft", "failed");
        }
      }
    });
  } catch {
    return fail("ledger_or_capture_unavailable", "failed");
  }
}

// Labels and timings are supplied after generation by independently responsible reviewers.
export function evaluate({ cohort, baseline, assisted, labels }) {
  if (
    !cohort ||
    cohort.status !== "frozen" ||
    !cohort.revision ||
    !cohort.reviewer ||
    !cohort.frozen_at ||
    !Number.isFinite(Date.parse(cohort.frozen_at)) ||
    !Array.isArray(cohort.cases) ||
    cohort.cases.length !== 30 ||
    new Set(cohort.cases.map((x) => x.id)).size !== 30 ||
    !cohort.cases.every(
      (x) =>
        validId(x.id) &&
        x.task &&
        x.capture_id &&
        /^[a-f0-9]{64}$/.test(x.capture_sha256 || "") &&
        /^[a-f0-9]{64}$/.test(x.rights_sha256 || "") &&
        x.verified_by,
    )
  )
    return fail("cohort");
  const digest = hash(JSON.stringify(cohort));
  if (
    ![baseline, assisted, labels].every(
      (x) =>
        x?.cohort_sha256 === digest &&
        Array.isArray(x.cases) &&
        x.cases.length === 30,
    )
  )
    return fail("cohort_mismatch");
  const ids = cohort.cases
    .map((x) => x.id)
    .sort()
    .join("\n");
  if (
    ![baseline, assisted, labels].every(
      (x) =>
        x.cases
          .map((y) => y.id)
          .sort()
          .join("\n") === ids,
    ) ||
    !labels.reviewer ||
    labels.independence !== "independently_reviewed"
  )
    return fail("review");
  for (const run of [baseline, assisted])
    if (
      !run.cases.every((x) => integer(x.extraction_ms) && integer(x.review_ms))
    )
      return fail("timings");
  if (
    !labels.cases.every(
      (x) =>
        typeof x.critical_approved_error === "boolean" &&
        x.reviewer &&
        x.evidence,
    )
  )
    return fail("labels");
  const base = baseline.cases.reduce(
      (n, x) => n + x.extraction_ms + x.review_ms,
      0,
    ),
    ai = assisted.cases.reduce((n, x) => n + x.extraction_ms + x.review_ms, 0);
  if (!base || !Number.isSafeInteger(base) || !Number.isSafeInteger(ai))
    return fail("timings");
  const errors = labels.cases.filter((x) => x.critical_approved_error).length;
  return {
    status: "evaluated",
    cohort_sha256: digest,
    baseline_ms: base,
    assisted_ms: ai,
    critical_approved_errors: errors,
    time_reduction: (base - ai) / base,
    proposed_threshold_met: errors === 0 && ai <= base * 0.8,
    qualification:
      "requires independent review of raw labels, timing and study design",
  };
}
