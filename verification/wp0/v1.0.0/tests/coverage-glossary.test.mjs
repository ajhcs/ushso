import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const planPath = resolve(
  repositoryRoot,
  "docs/RESEARCH_NAVIGATOR_IMPLEMENTATION_PLAN.md",
);
const glossaryPath = resolve(
  repositoryRoot,
  "docs/COVERAGE_DENOMINATOR_GLOSSARY.md",
);

const [plan, glossary] = await Promise.all([
  readFile(planPath, "utf8"),
  readFile(glossaryPath, "utf8"),
]);
const glossaryProse = glossary.replace(/\s+/g, " ");

function markdownRows(markdown, heading, nextHeading, columnCount) {
  const start = markdown.indexOf(heading);
  const end = markdown.indexOf(nextHeading, start + heading.length);
  assert.notEqual(start, -1, `missing section ${heading}`);
  assert.notEqual(end, -1, `missing section boundary ${nextHeading}`);

  return markdown
    .slice(start, end)
    .split("\n")
    .filter((line) => line.startsWith("| "))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter(
      (cells) =>
        cells.length === columnCount &&
        !cells.every((cell) => /^-+$/.test(cell)) &&
        cells[0] !== "Metric",
    );
}

function equationTerms(markdown, rightHandSide) {
  const match = markdown.match(
    new RegExp(`([a-z_]+(?: \\+ [a-z_]+)+) = ${rightHandSide}`),
  );
  assert.ok(match, `missing ${rightHandSide} partition equation`);
  return match[1].split(" + ");
}

test("the glossary defines every authoritative section 16.3 metric exactly once", () => {
  const planRows = markdownRows(
    plan,
    "### 16.3 Required denominators",
    "### 16.4 Coverage UI",
    4,
  );
  const glossaryRows = markdownRows(
    glossary,
    "## 3. Required metric definitions",
    "## 4. Complete partitions",
    5,
  );

  const planNames = planRows.map(([name]) => name);
  const glossaryNames = glossaryRows.map(([name]) => name);
  assert.deepEqual(glossaryNames, planNames);
  assert.equal(new Set(glossaryNames).size, 18);

  const ids = glossaryRows.map(([, id]) => id.replaceAll("`", ""));
  assert.equal(new Set(ids).size, ids.length, "metric IDs must be unique");
  for (const id of ids) {
    assert.match(id, /^coverage\.[a-z_]+\/v1$/);
  }

  for (const [name, id, unit, numerator, denominator] of glossaryRows) {
    assert.ok(name && id && unit && numerator && denominator);
    assert.ok(numerator.length >= 25, `${name} numerator is underspecified`);
    assert.ok(denominator.length >= 25, `${name} denominator is underspecified`);
  }
});

test("complete partitions use the frozen mutually exclusive member states", () => {
  assert.deepEqual(
    equationTerms(glossary, "ingested"),
    [
      "normalized",
      "pending",
      "failed",
      "excluded",
      "not_applicable",
      "unknown",
    ],
  );
  assert.deepEqual(
    equationTerms(glossary, "configured"),
    ["active", "paused", "excluded", "retired", "unassessed"],
  );
  assert.match(glossary, /six sets MUST be pairwise disjoint/);
  assert.match(glossary, /five sets MUST be pairwise disjoint and exhaustive/);
  assert.match(glossary, /confirmed duplicate[\s\S]{0,120}`normalized`/i);
});

test("orthogonal axes, typed units, and overlap cannot collapse into one status", () => {
  const requiredAxes = [
    "Milestone",
    "Inclusion",
    "Pipeline",
    "Freshness",
    "Access",
    "Identity",
  ];
  for (const axis of requiredAxes) {
    assert.match(glossary, new RegExp(`\\| ${axis} \\|`));
  }

  for (const state of [
    "integrated",
    "candidate",
    "navigation_only",
    "evidence_gap",
    "inaccessible",
    "unknown",
    "not_assessed",
  ]) {
    assert.match(glossary, new RegExp(`\\b${state}\\b`));
  }

  assert.match(
    glossary,
    /counts from different[\s\n]+axes are therefore \*\*non-additive\*\*/i,
  );
  assert.match(glossaryProse, /Never divide native items by canonical assets/i);
  assert.match(glossaryProse, /It is not copied into 51 state-scope units/i);
  assert.match(glossaryProse, /counts once in the global asset inventory/i);
  assert.match(
    glossaryProse,
    /cohort totals are visibly overlapping and MUST NOT be summed/i,
  );
  assert.match(
    glossaryProse,
    /operator location never supplies missing record geography/i,
  );
});

test("unknown, not-applicable, exclusions, and failed enumeration stay honest", () => {
  assert.match(glossary, /`unknown`[\s\S]{0,180}neither success nor failure/i);
  assert.match(glossary, /`not_applicable`[\s\S]{0,220}Lack of evidence is `unknown`/i);
  assert.match(glossary, /Excluded members remain visible in every upstream\s+denominator/i);
  assert.match(glossary, /downstream classification must not remove an upstream member/i);
  assert.match(glossary, /A failed enumeration MUST NOT:/);
  assert.match(glossary, /create a zero-item denominator or zero-item inventory claim/);
  assert.match(glossary, /assert that an item, jurisdiction, source, release, or distribution is absent/);
  assert.match(glossary, /last-known-good sealed membership remains/i);
  assert.match(glossary, /absence_claim_permitted/);
  assert.match(glossary, /enumeration_incomplete/);
});

test("rendering and evidence requirements cover null rates, revisions, and reproducibility", () => {
  assert.match(glossary, /known denominator is zero[\s\S]{0,100}`0 of 0 <unit>`[\s\S]{0,50}`rate = null`/i);
  assert.match(glossary, /`n of d <unit>`/);
  assert.match(glossary, /denominator[\s\n]+unknown`, never `n of 0`/);
  assert.match(glossary, /membership_manifest_hash/);
  assert.match(glossary, /lowercase SHA-256 digest of the canonical\s+manifest bytes/i);
  assert.match(glossary, /Counts MUST be reproducible from known-denominator manifests/);

  for (const revision of [
    "registry_revision",
    "source_scope_revision",
    "policy_revision",
    "connector_revision",
    "canonical_revision",
    "coverage_contract_version",
    "coverage_snapshot_id",
    "index_generation",
  ]) {
    assert.match(glossary, new RegExp(`\\b${revision}\\b`));
  }

  assert.match(glossary, /`as_of` is the UTC instant/);
  assert.match(glossary, /It never recomputes\s+counts against mutable “latest” rows/i);
  assert.match(glossary, /Why this denominator\?/);
});
