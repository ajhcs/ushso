import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertOrdinaryDeployment,
  productionTarget,
  deploymentArguments,
  assertQualifiedConfiguration,
  assertOrdinaryConfiguration,
  assertDeploymentEnvironment,
} from "../scripts/release-source-selection/deploy-approved.mjs";

test("normal deployment refuses accepted or disguised publication; disabled release remains supported", async () => {
  const root = await mkdtemp(join(tmpdir(), "approved-deploy-"));
  await mkdir(join(root, "source-selection"));
  const file = join(root, "source-selection/publication.json");
  await writeFile(
    file,
    JSON.stringify({ status: "unavailable", reason: "not_configured" }),
  );
  await assertOrdinaryDeployment(root);
  for (const publication of [
    { status: "available" },
    { status: "unavailable", bundle: {} },
    { status: "unknown" },
  ]) {
    await writeFile(file, JSON.stringify(publication));
    await assert.rejects(assertOrdinaryDeployment(root), /APPROVED_DEPLOY/);
  }
});
test("deploy parser rejects aliases, duplicate flags, negation and argument tricks before dispatch", () => {
  assert.deepEqual(deploymentArguments(["deploy"]), {
    help: false,
    dryRun: false,
    configuration: undefined,
  });
  assert.equal(
    deploymentArguments([
      "deploy",
      "--dry-run",
      "--outdir",
      ".wrangler-dry-run",
    ]).dryRun,
    true,
  );
  for (const args of [
    ["-c", "other.json"],
    ["-e", "production"],
    ["--dry-run", "--no-dry-run"],
    ["--help", "false"],
    ["--config", "one", "--config", "two"],
    ["--dry-run=false"],
    ["other-worker.js"],
    ["--assets", "other"],
    ["--var", "unsafe:value"],
    ["--dry-run", "--outdir", "x", "--dry-run"],
    ["--config", "--dry-run"],
  ])
    assert.throws(
      () => deploymentArguments(["deploy", ...args]),
      /ARGUMENTS|REQUIRED/,
    );
});
test("restored runtime semantics must match production, apart from routing and artifact paths", async () => {
  const config = JSON.parse(
    await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  );
  const retained = {
    ...config,
    name: "local",
    main: "worker/index.js",
    assets: { ...config.assets, directory: "assets" },
  };
  assertQualifiedConfiguration(config, retained);
  assert.throws(
    () =>
      assertQualifiedConfiguration(
        { ...config, compatibility_date: "2026-10-01" },
        retained,
      ),
    /QUALIFIED/,
  );
  assert.throws(
    () => assertQualifiedConfiguration({ ...config, vars: {} }, retained),
    /QUALIFIED/,
  );
});
test("production approval target binds exact routing and configuration", async () => {
  const config = JSON.parse(
    await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  );
  const expected = productionTarget(config);
  assert.notEqual(
    productionTarget({ ...config, compatibility_date: "2026-09-01" }),
    expected,
  );
  assert.throws(
    () =>
      productionTarget({
        ...config,
        routes: [{ pattern: "unapproved.example/*" }],
      }),
    /CONFIGURATION/,
  );
  assert.throws(
    () => productionTarget({ ...config, build: { command: "unapproved" } }),
    /CONFIGURATION/,
  );
});
test("ordinary deployments reject build hooks and module or environment overrides before asset checks", async () => {
  const config = JSON.parse(
    await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  );
  assertOrdinaryConfiguration(config);
  assertDeploymentEnvironment({});
  assert.throws(
    () => assertDeploymentEnvironment({ CLOUDFLARE_ENV: "unreviewed" }),
    /ENVIRONMENT_REJECTED/,
  );
  for (const entry of [
    { build: { command: "replace-assets" } },
    { alias: { "./index.mjs": "./other.mjs" } },
    { env: { production: {} } },
    { rules: [] },
    { define: { REVIEW: "true" } },
  ]) {
    assert.throws(
      () => assertOrdinaryConfiguration({ ...config, ...entry }),
      /CONFIGURATION/,
    );
  }
});
