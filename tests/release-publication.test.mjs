import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  link,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareSyntheticPublication } from "../scripts/release-source-selection/rehearse-publication.mjs";
import {
  retainRelease,
  restoreRelease,
  verifyRetainedRelease,
} from "../scripts/release-source-selection/restore-release.mjs";
import {
  readPublished,
  publishCandidate,
  withdrawPublication,
  setRightsPolicy,
  recoverStaleLock,
} from "../packages/source-selection/ledger.mjs";
import { canonical, sha256 } from "../packages/source-selection/index.mjs";
async function setup(fn, fixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "publication-release-"));
  try {
    const assetsDirectory = join(root, "assets");
    await mkdir(assetsDirectory);
    await writeFile(join(assetsDirectory, "index.html"), "synthetic");
    await writeFile(join(root, "worker.js"), "synthetic");
    const authority = await prepareSyntheticPublication({
      destination: join(root, "synthetic"),
      assetsDirectory,
      ...fixtureOptions,
    });
    const options = {
      assetsDirectory,
      workerFile: join(root, "worker.js"),
      destination: join(root, "retained"),
      compatibilityDate: "2026-08-30",
      ...authority,
    };
    await fn(root, options);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("accepted synthetic release retains exact private evidence separately, recomputes and restores", () =>
  setup(async (root, o) => {
    const m = await retainRelease(o);
    assert.ok(
      m.files.some((e) => e.path === "evidence/captures/synthetic.txt"),
    );
    assert.ok(!m.files.some((e) => e.path.startsWith("assets/captures/")));
    await restoreRelease({
      ...o,
      retainedDirectory: o.destination,
      destination: join(root, "restored"),
      expectedInventoryHash: m.inventory_sha256,
    });
    await assert.rejects(
      verifyRetainedRelease(o.destination, {
        expectedInventoryHash: m.inventory_sha256,
      }),
      { code: "CURRENT_PUBLICATION_AUTHORITY_REQUIRED" },
    );
    await assert.rejects(
      verifyRetainedRelease(o.destination, {
        ...o,
        currentRightsPolicyPath: join(
          o.destination,
          `evidence/rights-${o.expectedRightsHash}.json`,
        ),
        expectedInventoryHash: m.inventory_sha256,
      }),
      { code: "EXTERNAL_AUTHORITY_REQUIRED" },
    );
  }));
test("current revocation, stale pointer, withdrawal and missing current policy block restoration", () =>
  setup(async (root, o) => {
    const m = await retainRelease(o),
      verify = (extra) =>
        verifyRetainedRelease(o.destination, {
          ...o,
          expectedInventoryHash: m.inventory_sha256,
          ...extra,
        });
    const originalPolicy = JSON.parse(
      await readFile(o.currentRightsPolicyPath),
    );
    const policy = { ...originalPolicy, revoked_rights: ["rights_1"] };
    await writeFile(o.currentRightsPolicyPath, canonical(policy));
    await assert.rejects(verify({}), { code: "CURRENT_RIGHTS_HASH_MISMATCH" });
    await assert.rejects(
      verify({ expectedRightsHash: sha256(canonical(policy)) }),
      { code: "CURRENT_RIGHTS_MISMATCH" },
    );
    await writeFile(o.currentRightsPolicyPath, canonical(originalPolicy));
    const original = await readFile(o.currentPublicationPath);
    await writeFile(
      o.currentPublicationPath,
      canonical({ ...JSON.parse(original), bundle_hash: "a".repeat(64) }),
    );
    await assert.rejects(verify({}), { code: "CURRENT_PUBLICATION_MISMATCH" });
    await writeFile(
      o.currentPublicationPath,
      canonical({ status: "withdrawn" }),
    );
    await assert.rejects(verify({}), { code: "PUBLICATION_WITHDRAWN" });
    await writeFile(o.currentPublicationPath, original);
    await rm(o.currentRightsPolicyPath);
    await assert.rejects(verify({}), { code: "ENOENT" });
  }));
test("retained capture mutation and forged byte span fail before acceptance", () =>
  setup(async (root, o) => {
    await writeFile(join(o.ledgerRoot, "captures/synthetic.txt"), "changed");
    await assert.rejects(retainRelease(o), { code: "capture_hash_mismatch" });
  }));
test("readback recomputes byte spans even for internally rehashed ledger and bundle", () =>
  setup(async (root, o) => {
    const pub = await readPublished(o.ledgerRoot),
      ledger = JSON.parse(
        await readFile(join(o.ledgerRoot, `ledger-${pub.revision}.json`)),
      );
    ledger.assertions[0].evidence_refs[0].quote_hash = "0".repeat(64);
    const revision = sha256(canonical(ledger));
    await writeFile(
      join(o.ledgerRoot, `ledger-${revision}.json`),
      canonical(ledger),
    );
    await writeFile(
      join(o.ledgerRoot, "published.json"),
      canonical({ ...pub, bundle: undefined, status: undefined, revision }),
    );
    await assert.rejects(readPublished(o.ledgerRoot), {
      code: "invalid_capture_locator",
    });
  }));
test("withdrawal blocks prepared concurrent writer and old restore authority", () =>
  setup(async (root, o) => {
    const pub = await readPublished(o.ledgerRoot);
    await assert.rejects(
      publishCandidate(o.ledgerRoot, {
        expectedRevision: pub.revision,
        expectedRightsHash: o.expectedRightsHash,
        rightsPolicy: JSON.parse(await readFile(o.currentRightsPolicyPath)),
        schemaHashes: { v1: sha256("synthetic") },
        beforeSwitch: () =>
          withdrawPublication(o.ledgerRoot, {
            expectedBundleHash: pub.bundle_hash,
            reason: "Synthetic withdrawal",
          }),
      }),
      { code: "publication_conflict" },
    );
    assert.equal(
      (await readPublished(o.ledgerRoot)).reason,
      "publication_withdrawn",
    );
    await assert.rejects(
      withdrawPublication(o.ledgerRoot, {
        expectedBundleHash: pub.bundle_hash,
        reason: "stale",
      }),
      { code: "publication_conflict" },
    );
  }));
test("rights change during preparation cannot publish stale bytes", () =>
  setup(async (root, o) => {
    const pub = await readPublished(o.ledgerRoot);
    await assert.rejects(
      publishCandidate(o.ledgerRoot, {
        expectedRevision: pub.revision,
        expectedRightsHash: o.expectedRightsHash,
        rightsPolicy: JSON.parse(await readFile(o.currentRightsPolicyPath)),
        schemaHashes: { v1: sha256("synthetic") },
        beforeSwitch: () =>
          setRightsPolicy(
            o.ledgerRoot,
            { revoked_rights: ["rights_1"] },
            o.expectedRightsHash,
          ),
      }),
      { code: "rights_conflict" },
    );
    assert.equal((await readPublished(o.ledgerRoot)).reason, "rights_changed");
  }));

test("expired current-policy review blocks even a matching operator hash", () =>
  setup(async (root, o) => {
    const policy = {
      ...JSON.parse(await readFile(o.currentRightsPolicyPath)),
      expires_at: "2001-01-01T00:00:00Z",
    };
    await writeFile(o.currentRightsPolicyPath, canonical(policy));
    await assert.rejects(
      retainRelease({ ...o, expectedRightsHash: sha256(canonical(policy)) }),
      { code: "CURRENT_RIGHTS_EXPIRED" },
    );
  }));
test("accepted restoration rechecks current rights review freshness after retention", async (t) => {
  await setup(
    async (root, o) => {
      const m = await retainRelease(o);
      t.mock.timers.enable({
        apis: ["Date"],
        now: Date.parse("2200-01-01T00:00:00Z"),
      });
      try {
        await assert.rejects(
          verifyRetainedRelease(o.destination, {
            ...o,
            expectedInventoryHash: m.inventory_sha256,
          }),
          { code: "CURRENT_RIGHTS_REVIEW_REQUIRED" },
        );
      } finally {
        t.mock.timers.reset();
      }
    },
    { rightsExpiresAt: "2100-01-01T00:00:00Z" },
  );
});
test("two concurrent distinct publications cannot overwrite the winner", () =>
  setup(async (root, o) => {
    const pub = await readPublished(o.ledgerRoot),
      opts = {
        expectedRevision: pub.revision,
        expectedRightsHash: o.expectedRightsHash,
        rightsPolicy: JSON.parse(await readFile(o.currentRightsPolicyPath)),
        schemaHashes: { v1: sha256("outer") },
      };
    let winner;
    await assert.rejects(
      publishCandidate(o.ledgerRoot, {
        ...opts,
        beforeSwitch: async () => {
          winner = await publishCandidate(o.ledgerRoot, {
            ...opts,
            schemaHashes: { v1: sha256("winner") },
          });
        },
      }),
      { code: "publication_conflict" },
    );
    assert.equal(
      (await readPublished(o.ledgerRoot)).bundle_hash,
      winner.bundle_hash,
    );
  }));

test("external symlink and hardlink authority cannot self-authorize an old bundle", () =>
  setup(async (root, o) => {
    const m = await retainRelease(o);
    for (const create of [symlink, link]) {
      const path = join(
        root,
        create === symlink ? "linked-policy" : "hardlinked-policy",
      );
      await create(
        join(o.destination, `evidence/rights-${o.expectedRightsHash}.json`),
        path,
      );
      await assert.rejects(
        verifyRetainedRelease(o.destination, {
          ...o,
          currentRightsPolicyPath: path,
          expectedInventoryHash: m.inventory_sha256,
        }),
        { code: "EXTERNAL_AUTHORITY_REQUIRED" },
      );
    }
  }));

test("ledger readback rejects expired source rights independently of operator review freshness", async (t) =>
  setup(
    async (root, o) => {
      t.mock.timers.enable({
        apis: ["Date"],
        now: Date.parse("2200-01-01T00:00:00Z"),
      });
      try {
        assert.equal(
          (await readPublished(o.ledgerRoot)).reason,
          "rights_expired",
        );
      } finally {
        t.mock.timers.reset();
      }
    },
    { rightsExpiresAt: "2100-01-01T00:00:00Z" },
  ));
test("publisher rejects malformed schema hashes before artifacts or pointer changes", () =>
  setup(async (root, o) => {
    const pub = await readPublished(o.ledgerRoot);
    await assert.rejects(
      publishCandidate(o.ledgerRoot, {
        expectedRevision: pub.revision,
        expectedRightsHash: o.expectedRightsHash,
        rightsPolicy: JSON.parse(await readFile(o.currentRightsPolicyPath)),
        schemaHashes: { arbitrary: "not-a-hash" },
      }),
      { code: "invalid_schema_hashes" },
    );
    assert.equal(
      (await readPublished(o.ledgerRoot)).bundle_hash,
      pub.bundle_hash,
    );
  }));
test("restore rejects unknown schema even when publication is internally valid", () =>
  setup(async (root, o) => {
    const pub = await readPublished(o.ledgerRoot);
    await publishCandidate(o.ledgerRoot, {
      expectedRevision: pub.revision,
      expectedRightsHash: o.expectedRightsHash,
      rightsPolicy: JSON.parse(await readFile(o.currentRightsPolicyPath)),
      schemaHashes: { unknown: "a".repeat(64) },
    });
    const next = await readPublished(o.ledgerRoot);
    const { status, bundle, ...pointer } = next;
    await writeFile(o.currentPublicationPath, canonical(pointer));
    await writeFile(
      join(o.assetsDirectory, "source-selection/publication.json"),
      canonical(next),
    );
    await assert.rejects(retainRelease(o), {
      code: "INCOMPATIBLE_PUBLICATION_SCHEMA",
    });
  }));

test("a killed writer after withdrawal remains recoverable with retained tombstone receipt", () =>
  setup(async (root, o) => {
    const pub = await readPublished(o.ledgerRoot);
    const withdrawal = await withdrawPublication(o.ledgerRoot, {
      expectedBundleHash: pub.bundle_hash,
      reason: "Synthetic recovery test",
    });
    const { hostname } = await import("node:os");
    const lock = {
      pid: 2147483647,
      host: hostname(),
      boot_id: (
        await readFile("/proc/sys/kernel/random/boot_id", "utf8")
      ).trim(),
      created_at: new Date().toISOString(),
    };
    const bytes = canonical(lock);
    await writeFile(join(o.ledgerRoot, ".writer.lock"), bytes);
    await recoverStaleLock(o.ledgerRoot, sha256(bytes));
    assert.equal(
      (await readPublished(o.ledgerRoot)).reason,
      "publication_withdrawn",
    );
    assert.notEqual(withdrawal.rights_hash, o.expectedRightsHash);
  }));
test("withdrawal new trusted rights pin blocks stale served publication and raw asset access", () =>
  setup(async (root, o) => {
    const { createWorker } = await import("../worker/index.mjs");
    const pub = await readPublished(o.ledgerRoot),
      worker = createWorker();
    const stale = await readFile(
      join(o.assetsDirectory, "source-selection/publication.json"),
      "utf8",
    );
    const assets = { fetch: async () => new Response(stale) };
    const request = () =>
      new Request(
        "https://synthetic.example/api/source-selection/v1/publication",
      );
    assert.equal(
      (
        await worker.fetch(request(), {
          ASSETS: assets,
          USHSO_ACCEPTED_RIGHTS_HASH: o.expectedRightsHash,
        })
      ).status,
      200,
    );
    const withdrawn = await withdrawPublication(o.ledgerRoot, {
      expectedBundleHash: pub.bundle_hash,
      reason: "Synthetic runtime withdrawal",
    });
    const response = await worker.fetch(request(), {
      ASSETS: assets,
      USHSO_ACCEPTED_RIGHTS_HASH: withdrawn.rights_hash,
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).reason, "rights_changed");
    const raw = await worker.fetch(
      new Request(
        "https://synthetic.example/source-selection/publication.json",
      ),
      { ASSETS: assets, USHSO_ACCEPTED_RIGHTS_HASH: withdrawn.rights_hash },
    );
    assert.equal(raw.status, 404);
  }));
