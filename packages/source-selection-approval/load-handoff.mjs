import { readFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { sha256, canonical } from "../source-selection/index.mjs";
import { buildProductionHandoff } from "./handoff.mjs";
import { verifyPrivateEvidence } from "./artifacts.mjs";
import {
  verifyRetainedRelease,
  workspacePath,
} from "../../scripts/release-source-selection/restore-release.mjs";
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
export async function loadAndValidateHandoff(
  inputsPath,
  { currentAssetsDirectory, currentWorkerFile, target } = {},
) {
  const inputs = JSON.parse(await readFile(inputsPath, "utf8"));
  const payload = { target: target || inputs.target };
  if (target && target !== inputs.target) fail("deployment_target_mismatch");
  for (const key of [
    "packet",
    "baseLedger",
    "records",
    "ledger",
    "bundle",
    "rightsPolicy",
    "restoreReceipt",
    "approval",
  ])
    payload[key] = JSON.parse(await readFile(inputs[key], "utf8"));
  await verifyPrivateEvidence(payload.packet);
  payload.retainedManifest = await verifyRetainedRelease(
    inputs.retainedDirectory,
    {
      expectedInventoryHash: payload.restoreReceipt.inventory_sha256,
      currentRightsPolicyPath: inputs.currentRightsPolicyPath,
      currentPublicationPath: inputs.currentPublicationPath,
      expectedRightsHash: inputs.expectedRightsHash,
    },
  );
  const assets = await workspacePath(
      currentAssetsDirectory || inputs.currentAssetsDirectory,
    ),
    worker = await workspacePath(currentWorkerFile || inputs.currentWorkerFile);
  const observed = [];
  async function scan(dir, prefix = "") {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name),
        rel = prefix + name,
        st = await lstat(path);
      if (st.isSymbolicLink()) fail("current_asset_symlink");
      if (st.isDirectory()) await scan(path, rel + "/");
      else if (st.isFile()) {
        const b = await readFile(path);
        observed.push({
          path: "assets/" + rel,
          sha256: sha256(b),
          bytes: b.length,
        });
      } else fail("current_asset_not_regular");
    }
  }
  await scan(assets);
  const wb = await readFile(worker);
  observed.push({
    path: "worker/index.js",
    sha256: sha256(wb),
    bytes: wb.length,
  });
  const expected = payload.retainedManifest.files.filter(
    (e) => e.path.startsWith("assets/") || e.path === "worker/index.js",
  );
  if (
    canonical(observed.sort((a, b) => a.path.localeCompare(b.path))) !==
    canonical(expected.slice().sort((a, b) => a.path.localeCompare(b.path)))
  )
    fail("current_application_differs_from_qualified_restore");
  const handoff = buildProductionHandoff(payload);
  return {
    ...handoff,
    retained_directory: await workspacePath(inputs.retainedDirectory),
  };
}
