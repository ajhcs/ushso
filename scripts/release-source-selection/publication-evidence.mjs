import { readFile, realpath, lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { canonical, sha256 } from "../../packages/source-selection/index.mjs";
import { readPublished } from "../../packages/source-selection/ledger.mjs";
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
async function readExternal(path) {
  if (
    typeof path !== "string" ||
    !resolve(path).startsWith("/workspace/") ||
    (await realpath(path)) !== resolve(path)
  )
    fail("EXTERNAL_AUTHORITY_REQUIRED");
  const h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await h.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024)
      fail("INVALID_CURRENT_AUTHORITY");
    return JSON.parse(await h.readFile("utf8"));
  } finally {
    await h.close();
  }
}
// These inputs come from the operator's current control plane, never the retained bundle.
export async function currentSchemaHashes() {
  return Object.fromEntries(
    await Promise.all(
      ["index.mjs", "projection-contract.mjs"].map(async (name) => [
        name === "index.mjs"
          ? "ushso.source-selection.v1"
          : "projection-contract",
        sha256(
          await readFile(
            new URL(`../../packages/source-selection/${name}`, import.meta.url),
          ),
        ),
      ]),
    ),
  );
}
export async function currentAuthority({
  currentRightsPolicyPath,
  expectedRightsHash,
  currentPublicationPath,
} = {}) {
  if (
    !currentRightsPolicyPath ||
    !currentPublicationPath ||
    !/^[a-f0-9]{64}$/.test(expectedRightsHash ?? "")
  )
    fail("CURRENT_PUBLICATION_AUTHORITY_REQUIRED");
  const policy = await readExternal(currentRightsPolicyPath);
  if (sha256(canonical(policy)) !== expectedRightsHash)
    fail("CURRENT_RIGHTS_HASH_MISMATCH");
  if (
    !Array.isArray(policy.revoked_rights) ||
    policy.revoked_rights.some((x) => typeof x !== "string")
  )
    fail("INVALID_CURRENT_RIGHTS_POLICY");
  if (
    !Number.isFinite(Date.parse(policy.checked_at)) ||
    !Number.isFinite(Date.parse(policy.review_valid_until)) ||
    Date.parse(policy.checked_at) > Date.now() ||
    Date.parse(policy.review_valid_until) <= Date.now() ||
    Date.parse(policy.review_valid_until) <= Date.parse(policy.checked_at)
  )
    fail("CURRENT_RIGHTS_REVIEW_REQUIRED");
  if (
    policy.expires_at &&
    (!Number.isFinite(Date.parse(policy.expires_at)) ||
      Date.parse(policy.expires_at) <= Date.now())
  )
    fail("CURRENT_RIGHTS_EXPIRED");
  const publication = await readExternal(currentPublicationPath);
  if (publication.status === "withdrawn") fail("PUBLICATION_WITHDRAWN");
  return { policy, publication };
}
export async function verifyPublicationEvidence({
  ledgerRoot,
  publication,
  authority,
  retainedRoot,
}) {
  const { policy, publication: current } = await currentAuthority(authority);
  for (const path of [
    authority.currentRightsPolicyPath,
    authority.currentPublicationPath,
  ])
    if (
      retainedRoot &&
      (resolve(path) === resolve(retainedRoot) ||
        resolve(path).startsWith(resolve(retainedRoot) + "/"))
    )
      fail("EXTERNAL_AUTHORITY_REQUIRED");
  for (const [external, internal] of [
    [
      authority.currentRightsPolicyPath,
      join(ledgerRoot, `rights-${publication.rights_hash}.json`),
    ],
    [authority.currentPublicationPath, join(ledgerRoot, "published.json")],
  ]) {
    const [a, b] = await Promise.all([lstat(external), lstat(internal)]);
    if (a.dev === b.dev && a.ino === b.ino) fail("EXTERNAL_AUTHORITY_REQUIRED");
  }
  const expected = {
    generation_id: publication.generation_id,
    bundle_hash: publication.bundle_hash,
    rights_hash: publication.rights_hash,
    revision: publication.revision,
  };
  if (canonical(current) !== canonical(expected))
    fail("CURRENT_PUBLICATION_MISMATCH");
  if (publication.rights_hash !== authority.expectedRightsHash)
    fail("CURRENT_RIGHTS_MISMATCH");
  if (
    canonical(publication.bundle?.data_manifest?.input_schema_sha256) !==
    canonical(await currentSchemaHashes())
  )
    fail("INCOMPATIBLE_PUBLICATION_SCHEMA");
  const retainedPolicy = JSON.parse(
    await readFile(
      join(ledgerRoot, `rights-${publication.rights_hash}.json`),
      "utf8",
    ),
  );
  if (canonical(retainedPolicy) !== canonical(policy))
    fail("CURRENT_RIGHTS_MISMATCH");
  const recomputed = await readPublished(ledgerRoot);
  if (recomputed.status !== "available")
    fail(`ACCEPTED_PUBLICATION_${recomputed.reason ?? "UNAVAILABLE"}`);
  if (canonical(recomputed) !== canonical(publication))
    fail("ACCEPTED_PROJECTION_MISMATCH");
  return recomputed;
}
export async function evidencePaths(ledgerRoot, publication) {
  const ledger = JSON.parse(
    await readFile(
      join(ledgerRoot, `ledger-${publication.revision}.json`),
      "utf8",
    ),
  );
  const policy = JSON.parse(
    await readFile(
      join(ledgerRoot, `rights-${publication.rights_hash}.json`),
      "utf8",
    ),
  );
  return [
    "accepted.json",
    "published.json",
    "rights.json",
    `ledger-${publication.revision}.json`,
    `bundle-${publication.bundle_hash}.json`,
    `rights-${publication.rights_hash}.json`,
    ...ledger.captures
      .filter(
        (c) =>
          c.retention_mode === "bytes" &&
          !policy.revoked_rights.includes(c.rights_id),
      )
      .map((c) => `captures/${c.artifact_ref}`),
  ];
}
