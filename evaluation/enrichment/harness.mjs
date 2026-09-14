import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildResidualTask } from '../../packages/enrichment/task-builder.mjs';
import { validateClaim } from '../../packages/enrichment/validate-claims.mjs';
import { SUGGESTED_PILOT_USD } from '../../packages/enrichment/budget-ledger.mjs';

export const EVAL_FORMAT = 'ushso.enrichment-eval.v1';
export const PRECISION_GATE = 0.98;
export const CRITICAL_ERROR_GATE = 0;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_DIR = path.join(ROOT, 'evaluation/enrichment');

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function loadPublicTasks(evalDir = DEFAULT_DIR) {
  const tasks = loadJson(path.join(evalDir, 'tasks.public.json'));
  if (tasks.held_out_labels_included === true) fail('HELD_OUT_LABELS_IN_PROMPT');
  if (tasks.model_output_is_gold === true) fail('MODEL_OUTPUT_NOT_GOLD');
  return freeze(tasks);
}

export function loadHeldOutLabels(evalDir = DEFAULT_DIR) {
  const labels = loadJson(path.join(evalDir, 'labels.held-out.json'));
  if (labels.model_output_is_gold === true) fail('MODEL_OUTPUT_NOT_GOLD');
  const classes = new Set(labels.labels.map((row) => row.critical_error_class));
  if (classes.size < 4) fail('CRITICAL_ERROR_CATEGORIES_REQUIRED');
  if (!labels.labels.some((row) => row.reviewer_disagreement === true)) fail('REVIEWER_DISAGREEMENT_REQUIRED');
  return freeze(labels);
}

export function freezeClaimTargets({ evalDir = DEFAULT_DIR } = {}) {
  const tasks = loadPublicTasks(evalDir);
  const labels = loadHeldOutLabels(evalDir);
  const publicHash = createHash('sha256').update(readFileSync(path.join(evalDir, 'tasks.public.json'))).digest('hex');
  const labelHash = createHash('sha256').update(readFileSync(path.join(evalDir, 'labels.held-out.json'))).digest('hex');
  return freeze({
    format: 'ushso.enrichment-eval-freeze.v1',
    frozen_before_scoring: true,
    public_tasks_sha256: publicHash,
    labels_sha256: labelHash,
    task_count: tasks.tasks.length,
    r14_accepted: false,
    model_output_is_gold: false,
    labels_outside_prompts: tasks.held_out_labels_included === false,
  });
}

function taskFor(publicTask) {
  return buildResidualTask({
    task_id: publicTask.task_id,
    record_id: publicTask.record_id,
    field: publicTask.field,
    source_bytes: publicTask.source_bytes,
    source_release: publicTask.source_release,
    pages: publicTask.pages?.length ? publicTask.pages : undefined,
    missing_publisher_document: publicTask.missing_publisher_document === true,
  });
}

export function scoreRecordedOutput({ publicTask, label, output, modelId }) {
  if (publicTask.missing_publisher_document === true) {
    const guessed = output.claim_type !== 'abstention' || output.value;
    return freeze({
      task_id: publicTask.task_id,
      task_class: publicTask.task_class,
      model: modelId,
      expected_status: label.expected_status,
      observed_status: guessed ? 'guessed' : 'abstain',
      accepted: false,
      correct: guessed ? false : true,
      critical_error: guessed,
      critical_error_class: guessed ? label.critical_error_class : null,
      rejected: guessed,
      abstained: !guessed,
      usage: freeze(output.usage ?? {}),
      scientific_certified: false,
    });
  }
  const residual = taskFor(publicTask);
  const claim = validateClaim({
    task: { ...residual, expected_value: label.expected_value, semantic_role: publicTask.field },
    raw: output,
    model: modelId,
  });
  const valueMatch = output.value === label.expected_value;
  const accepted = claim.status === 'accepted' && valueMatch;
  const critical = label.expected_status === 'accepted' && output.claim_type !== 'abstention' && !valueMatch;
  return freeze({
    task_id: publicTask.task_id,
    task_class: publicTask.task_class,
    model: modelId,
    expected_status: label.expected_status,
    observed_status: claim.status,
    accepted,
    correct: accepted,
    critical_error: critical,
    critical_error_class: critical ? label.critical_error_class : null,
    rejected: claim.status === 'rejected' || claim.status === 'review',
    abstained: output.claim_type === 'abstention',
    usage: freeze(output.usage ?? {}),
    scientific_certified: claim.scientific_certified === true,
    claim_status: claim.status,
  });
}

function summarize(rows, model) {
  const judged = rows.filter((row) => row.expected_status === 'accepted' || row.task_class !== 'insufficient_evidence');
  const accepted = rows.filter((row) => row.accepted);
  const correct = rows.filter((row) => row.correct && row.expected_status === 'accepted');
  const critical = rows.filter((row) => row.critical_error);
  const precision = accepted.length === 0 ? 0 : correct.length / accepted.length;
  const coverage = judged.filter((row) => row.expected_status === 'accepted').length === 0
    ? 0
    : correct.length / rows.filter((row) => row.expected_status === 'accepted').length;
  const tokens = rows.reduce((sum, row) => sum + (row.usage.prompt_tokens ?? 0) + (row.usage.completion_tokens ?? 0), 0);
  const cost = rows.reduce((sum, row) => sum + (row.usage.cost_usd ?? 0), 0);
  const review = rows.filter((row) => row.rejected || row.task_class === 'insufficient_evidence').length * 0.05;
  const classes = {};
  for (const row of rows) {
    const bucket = classes[row.task_class] ?? { accepted: 0, correct: 0, critical: 0 };
    if (row.accepted) bucket.accepted += 1;
    if (row.correct && row.expected_status === 'accepted') bucket.correct += 1;
    if (row.critical_error) bucket.critical += 1;
    classes[row.task_class] = bucket;
  }
  const disabled = Object.entries(classes)
    .filter(([, stats]) => stats.critical > CRITICAL_ERROR_GATE || (stats.accepted > 0 && stats.correct / stats.accepted < PRECISION_GATE))
    .map(([name]) => name);
  const publicationEligible = precision >= PRECISION_GATE && critical.length === CRITICAL_ERROR_GATE && disabled.length === 0;
  return freeze({
    model: model.id,
    residual_eligible: model.residual_eligible === true,
    precision,
    useful_coverage: coverage,
    critical_errors: critical.length,
    tokens,
    actual_price_usd: Number(cost.toFixed(8)),
    review_cost_usd: Number(review.toFixed(8)),
    total_cost_usd: Number((cost + review).toFixed(8)),
    abstentions: rows.filter((row) => row.abstained).length,
    rejected_claims: rows.filter((row) => row.rejected).length,
    disabled_task_classes: freeze(disabled),
    publication_eligible: publicationEligible,
    cheap_tokens_do_not_override: true,
    inter_model_agreement_does_not_override: true,
  });
}

export function runPairedEvaluation({ evalDir = DEFAULT_DIR, live = false, credentials = null } = {}) {
  if (live === true) {
    const models = loadJson(path.join(evalDir, 'models.json'));
    fail('LIVE_EVAL_FORBIDDEN', JSON.stringify({
      code: 'LIVE_EVAL_FORBIDDEN',
      models: models.models.map((row) => ({ id: row.id, endpoint: row.endpoint })),
      total_spend_usd: 0,
      credentials_used: Boolean(credentials),
    }));
  }
  const freezeRecord = freezeClaimTargets({ evalDir });
  const publicTasks = loadPublicTasks(evalDir);
  const labels = loadHeldOutLabels(evalDir);
  const models = loadJson(path.join(evalDir, 'models.json'));
  const recorded = loadJson(path.join(evalDir, 'recorded-outputs.json'));
  if (recorded.live === true) fail('RECORDED_OUTPUTS_MUST_BE_OFFLINE');
  const byId = Object.fromEntries(labels.labels.map((row) => [row.task_id, row]));
  const perModel = {};
  for (const model of models.models) {
    const rows = publicTasks.tasks.map((task) => {
      const output = recorded.outputs?.[model.id]?.[task.task_id];
      if (!output) fail('MISSING_RECORDED_OUTPUT');
      return scoreRecordedOutput({ publicTask: task, label: byId[task.task_id], output, modelId: model.id });
    });
    perModel[model.key] = freeze({
      model,
      rows: freeze(rows),
      summary: summarize(rows, model),
    });
  }
  const agreement = publicTasks.tasks.filter((task) => {
    const values = models.models.map((model) => recorded.outputs[model.id][task.task_id].value);
    return values.every((value) => value === values[0]);
  }).length;
  const selected = Object.values(perModel)
    .filter((row) => row.summary.publication_eligible && row.model.residual_eligible)
    .sort((a, b) => b.summary.precision - a.summary.precision)[0] ?? null;
  return freeze({
    format: EVAL_FORMAT,
    freeze: freezeRecord,
    offline: true,
    credentials_used: false,
    pilot_budget_usd: SUGGESTED_PILOT_USD,
    per_model: freeze(perModel),
    inter_model_agreement_count: agreement,
    inter_model_agreement_overrides_gate: false,
    selected_model: selected?.model.id ?? null,
    publication_eligible: selected !== null,
    deterministic_collection_operational: true,
    r14_accepted: false,
    model_output_is_gold: false,
  });
}

export function selectPolicy(result) {
  const disabled = {};
  for (const [key, row] of Object.entries(result.per_model)) {
    disabled[row.model.id] = row.summary.disabled_task_classes;
  }
  return freeze({
    format: 'ushso.model-selection.v1',
    selected_model: result.selected_model,
    publication_eligible: result.publication_eligible,
    disabled_task_classes: freeze(disabled),
    precision_gate: PRECISION_GATE,
    critical_error_gate: CRITICAL_ERROR_GATE,
    cheap_tokens_override: false,
    inter_model_agreement_override: false,
    deterministic_collection_operational: true,
    r14_accepted: false,
  });
}
