import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { canonical, sha256 } from "../../packages/source-selection/index.mjs";
import { loadAndValidateHandoff } from "../../packages/source-selection-approval/load-handoff.mjs";
import { workspacePath } from "./restore-release.mjs";

const repository = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const fail = (code) => {
  throw new Error(code);
};
export function assertDeploymentEnvironment(environment = process.env) {
  if (environment.CLOUDFLARE_ENV)
    fail("IMPLICIT_DEPLOYMENT_ENVIRONMENT_REJECTED");
}
export function assertOrdinaryConfiguration(config) {
  if (
    !config ||
    Object.keys(config).some(
      (key) =>
        ![
          "$schema",
          "name",
          "account_id",
          "main",
          "compatibility_date",
          "compatibility_flags",
          "workers_dev",
          "preview_urls",
          "routes",
          "assets",
          "observability",
          "vars",
        ].includes(key),
    )
  )
    fail("UNSUPPORTED_DEPLOYMENT_CONFIGURATION");
}
export function productionTarget(config) {
  assertOrdinaryConfiguration(config);
  if (
    !config ||
    config.name !== "ushso" ||
    !/^[a-f0-9]{32}$/.test(config.account_id ?? "") ||
    !Array.isArray(config.routes) ||
    config.routes.length !== 2 ||
    config.routes
      .map((route) => route.pattern)
      .sort()
      .join(",") !== "ushso.org/*,www.ushso.org/*" ||
    config.build ||
    config.env ||
    config.assets?.binding !== "ASSETS" ||
    Object.keys(config).some(
      (key) =>
        ![
          "$schema",
          "name",
          "account_id",
          "main",
          "compatibility_date",
          "compatibility_flags",
          "workers_dev",
          "preview_urls",
          "routes",
          "assets",
          "observability",
          "vars",
        ].includes(key),
    )
  )
    fail("UNEXPECTED_PRODUCTION_CONFIGURATION");
  return `cloudflare:${config.account_id}/${config.name}:${sha256(canonical(config))}`;
}
export function deploymentArguments(args) {
  if (args[0] !== "deploy") fail("EXPECTED_DEPLOY_COMMAND");
  if (args.length === 2 && ["--help", "-h"].includes(args[1]))
    return { help: true, dryRun: false };
  const options = {};
  for (let index = 1; index < args.length; index++) {
    const key = args[index];
    if (!["--config", "--dry-run", "--outdir"].includes(key) || key in options)
      fail("UNSUPPORTED_DEPLOYMENT_ARGUMENTS");
    if (key === "--dry-run") options[key] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith("-"))
        fail("UNSUPPORTED_DEPLOYMENT_ARGUMENTS");
      options[key] = value;
    }
  }
  if (Boolean(options["--dry-run"]) !== Boolean(options["--outdir"]))
    fail("DRY_RUN_OUTPUT_REQUIRED");
  return {
    help: false,
    dryRun: Boolean(options["--dry-run"]),
    configuration: options["--config"],
  };
}
export function assertQualifiedConfiguration(production, retained) {
  const material = (config) => ({
    compatibility_date: config.compatibility_date,
    compatibility_flags: config.compatibility_flags ?? [],
    vars: config.vars ?? {},
    assets: Object.fromEntries(
      Object.entries(config.assets).filter(([key]) => key !== "directory"),
    ),
    observability: config.observability,
  });
  if (canonical(material(production)) !== canonical(material(retained)))
    fail("RUNTIME_CONFIGURATION_DIFFERS_FROM_QUALIFIED_RESTORE");
}
export async function assertOrdinaryDeployment(assetsDirectory) {
  let publication;
  try {
    publication = JSON.parse(
      await readFile(
        join(assetsDirectory, "source-selection/publication.json"),
        "utf8",
      ),
    );
  } catch (error) {
    if (error.code === "ENOENT")
      fail("PUBLICATION_STATE_REQUIRED_BEFORE_DEPLOY");
    throw error;
  }
  if (
    publication.status !== "unavailable" ||
    Object.keys(publication).some((key) => !["status", "reason"].includes(key))
  ) {
    fail("ACCEPTED_PUBLICATION_REQUIRES_APPROVED_DEPLOY");
  }
}

// Preparation is the default. --apply is the only branch that calls Cloudflare.
export async function prepareApprovedDeployment({ inputsPath, destination }) {
  assertDeploymentEnvironment();
  const config = JSON.parse(
    await readFile(join(repository, "wrangler.jsonc"), "utf8"),
  );
  const target = productionTarget(config);
  const handoff = await loadAndValidateHandoff(inputsPath, {
    currentAssetsDirectory: join(repository, "apps/web/dist"),
    currentWorkerFile: join(repository, ".wrangler-dry-run/index.js"),
    target,
  });
  const retained = handoff.retained_directory;
  assertQualifiedConfiguration(
    config,
    JSON.parse(await readFile(join(retained, "wrangler.json"), "utf8")),
  );
  const output = await workspacePath(destination);
  if (
    output === retained ||
    output.startsWith(retained + "/") ||
    retained.startsWith(output + "/")
  )
    fail("OVERLAPPING_DEPLOYMENT_PATHS");
  await mkdir(output, { mode: 0o700 });
  const deploymentConfig = {
    ...config,
    main: join(retained, "worker/index.js"),
    assets: { ...config.assets, directory: join(retained, "assets") },
    vars: {
      ...config.vars,
      USHSO_ACCEPTED_RIGHTS_HASH: handoff.rights_policy_hash,
    },
  };
  delete deploymentConfig.$schema;
  const deploymentConfigBytes = canonical(deploymentConfig);
  await writeFile(join(output, "wrangler.json"), deploymentConfigBytes, {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(join(output, "handoff.json"), canonical(handoff), {
    flag: "wx",
    mode: 0o600,
  });
  return {
    target,
    handoff,
    output,
    configuration_sha256: sha256(deploymentConfigBytes),
  };
}

async function main() {
  const [inputsPath, destination, option] = process.argv.slice(2);
  if (inputsPath === "--target") {
    console.log(
      productionTarget(
        JSON.parse(await readFile(join(repository, "wrangler.jsonc"), "utf8")),
      ),
    );
    return;
  }
  if (!inputsPath || !destination || (option && option !== "--apply"))
    fail("USAGE_INPUTS_DESTINATION_OPTIONAL_APPLY");
  const prepared = await prepareApprovedDeployment({ inputsPath, destination });
  if (option !== "--apply") {
    console.log(
      JSON.stringify({ status: "prepared", ...prepared, deployed: false }),
    );
    return;
  }
  // Revalidate current external authority and exact bytes immediately before dispatch.
  const confirmed = await loadAndValidateHandoff(inputsPath, {
    currentAssetsDirectory: join(repository, "apps/web/dist"),
    currentWorkerFile: join(repository, ".wrangler-dry-run/index.js"),
    target: prepared.target,
  });
  const stableHandoff = (value) => ({ ...value, prepared_at: null });
  if (
    canonical(stableHandoff(confirmed)) !==
    canonical(stableHandoff(prepared.handoff))
  )
    fail("APPROVAL_CHANGED_BEFORE_DISPATCH");
  if (
    sha256(await readFile(join(prepared.output, "wrangler.json"))) !==
    prepared.configuration_sha256
  )
    fail("DEPLOYMENT_CONFIGURATION_CHANGED");
  const code = await new Promise((accept, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(repository, "node_modules/wrangler/bin/wrangler.js"),
        "deploy",
        "--config",
        join(prepared.output, "wrangler.json"),
        "--no-bundle",
      ],
      {
        cwd: prepared.output,
        stdio: "inherit",
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => accept(code));
  });
  const receipt = {
    status: code === 0 ? "deployment_command_completed" : "deployment_failed",
    exit_code: code,
    inventory_sha256: confirmed.inventory_sha256,
    generation_id: confirmed.generation_id,
    observed_at: new Date().toISOString(),
    live_checks: [],
  };
  if (code === 0) {
    for (const host of ["ushso.org", "www.ushso.org"]) {
      try {
        const response = await fetch(
          `https://${host}/api/source-selection/v1/publication`,
          { signal: AbortSignal.timeout(15000), redirect: "error" },
        );
        const value = await response.json();
        receipt.live_checks.push({
          host,
          status: response.status,
          matches:
            response.status === 200 &&
            value.status === "available" &&
            value.generation_id === confirmed.generation_id &&
            value.bundle_hash === confirmed.bundle_hash &&
            value.rights_hash === confirmed.rights_policy_hash,
        });
      } catch {
        receipt.live_checks.push({
          host,
          matches: false,
          reason: "readback_failed",
        });
      }
    }
    receipt.status = receipt.live_checks.every((check) => check.matches)
      ? "publication_verified"
      : "deployment_readback_failed";
  }
  await writeFile(
    join(prepared.output, "deployment.json"),
    canonical(receipt),
    { flag: "wx", mode: 0o600 },
  );
  console.log(JSON.stringify(receipt));
  if (receipt.status !== "publication_verified") process.exitCode = 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
