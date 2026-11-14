import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  dryRun,
  executeDraft,
  status,
  shutdown,
  evaluate,
  initializeLedger,
  recoverLock,
  reconcile,
} from "../../packages/source-selection-ai/index.mjs";
const sha = (x) => createHash("sha256").update(x).digest("hex");
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "ushso-ai-"));
  const root = dir;
  const state = join(root, "state");
  await mkdir(state);
  const text = "Public source evidence.";
  const path = join(root, "capture");
  await writeFile(path, text);
  const input = {
    capture_id: "cap",
    path,
    sha256: sha(text),
    rights: {
      capture_sha256: sha(text),
      scope: "cap",
      actions: { send_to_provider: "allowed" },
      reviewer: "reviewer",
      terms_url: "https://example.org",
      checked_at: "2026-01-01",
      expires_at: "2099-01-01",
    },
  };
  const rightsPath = join(root, "rights.json");
  await writeFile(rightsPath, JSON.stringify(input.rights));
  input.rights_path = rightsPath;
  input.rights_sha256 = sha(await readFile(rightsPath));
  delete input.rights;
  const config = {
    enabled: true,
    budget_scope_id: "scope-a",
    ledger_id: "ledger-a",
    provider: {
      protocol: "meta-responses",
      vetted: true,
      endpoint: "https://api.meta.ai/v1/responses",
      model: "muse-ember-1.0",
      key_env: "USH_TEST_KEY",
    },
    input_micro_usd_per_million: 1000000,
    output_micro_usd_per_million: 1000000,
    max_input_tokens: 5000,
    max_output_tokens: 20,
    per_job_micro_usd: 10040,
    monthly_micro_usd: 10040,
    total_micro_usd: 10040,
    timeout_ms: 1000,
    max_response_bytes: 10000,
    retries: 1,
  };
  const approval = {
    action: "execute_paid_draft",
    job_id: "a",
    capture_sha256: input.sha256,
    reserved_micro_usd: 10040,
    ledger_directory: state,
    ledger_id: config.ledger_id,
    budget_scope_id: config.budget_scope_id,
    config_sha256: sha(JSON.stringify(config)),
    rights_sha256: input.rights_sha256,
    approver: "operator",
    role: "reviewer",
    issued_at: "2026-01-01",
    attestation: "reviewed",
    expires_at: "2099-01-01",
  };
  process.env.USH_TEST_KEY = "test";
  await initializeLedger({ dir: state, config });
  return { dir: state, root, input, config, approval };
}
const response = () =>
  new Response(
    JSON.stringify({
      status: "completed",
      usage: { input_tokens: 10, output_tokens: 5 },
      output: [
        { type: "reasoning", summary: [] },
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                claims: [{ text: "A claim", evidence: "source evidence" }],
              }),
            },
          ],
        },
      ],
    }),
  );
test("disabled and rights and byte changes fail closed", async () => {
  let f = await fixture();
  assert.equal(
    (await dryRun({ ...f, config: { ...f.config, enabled: false } })).status,
    "disabled",
  );
  const original = await readFile(f.input.rights_path);
  await writeFile(f.input.rights_path, "{}");
  assert.equal((await dryRun(f)).reason, "rights");
  await writeFile(f.input.rights_path, original);
  await writeFile(f.input.path, "different");
  assert.equal((await dryRun(f)).reason, "capture_bytes");
});
test("draft requires approval, preserves spans, reconciles and is idempotent", async () => {
  let f = await fixture();
  assert.equal(
    (await executeDraft({ ...f, approval: null, jobId: "a" })).reason,
    "approval_required",
  );
  let result = await executeDraft({
    ...f,
    jobId: "a",
    fetchImpl: async () => response(),
  });
  assert.equal(result.status, "draft");
  assert.equal(result.draft.review_status, "human_review_required");
  assert.equal(result.accounted_micro_usd, 15);
  assert.equal(
    (
      await executeDraft({
        ...f,
        jobId: "a",
        fetchImpl: async () => {
          throw Error();
        },
      })
    ).reason,
    "existing_job",
  );
  assert.equal((await status(f)).total, 15);
});
test("unknown charge retains full reservation and shutdown prevents calls", async () => {
  let f = await fixture();
  assert.equal(
    (
      await executeDraft({
        ...f,
        jobId: "a",
        fetchImpl: async () => {
          throw Error("timeout");
        },
      })
    ).reason,
    "charge_unknown",
  );
  assert.equal((await status(f)).total, 10040);
  assert.equal((await shutdown(f)).status, "shutdown");
  let b = { ...f, jobId: "b", approval: { ...f.approval, job_id: "b" } };
  assert.equal(
    (
      await executeDraft({
        ...b,
        fetchImpl: async () => {
          throw Error();
        },
      })
    ).reason,
    "shutdown",
  );
});
test("concurrent jobs cannot exceed aggregate reservation", async () => {
  let f = await fixture();
  let b = { ...f, jobId: "b", approval: { ...f.approval, job_id: "b" } };
  let [a, c] = await Promise.all([
    executeDraft({
      ...f,
      jobId: "a",
      fetchImpl: async () =>
        new Promise((r) => setTimeout(() => r(response()), 50)),
    }),
    executeDraft({ ...b, fetchImpl: async () => response() }),
  ]);
  assert.ok([a, c].some((x) => x.reason === "ledger_locked"));
  assert.ok([a, c].some((x) => x.status === "draft"));
});
test("invalid evidence does not become a draft", async () => {
  let f = await fixture();
  let bad = () =>
    new Response(
      JSON.stringify({
        status: "completed",
        usage: { input_tokens: 10, output_tokens: 5 },
        output: [
          { type: "reasoning", summary: [] },
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  claims: [{ text: "x", evidence: "invented" }],
                }),
              },
            ],
          },
        ],
      }),
    );
  assert.equal(
    (await executeDraft({ ...f, jobId: "a", fetchImpl: bad })).reason,
    "invalid_draft",
  );
});
test("evaluation rejects missing human observations", () => {
  assert.equal(evaluate({}).reason, "cohort");
});

test("approval binds config and rights", async () => {
  const f = await fixture();
  const altered = {
    ...f.config,
    total_micro_usd: f.config.total_micro_usd + 1,
  };
  assert.equal(
    (await executeDraft({ ...f, config: altered, jobId: "a" })).reason,
    "approval_required",
  );
});
test("rights mutation while in flight prevents draft", async () => {
  const f = await fixture();
  const result = await executeDraft({
    ...f,
    jobId: "a",
    fetchImpl: async () => {
      await writeFile(f.input.rights_path, "{}");
      return response();
    },
  });
  assert.equal(result.reason, "invalid_draft");
  assert.equal((await status(f)).total, 15);
});
test("shutdown while in flight prevents draft", async () => {
  const f = await fixture();
  const result = await executeDraft({
    ...f,
    jobId: "a",
    fetchImpl: async () => {
      await shutdown(f);
      return response();
    },
  });
  assert.equal(result.reason, "invalid_draft");
});
test("symlink capture and malformed ledger fail closed", async () => {
  const f = await fixture();
  const link = join(f.root, "link");
  await symlink(f.input.path, link);
  assert.equal(
    (await dryRun({ ...f, input: { ...f.input, path: link } })).status,
    "blocked",
  );
  await writeFile(
    join(f.dir, "state.json"),
    JSON.stringify({
      version: 1,
      killed: false,
      jobs: { x: { status: "draft", reserved_micro_usd: 0 } },
    }),
  );
  assert.equal((await status(f)).status, "failed");
});

test("independent processes serialize reservations and retain unknown charge after restart", async () => {
  const f = await fixture();
  const argsPath = join(f.root, "args.json");
  await writeFile(argsPath, JSON.stringify(f));
  const moduleUrl = new URL(
    "../../packages/source-selection-ai/index.mjs",
    import.meta.url,
  ).href;
  const code = `import {readFile,writeFile} from 'node:fs/promises'; import {executeDraft} from ${JSON.stringify(moduleUrl)}; const f=JSON.parse(await readFile(process.argv[1])); process.env.USH_TEST_KEY='test'; const r=await executeDraft({...f,jobId:process.argv[2],approval:{...f.approval,job_id:process.argv[2]},fetchImpl:async()=>{await writeFile(process.argv[3],'started');await new Promise(r=>setTimeout(r,250));throw Error('unknown');}}); console.log(JSON.stringify(r));`;
  const run = (id) =>
    spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        code,
        argsPath,
        id,
        join(f.root, "started"),
      ],
      { env: process.env },
    );
  const collect = (p) =>
    new Promise((resolve, reject) => {
      let out = "";
      p.stdout.on("data", (x) => (out += x));
      p.on("error", reject);
      p.on("close", () => resolve(JSON.parse(out)));
    });
  const first = run("a");
  const firstResult = collect(first);
  for (let i = 0; i < 100; i++) {
    try {
      await readFile(join(f.root, "started"));
      break;
    } catch {
      await delay(10);
    }
  }
  const second = await collect(run("b"));
  assert.equal(second.reason, "ledger_locked");
  assert.equal((await firstResult).reason, "charge_unknown");
  assert.equal((await status(f)).total, 10040);
  const later = await executeDraft({
    ...f,
    jobId: "b",
    approval: { ...f.approval, job_id: "b" },
  });
  assert.equal(later.reason, "aggregate_budget");
});
test("completed response, refusal, and extra keys are checked", async () => {
  const f = await fixture();
  const result = await executeDraft({
    ...f,
    jobId: "a",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          status: "incomplete",
          usage: { input_tokens: 1, output_tokens: 1 },
          output: [{ content: [{ type: "refusal", text: "no" }] }],
        }),
      ),
  });
  assert.equal(result.reason, "invalid_draft");
});
test("retry reconciles both attempts and honors shutdown before retry", async () => {
  const f = await fixture();
  let calls = 0;
  const retry = () =>
    new Response(
      JSON.stringify({ usage: { input_tokens: 2, output_tokens: 1 } }),
      { status: 429, headers: { "retry-after": "0" } },
    );
  const result = await executeDraft({
    ...f,
    jobId: "a",
    fetchImpl: async () => {
      calls++;
      return calls === 1 ? retry() : response();
    },
  });
  assert.equal(result.status, "draft");
  assert.equal(calls, 2);
  assert.equal(result.accounted_micro_usd, 18);
  const g = await fixture();
  let stoppedCalls = 0;
  const stoppedResult = await executeDraft({
    ...g,
    jobId: "a",
    fetchImpl: async () => {
      stoppedCalls++;
      await shutdown(g);
      return retry();
    },
  });
  assert.equal(stoppedResult.reason, "shutdown");
  assert.equal(stoppedCalls, 1);
  assert.equal((await status(g)).total, 3);
});

test("approved job cannot replay into a new ledger path", async () => {
  const f = await fixture();
  const other = join(f.root, "other");
  await mkdir(other);
  let called = false;
  const result = await executeDraft({
    ...f,
    dir: other,
    jobId: "a",
    fetchImpl: async () => {
      called = true;
      return response();
    },
  });
  assert.equal(result.reason, "approval_required");
  assert.equal(called, false);
});
test("state loss and uncertain liability tampering fail closed", async () => {
  const f = await fixture();
  await executeDraft({
    ...f,
    jobId: "a",
    fetchImpl: async () => {
      throw Error();
    },
  });
  const path = join(f.dir, "state.json");
  const state = JSON.parse(await readFile(path));
  state.jobs.a.accounted_micro_usd = 0;
  await writeFile(path, JSON.stringify(state));
  assert.equal((await status(f)).status, "failed");
  await rm(path);
  assert.equal((await status(f)).status, "failed");
});
test("month rollover conservatively counts both months and suppresses retry", async () => {
  const RealDate = Date;
  let instant = "2027-01-31T23:59:59.000Z";
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [instant]));
    }
    static now() {
      return new RealDate(instant).valueOf();
    }
  };
  try {
    const f = await fixture();
    let calls = 0;
    const result = await executeDraft({
      ...f,
      jobId: "a",
      fetchImpl: async () => {
        calls++;
        instant = "2027-02-01T00:00:01.000Z";
        return new Response(
          JSON.stringify({ usage: { input_tokens: 2, output_tokens: 1 } }),
          { status: 429 },
        );
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.reason, "month_rollover");
    assert.equal((await status(f)).monthly, 3);
    instant = "2027-01-31T23:59:59.000Z";
    assert.equal((await status(f)).monthly, 3);
    const g = await fixture();
    await executeDraft({
      ...g,
      jobId: "a",
      fetchImpl: async () => {
        throw Error();
      },
    });
    instant = "2027-02-01T00:00:01.000Z";
    assert.equal((await status(g)).monthly, 10040);
  } finally {
    globalThis.Date = RealDate;
  }
});
test("dead subprocess lock requires stop, exact hash and dead same-host owner", async () => {
  const f = await fixture(),
    argsPath = join(f.root, "recovery-args.json"),
    started = join(f.root, "recovery-started");
  await writeFile(argsPath, JSON.stringify(f));
  const moduleUrl = new URL(
    "../../packages/source-selection-ai/index.mjs",
    import.meta.url,
  ).href;
  const code = `import {readFile,writeFile} from 'node:fs/promises';import {executeDraft} from ${JSON.stringify(moduleUrl)};const f=JSON.parse(await readFile(process.argv[1]));process.env.USH_TEST_KEY='test';await executeDraft({...f,jobId:'a',fetchImpl:async()=>{await writeFile(process.argv[2],'started');await new Promise(()=>{});}});`;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", code, argsPath, started],
    { env: process.env },
  );
  const exited = new Promise((resolve) => child.on("close", resolve));
  for (let i = 0; i < 100; i++) {
    try {
      await readFile(started);
      break;
    } catch {
      await delay(10);
    }
  }
  const owner = await readFile(join(f.dir, ".lock", "owner.json"));
  const ownerHash = sha(owner);
  assert.equal(
    (await recoverLock({ dir: f.dir, expected_owner_sha256: ownerHash }))
      .reason,
    "shutdown_required",
  );
  await shutdown(f);
  assert.equal(
    (await recoverLock({ dir: f.dir, expected_owner_sha256: "0".repeat(64) }))
      .reason,
    "owner_hash",
  );
  assert.equal(
    (await recoverLock({ dir: f.dir, expected_owner_sha256: ownerHash }))
      .reason,
    "owner_live",
  );
  child.kill("SIGKILL");
  await exited;
  await writeFile(
    join(f.dir, `recovery-${ownerHash}.json`),
    JSON.stringify({
      action: "recover_lock",
      owner: JSON.parse(owner),
      owner_sha256: ownerHash,
      recovered_at: new Date().toISOString(),
      operator_pid: process.pid,
    }),
  );
  assert.equal(
    (await recoverLock({ dir: f.dir, expected_owner_sha256: ownerHash }))
      .status,
    "recovered",
  );
  assert.equal(
    JSON.parse(await readFile(join(f.dir, `recovery-${ownerHash}.json`)))
      .owner_sha256,
    ownerHash,
  );
  assert.equal((await status(f)).jobs[0].status, "reserved");
});
test("reconciliation requires pinned billing evidence and human record and preserves receipt", async () => {
  const f = await fixture();
  await executeDraft({
    ...f,
    jobId: "a",
    fetchImpl: async () => {
      throw Error();
    },
  });
  await shutdown(f);
  const before = await status(f),
    job = before.jobs[0],
    evidencePath = join(f.root, "bill.json");
  const evidence = JSON.stringify({
    type: "provider_billing_evidence",
    job_id: "a",
    ledger_id: "ledger-a",
    amount_micro_usd: 25,
    provider_reference: "private-invoice",
    observed_at: "2026-11-14T00:00:00Z",
  });
  await writeFile(evidencePath, evidence);
  const args = {
    dir: f.dir,
    jobId: "a",
    expected_state_sha256: before.state_sha256,
    expected_fingerprint: job.fingerprint,
    amount_micro_usd: 25,
    billing_evidence_path: evidencePath,
    billing_evidence_sha256: sha(evidence),
  };
  const approval = {
    action: "reconcile_charge",
    evidence_class: "actual_human",
    job_id: "a",
    ledger_id: "ledger-a",
    state_sha256: args.expected_state_sha256,
    job_fingerprint: job.fingerprint,
    billing_evidence_sha256: args.billing_evidence_sha256,
    amount_micro_usd: 25,
    approver: "Reviewer",
    role: "billing owner",
    attestation: "private record",
    reviewed_at: "2026-11-14T00:00:00Z",
  };
  assert.equal(
    (await reconcile({ ...args, approval: null })).reason,
    "approval_required",
  );
  assert.equal(
    (await reconcile({ ...args, amount_micro_usd: 20000, approval })).reason,
    "amount",
  );
  assert.equal(
    (
      await reconcile({
        ...args,
        billing_evidence_sha256: "0".repeat(64),
        approval,
      })
    ).reason,
    "billing_evidence",
  );
  const unsupported = JSON.stringify({
    type: "unknown",
    job_id: "a",
    ledger_id: "ledger-a",
    amount_micro_usd: 25,
    provider_reference: "ref",
    observed_at: "2026-11-14T00:00:00Z",
  });
  const unsupportedPath = join(f.root, "unsupported.json");
  await writeFile(unsupportedPath, unsupported);
  assert.equal(
    (
      await reconcile({
        ...args,
        billing_evidence_path: unsupportedPath,
        billing_evidence_sha256: sha(unsupported),
        approval,
      })
    ).reason,
    "billing_evidence",
  );
  const done = await reconcile({ ...args, approval });
  assert.equal(done.status, "reconciled");
  const after = await status(f);
  assert.equal(after.total, 25);
  assert.equal(after.jobs[0].status, "reconciled");
  const receipt = JSON.parse(
    await readFile(join(f.dir, `reconciliation-${done.receipt_sha256}.json`)),
  );
  assert.equal(receipt.prior_status, "charge_unknown");
  assert.equal(
    await readFile(join(f.dir, `billing-${sha(evidence)}.json`), "utf8"),
    evidence,
  );
});
