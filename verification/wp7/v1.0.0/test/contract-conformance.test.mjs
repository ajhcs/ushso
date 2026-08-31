import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { loadSchemas as loadCoreSchemas } from "../../../../contracts/core/v2.0.0/tools/schema.mjs";
import { loadSchemas as loadIdentitySchemas, validatorFor } from "../../../../contracts/identity/v1.0.0/tools/schema.mjs";
import {
  appendReviewDecision,
  buildProjectionInputs,
  buildReversalPlan,
  classifyMachineReadiness,
  createAccessRecipe,
  createRetrievalRecipe,
  createUseCard,
  generateIdentityCandidates,
  ImmutableSchemaCatalog,
  materializeReviewDecisions,
  validateJoinRoute,
} from "../../../../packages/identity/src/index.mjs";
import { assertionFixture, identityObjects, joinFixture, namespaceFixture, RECORDED_AT, schemaFixture } from "../../../../packages/identity/fixtures/production-shaped.mjs";
import { accessRecipeInput, readinessInput, retrievalRecipeInput, useCardInput } from "../fixtures/researcher-guidance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function assertIdentitySchema(name, value) {
  const validate = await validatorFor(name);
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
}

test("package outputs conform to frozen identity candidate and reversal contracts", async () => {
  const { candidates } = generateIdentityCandidates({ assertions: [assertionFixture("alpha"), assertionFixture("beta")], namespaces: [namespaceFixture()], createdAt: RECORDED_AT });
  const candidate = candidates[0];
  await assertIdentitySchema("identity-candidate.schema.json", candidate);
  let reviews = appendReviewDecision([], {
    schema_version: "identity.review-decision.v1.0.0",
    decision_id: "decision:controlled.accept",
    candidate_id: candidate.candidate_id,
    decision: "same_identity",
    reviewer: { reviewer_id: "reviewer:controlled.fixture", role: "controlled reversal test", human: true },
    rationale: "Controlled fixture decision used only for deterministic reversal verification.",
    evidence_ids: ["evidence:controlled.reversal"],
    algorithm_version: "1.0.0",
    decided_at: RECORDED_AT,
    recorded_at: RECORDED_AT,
    supersedes_decision_id: null,
  }, { status: "controlled_fixture_not_adjudication_evidence" });
  const before = buildProjectionInputs({ objects: identityObjects(), candidates, reviewEvents: reviews, includeControlledFixtures: true, graphRevisionId: "graph-revision:before", projectedAt: RECORDED_AT, plannerFixtureIds: ["plan-fixture:reversal"] });
  await assertIdentitySchema("relationship-projection.schema.json", before.relationship_projections[0]);
  reviews = appendReviewDecision(reviews, {
    ...reviews[0],
    decision_id: "decision:controlled.reverse",
    decision: "not_same_identity",
    supersedes_decision_id: "decision:controlled.accept",
  }, { status: "controlled_fixture_not_adjudication_evidence" });
  const after = buildProjectionInputs({ objects: identityObjects(), candidates, reviewEvents: reviews, includeControlledFixtures: true, graphRevisionId: "graph-revision:after", projectedAt: RECORDED_AT, plannerFixtureIds: ["plan-fixture:reversal"] });
  const reversal = buildReversalPlan({ before, after, candidateId: candidate.candidate_id, supersededDecisionId: "decision:controlled.accept", supersedingDecisionId: "decision:controlled.reverse", plannerFixtureIds: ["plan-fixture:reversal"], recordedAt: RECORDED_AT });
  await assertIdentitySchema("reversal-plan.schema.json", reversal);
  const materialized = materializeReviewDecisions(reviews);
  assert.equal(materialized.filter((item) => item.state === "current").length, 1);
});

test("production-shaped schema and join fixtures conform to frozen contracts", async () => {
  const { ajv: coreAjv } = await loadCoreSchemas();
  const catalog = new ImmutableSchemaCatalog();
  for (const side of ["left", "right"]) {
    const fixture = schemaFixture(side);
    const snapshotValidator = coreAjv.getSchema("https://ushso.org/contracts/core/v2.0.0/schemas/schema-snapshot.schema.json");
    const fieldValidator = coreAjv.getSchema("https://ushso.org/contracts/core/v2.0.0/schemas/schema-field.schema.json");
    assert.equal(snapshotValidator(fixture.snapshot), true, JSON.stringify(snapshotValidator.errors));
    assert.equal(fieldValidator(fixture.fields[0]), true, JSON.stringify(fieldValidator.errors));
    catalog.registerSnapshot(fixture.snapshot, fixture.fields);
  }
  const { route, steps } = joinFixture();
  await assertIdentitySchema("join-route.schema.json", route);
  await assertIdentitySchema("transformation-step.schema.json", steps[0]);
  assert.equal(validateJoinRoute({ route, steps, schemaCatalog: catalog, namespaceIds: ["namespace:cms.ccn"] }).steps.length, 1);
});

test("researcher-guidance outputs conform to their immutable package schemas", async () => {
  const { ajv } = await loadIdentitySchemas();
  const records = [
    ["researcher-use-card.schema.json", createUseCard(useCardInput())],
    ["access-recipe.schema.json", createAccessRecipe(accessRecipeInput())],
    ["retrieval-recipe.schema.json", createRetrievalRecipe(retrievalRecipeInput())],
    ["machine-readiness.schema.json", classifyMachineReadiness(readinessInput())],
  ];
  for (const [name, record] of records) {
    const schema = JSON.parse(await fs.readFile(path.join(root, `../../../packages/identity/schemas/${name}`), "utf8"));
    ajv.addSchema(schema, schema.$id);
    const validate = ajv.getSchema(schema.$id);
    assert.equal(validate(record), true, `${name}: ${JSON.stringify(validate.errors)}`);
  }
});
