import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT_ROOT = path.resolve(PACKAGE_ROOT, '..', '..', '..', '..');
export const FIXED_TIME = '2026-08-30T00:00:00Z';

const EXPECTED_RESPONSE_TYPES = ['single_source', 'multi_source_bundle', 'clarification_required', 'unsupported_or_incomplete'];
const EXPECTED_SPLITS = ['development', 'validation', 'held_out'];
const EXPECTED_GEOGRAPHIES = ['pennsylvania', 'national_federal', 'comparative_multi_state', 'other_state_locality', 'geography_ambiguous_or_independent'];
const POSITIVE_LABELS = ['essential', 'highly_relevant', 'conditionally_relevant', 'contextual'];
const NEGATIVE_LABELS = ['near_miss', 'irrelevant', 'prohibited_by_access_constraint', 'insufficient_evidence', 'unresolved_identity', 'unavailable_in_current_index'];
const JOIN_STATUSES = ['join_proven', 'join_documented', 'join_candidate', 'join_requires_crosswalk', 'incompatible_grain', 'incompatible_time', 'incompatible_geography', 'unknown'];
const EXPECTED_COUNTS = {
  question_count: 60,
  question_composition: Object.fromEntries(EXPECTED_GEOGRAPHIES.map(item => [item, 12])),
  response_type_composition: { single_source: 18, multi_source_bundle: 24, clarification_required: 10, unsupported_or_incomplete: 8 },
  split_counts: { development: 20, validation: 20, held_out: 20 }
};
const REQUIRED_PACKAGE_FILES = [
  'questions.jsonl', 'question_features.jsonl', 'relevance_judgments.jsonl', 'bundle_gold.jsonl',
  'answer_plans.jsonl', 'negative_judgments.jsonl', 'evaluation_metrics.json', 'benchmark_splits.json',
  'benchmark_statistics.json', 'human_review_queue.jsonl', 'benchmark_design_report.md', 'source_reference_index.json',
  'package_manifest.json', 'validation_report.json'
];
const REGISTRY_PATH = 'discovery_financial_org/source_registry.json';
const FIXTURE_REFS = {
  'fixture:unc_closures': { path: 'observatory/index/v1.0.0/fixtures/rural-hospital-closures/unc-sheps-closures.json', recordId: 'obs:asset:unc-sheps-rural-hospital-closures' },
  'fixture:cms_pos': { path: 'observatory/index/v1.0.0/fixtures/rural-hospital-closures/cms-provider-of-services.json', recordId: 'obs:asset:cms-provider-of-services-hospital' },
  'fixture:usda_ruc': { path: 'observatory/index/v1.0.0/fixtures/rural-hospital-closures/usda-rural-urban-continuum-codes.json', recordId: 'obs:asset:usda-rural-urban-continuum-codes' },
  'fixture:aha_survey': { path: 'observatory/index/v1.0.0/fixtures/rural-hospital-closures/aha-annual-survey.json', recordId: 'obs:asset:aha-annual-survey-database' }
};

const JSONL_FILES = {
  questions: ['questions.jsonl', 'question.schema.json'],
  features: ['question_features.jsonl', 'question-feature.schema.json'],
  relevance: ['relevance_judgments.jsonl', 'relevance-judgment.schema.json'],
  negatives: ['negative_judgments.jsonl', 'negative-judgment.schema.json'],
  bundles: ['bundle_gold.jsonl', 'bundle-gold.schema.json'],
  plans: ['answer_plans.jsonl', 'answer-plan.schema.json'],
  review: ['human_review_queue.jsonl', 'human-review.schema.json']
};
const JSON_FILES = {
  metrics: ['evaluation_metrics.json', 'evaluation-metrics.schema.json'],
  splits: ['benchmark_splits.json', 'benchmark-splits.schema.json'],
  statistics: ['benchmark_statistics.json', 'benchmark-statistics.schema.json'],
  sourceIndex: ['source_reference_index.json', 'source-reference-index.schema.json'],
  manifest: ['package_manifest.json', 'package-manifest.schema.json'],
  validation: ['validation_report.json', 'validation-report.schema.json']
};

function absolute(relativePath) {
  return path.join(PROJECT_ROOT, relativePath);
}

function packageAbsolute(relativePath) {
  return path.join(PACKAGE_ROOT, relativePath);
}

function normalizePath(relativePath) {
  return String(relativePath).split(path.sep).join('/');
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(packageAbsolute(relativePath), 'utf8'));
}

async function readProjectJson(relativePath) {
  return JSON.parse(await fs.readFile(absolute(relativePath), 'utf8'));
}

async function readJsonl(relativePath) {
  const text = await fs.readFile(packageAbsolute(relativePath), 'utf8');
  return text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => ({ value: JSON.parse(line), line: index + 1 }));
}

async function exists(relativePath) {
  try {
    await fs.access(absolute(relativePath));
    return true;
  } catch {
    return false;
  }
}

async function packageExists(relativePath) {
  try {
    await fs.access(packageAbsolute(relativePath));
    return true;
  } catch {
    return false;
  }
}

async function hashPackageFile(relativePath) {
  const bytes = await fs.readFile(packageAbsolute(relativePath));
  return { bytes: bytes.byteLength, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

async function hashProjectFile(relativePath) {
  const bytes = await fs.readFile(absolute(relativePath));
  return { bytes: bytes.byteLength, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

async function listPackageFiles() {
  const output = [];
  async function visit(directory, prefix = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === 'node_modules' || entry.name.endsWith('.partial')) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target, relative);
      else if (entry.isFile() && !['package_manifest.json', 'validation_report.json'].includes(relative)) output.push(relative);
    }
  }
  await visit(PACKAGE_ROOT);
  return output.sort();
}

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'string') return typeof value === 'string';
  return true;
}

function validateAgainstSchema(value, schema, location = '$', errors = []) {
  if (schema.const !== undefined && !Object.is(value, schema.const)) errors.push(`${location}: expected const ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some(item => Object.is(item, value))) errors.push(`${location}: value is outside enum`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(type => typeMatches(value, type))) {
      errors.push(`${location}: expected type ${types.join('|')}`);
      return errors;
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${location}: shorter than minLength`);
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${location}: pattern mismatch`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) errors.push(`${location}: below minimum`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${location}: fewer than minItems`);
    if (schema.items) value.forEach((item, index) => validateAgainstSchema(item, schema.items, `${location}[${index}]`, errors));
  }
  if (typeMatches(value, 'object')) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) errors.push(`${location}: missing required property ${required}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(properties, key)) errors.push(`${location}: unexpected property ${key}`);
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) validateAgainstSchema(value[key], childSchema, `${location}.${key}`, errors);
    }
  }
  return errors;
}

export function validateRecordShape(value, schema) {
  const errors = [];
  validateAgainstSchema(value, schema, '$', errors);
  return errors;
}

function countBy(items, keyFn) {
  const output = {};
  for (const item of items) {
    const key = keyFn(item);
    output[key] = (output[key] ?? 0) + 1;
  }
  return output;
}

function sameJson(left, right) {
  const canonicalize = value => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
    return value;
  };
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function normalizeQuestion(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenSimilarity(left, right) {
  const a = new Set(normalizeQuestion(left).split(' ').filter(Boolean));
  const b = new Set(normalizeQuestion(right).split(' ').filter(Boolean));
  const intersection = [...a].filter(item => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function addEvidenceErrors(errors, refs, label) {
  if (!Array.isArray(refs) || refs.length === 0) {
    errors.push(`${label}: evidence_references is empty`);
    return;
  }
  for (const [index, ref] of refs.entries()) {
    if (!ref || typeof ref.artifact_path !== 'string' || !ref.artifact_path || typeof ref.locator !== 'string' || !ref.locator) {
      errors.push(`${label}[${index}]: evidence reference must have artifact_path and locator`);
    }
  }
}

function addQuestionSemanticErrors(question, errors) {
  if (question.clarification_needed !== (question.expected_response_type === 'clarification_required')) errors.push(`${question.question_id}: clarification_needed mismatch`);
  const status = question.supported_by_current_evidence?.status;
  if (question.expected_response_type === 'unsupported_or_incomplete' && status !== 'unsupported') errors.push(`${question.question_id}: unsupported question must retain unsupported status`);
  if (question.expected_response_type !== 'unsupported_or_incomplete' && status === 'unsupported') errors.push(`${question.question_id}: supported question cannot be marked unsupported`);
  addEvidenceErrors(errors, question.supported_by_current_evidence?.evidence_references, `${question.question_id}.supported_by_current_evidence`);
}

function addJudgmentSemanticErrors(judgment, sourceById, questionById, expectedRecommendation, errors) {
  const source = sourceById.get(judgment.source_record_id);
  const question = questionById.get(judgment.question_id);
  if (!source) errors.push(`${judgment.judgment_id}: source record does not exist in source_reference_index`);
  if (!question) errors.push(`${judgment.judgment_id}: question does not exist`);
  if (source && judgment.source_family_id !== source.source_family_id) errors.push(`${judgment.judgment_id}: source_family_id mismatch`);
  if (source && judgment.source_record_key !== source.source_record_key) errors.push(`${judgment.judgment_id}: source_record_key mismatch`);
  if (source && judgment.source_title !== source.title) errors.push(`${judgment.judgment_id}: source_title mismatch`);
  if (judgment.recommendation_allowed !== expectedRecommendation) errors.push(`${judgment.judgment_id}: recommendation_allowed mismatch`);
  addEvidenceErrors(errors, judgment.evidence_references, judgment.judgment_id);
}

function addPlanSemanticErrors(plan, question, essentialIds, allPositiveIds, bundleByQuestion, sourceById, errors) {
  const recommendation = plan.recommendation ?? {};
  const mode = question.expected_response_type;
  const ids = recommendation.source_record_ids ?? [];
  const candidateIds = recommendation.candidate_source_record_ids ?? [];
  if (mode === 'single_source') {
    if (!sameJson(ids, essentialIds) || recommendation.bundle_id !== null || recommendation.decision !== 'recommend_with_constraints') errors.push(`${question.question_id}: single-source recommendation mismatch`);
  } else if (mode === 'multi_source_bundle') {
    if (!sameJson(ids, essentialIds) || recommendation.bundle_id !== bundleByQuestion.get(question.question_id)?.bundle_id || recommendation.decision !== 'recommend_with_constraints') errors.push(`${question.question_id}: multi-source recommendation mismatch`);
  } else if (mode === 'clarification_required') {
    if (ids.length !== 0 || recommendation.bundle_id !== null || recommendation.decision !== 'hold_until_clarified') errors.push(`${question.question_id}: clarification plan must not rank a recommendation`);
    if (!plan.required_clarification?.needed || typeof plan.required_clarification.question !== 'string' || !plan.required_clarification.question) errors.push(`${question.question_id}: clarification question missing`);
    if (!allPositiveIds.every(id => candidateIds.includes(id))) errors.push(`${question.question_id}: clarification candidate sources incomplete`);
  } else if (mode === 'unsupported_or_incomplete') {
    if (ids.length !== 0 || candidateIds.length !== 0 || recommendation.bundle_id !== null || recommendation.decision !== 'abstain_with_explicit_gap') errors.push(`${question.question_id}: unsupported plan must abstain without candidate ranking`);
    if (plan.required_clarification?.needed) errors.push(`${question.question_id}: unsupported plan cannot silently turn into clarification`);
  }
  for (const id of [...ids, ...candidateIds]) if (!sourceById.has(id)) errors.push(`${question.question_id}: plan references unknown source ${id}`);
  if (plan.source_roles?.length !== allPositiveIds.length) errors.push(`${question.question_id}: source_roles does not cover all positive judgments`);
  addEvidenceErrors(errors, plan.evidence_references, `${question.question_id}.answer_plan`);
}

async function safePackageJson(relativePath, issues, label) {
  try {
    return await readJson(relativePath);
  } catch (error) {
    issues.push(`${label}: ${error.message}`);
    return null;
  }
}

async function safePackageJsonl(relativePath, issues, label) {
  try {
    return (await readJsonl(relativePath)).map(item => item.value);
  } catch (error) {
    issues.push(`${label}: ${error.message}`);
    return [];
  }
}

export async function runValidation({ writeReport = false } = {}) {
  const checks = [];
  const issues = [];
  const check = (id, condition, detail) => {
    const status = condition ? 'PASS' : 'FAIL';
    checks.push({ check_id: id, status, detail });
    if (!condition) issues.push(`${id}: ${detail}`);
  };

  const schemaNames = new Set([...Object.values(JSONL_FILES), ...Object.values(JSON_FILES)].map(item => item[1]));
  const schemas = {};
  for (const schemaName of schemaNames) schemas[schemaName] = await safePackageJson(`schemas/${schemaName}`, issues, `schema ${schemaName}`);

  const records = {};
  for (const [name, [file, schemaName]] of Object.entries(JSONL_FILES)) records[name] = await safePackageJsonl(file, issues, file);
  for (const [name, [file]] of Object.entries(JSON_FILES)) {
    if (name === 'validation' && writeReport) records[name] = null;
    else records[name] = await safePackageJson(file, issues, file);
  }

  for (const [name, [file, schemaName]] of Object.entries(JSONL_FILES)) {
    const schema = schemas[schemaName];
    const rows = records[name] ?? [];
    const rowErrors = schema ? rows.flatMap((row, index) => validateRecordShape(row, schema).map(error => `${file} row ${index + 1}: ${error}`)) : [`${file}: schema unavailable`];
    check(`schema:${file}`, rowErrors.length === 0, rowErrors.length === 0 ? `${rows.length} records match ${schemaName}.` : rowErrors.slice(0, 5).join('; '));
  }
  for (const [name, [file, schemaName]] of Object.entries(JSON_FILES)) {
    if (name === 'validation' && writeReport) {
      check(`schema:${file}`, true, 'Validation report is written atomically after the current validation pass.');
      continue;
    }
    const schema = schemas[schemaName];
    const value = records[name];
    const shapeErrors = schema && value !== null ? validateRecordShape(value, schema) : [`${file}: schema or value unavailable`];
    check(`schema:${file}`, shapeErrors.length === 0, shapeErrors.length === 0 ? `${file} matches ${schemaName}.` : shapeErrors.slice(0, 5).join('; '));
  }

  const questions = records.questions ?? [];
  const features = records.features ?? [];
  const relevance = records.relevance ?? [];
  const negatives = records.negatives ?? [];
  const bundles = records.bundles ?? [];
  const plans = records.plans ?? [];
  const reviewQueue = records.review ?? [];
  const questionById = new Map(questions.map(item => [item.question_id, item]));
  const featureById = new Map(features.map(item => [item.question_id, item]));
  const planById = new Map(plans.map(item => [item.question_id, item]));
  const bundleByQuestion = new Map(bundles.map(item => [item.question_id, item]));

  check('population:exact_question_count', questions.length === EXPECTED_COUNTS.question_count, `Expected 60 questions; found ${questions.length}.`);
  check('population:unique_question_ids', new Set(questions.map(item => item.question_id)).size === questions.length, 'Question IDs are unique.');
  check('population:question_id_format', questions.every(item => /^QTD-O3-[0-9]{3}$/.test(item.question_id)), 'Question IDs use QTD-O3-NNN format.');
  const geographyCounts = countBy(questions, item => item.geographic_composition);
  check('composition:geography', sameJson(geographyCounts, EXPECTED_COUNTS.question_composition), `Expected 12 questions in each geography composition; found ${JSON.stringify(geographyCounts)}.`);
  const typeCounts = countBy(questions, item => item.expected_response_type);
  check('composition:response_types', sameJson(typeCounts, EXPECTED_COUNTS.response_type_composition), `Expected response counts ${JSON.stringify(EXPECTED_COUNTS.response_type_composition)}; found ${JSON.stringify(typeCounts)}.`);
  const splitCounts = countBy(questions, item => item.split);
  check('composition:splits', sameJson(splitCounts, EXPECTED_COUNTS.split_counts), `Expected deterministic 20/20/20 splits; found ${JSON.stringify(splitCounts)}.`);
  check('composition:split_geography', EXPECTED_SPLITS.every(split => EXPECTED_GEOGRAPHIES.every(geo => questions.filter(item => item.split === split && item.geographic_composition === geo).length === 4)), 'Each split contains four questions from every geography composition.');
  check('questions:semantic_fields', questions.every(item => { const local = []; addQuestionSemanticErrors(item, local); return local.length === 0; }), 'Question response and evidence states are internally consistent.');
  check('questions:unique_topic_clusters', new Set(questions.map(item => item.topic_cluster)).size === questions.length, 'Topic clusters are unique and cannot leak paraphrases across splits.');

  const crossSplitNearDuplicates = [];
  for (let left = 0; left < questions.length; left += 1) {
    for (let right = left + 1; right < questions.length; right += 1) {
      if (questions[left].split !== questions[right].split) {
        const similarity = tokenSimilarity(questions[left].natural_language_question, questions[right].natural_language_question);
        if (similarity >= 0.72) crossSplitNearDuplicates.push({ left: questions[left].question_id, right: questions[right].question_id, similarity });
      }
    }
  }
  check('splits:cross_split_near_duplicates', crossSplitNearDuplicates.length === 0, crossSplitNearDuplicates.length === 0 ? 'No cross-split pair reaches the 0.72 token-Jaccard threshold.' : JSON.stringify(crossSplitNearDuplicates));

  const splitArtifact = records.splits ?? {};
  check('splits:ids_reconcile', EXPECTED_SPLITS.every(split => sameJson([...(splitArtifact.splits?.[split] ?? [])].sort(), questions.filter(item => item.split === split).map(item => item.question_id).sort())), 'benchmark_splits.json IDs reconcile to question records.');
  check('splits:counts_reconcile', sameJson(splitArtifact.counts, splitCounts), 'benchmark_splits.json counts reconcile to question records.');
  check('splits:leakage_controls', splitArtifact.leakage_controls?.unique_topic_clusters === 60 && Array.isArray(splitArtifact.leakage_controls?.cross_split_near_duplicate_pairs) && splitArtifact.leakage_controls.cross_split_near_duplicate_pairs.length === 0 && Array.isArray(splitArtifact.leakage_controls?.same_topic_cluster_across_splits) && splitArtifact.leakage_controls.same_topic_cluster_across_splits.length === 0, 'Split artifact records deterministic leakage controls.');

  const sourceIndex = records.sourceIndex ?? {};
  const sourceRecords = Array.isArray(sourceIndex.sources) ? sourceIndex.sources : [];
  const sourceById = new Map(sourceRecords.map(item => [item.source_record_id, item]));
  check('sources:nonempty', sourceRecords.length > 0, 'At least one source reference is present.');
  check('sources:unique_record_ids', new Set(sourceRecords.map(item => item.source_record_id)).size === sourceRecords.length, 'Source record IDs are unique; no identity merge is performed.');
  let registry = null;
  try { registry = await readProjectJson(REGISTRY_PATH); } catch (error) { issues.push(`source registry: ${error.message}`); }
  const registryByKey = new Map((registry?.sources ?? []).map(item => [item.key, item]));
  const sourceErrors = [];
  for (const source of sourceRecords) {
    if (!source.reference_id || !source.source_record_id || !source.source_family_id || !source.source_record_key || !source.title) sourceErrors.push(`${source.source_record_id ?? 'unknown'}: required source reference fields missing`);
    if (!(await exists(source.source_artifact))) sourceErrors.push(`${source.source_record_id}: source artifact missing ${source.source_artifact}`);
    if (source.reference_id?.startsWith('registry:')) {
      const key = source.reference_id.slice('registry:'.length);
      const registryRecord = registryByKey.get(key);
      if (!registryRecord) sourceErrors.push(`${source.reference_id}: registry key missing`);
      if (source.source_record_id !== key || source.source_record_key !== key) sourceErrors.push(`${source.reference_id}: registry identity is not preserved`);
    } else if (source.reference_id?.startsWith('fixture:')) {
      const fixture = FIXTURE_REFS[source.reference_id];
      if (!fixture) sourceErrors.push(`${source.reference_id}: unknown fixture reference`);
      else {
        try {
          const record = await readProjectJson(fixture.path);
          if (record.record_id !== fixture.recordId || source.source_record_id !== fixture.recordId || source.source_record_key !== fixture.recordId) sourceErrors.push(`${source.reference_id}: fixture identity mismatch`);
        } catch (error) { sourceErrors.push(`${source.reference_id}: ${error.message}`); }
      }
    } else sourceErrors.push(`${source.source_record_id}: reference_id must be registry or fixture scoped`);
    for (const evidence of source.evidence_references ?? []) {
      if (!(await exists(evidence.artifact_path))) sourceErrors.push(`${source.source_record_id}: evidence artifact missing ${evidence.artifact_path}`);
      if (!evidence.locator) sourceErrors.push(`${source.source_record_id}: evidence locator missing`);
    }
  }
  check('sources:project_records_and_evidence', sourceErrors.length === 0, sourceErrors.length === 0 ? `${sourceRecords.length} source records resolve to existing project artifacts and evidence references.` : sourceErrors.slice(0, 8).join('; '));
  check('sources:reference_count', sourceIndex.sources?.length === sourceIndex.source_reference_count, 'source_reference_index source_reference_count reconciles when present.');

  const positiveErrors = [];
  for (const judgment of relevance) addJudgmentSemanticErrors(judgment, sourceById, questionById, true, positiveErrors);
  check('judgments:positive_integrity', positiveErrors.length === 0, positiveErrors.length === 0 ? `${relevance.length} positive judgments resolve to sources/questions with evidence.` : positiveErrors.slice(0, 8).join('; '));
  const negativeErrors = [];
  for (const judgment of negatives) addJudgmentSemanticErrors(judgment, sourceById, questionById, false, negativeErrors);
  check('judgments:negative_integrity', negativeErrors.length === 0, negativeErrors.length === 0 ? `${negatives.length} negative judgments resolve to sources/questions with evidence and explicit rejection reasons.` : negativeErrors.slice(0, 8).join('; '));
  check('judgments:allowed_labels', relevance.every(item => POSITIVE_LABELS.includes(item.label)) && negatives.every(item => NEGATIVE_LABELS.includes(item.label)), 'Judgment labels use the allowed positive/negative vocabularies.');
  check('judgments:negative_recommendation_gate', negatives.every(item => item.recommendation_allowed === false), 'Every negative judgment is prohibited from recommendation.');
  check('judgments:access_sensitive_cases', negatives.some(item => item.label === 'prohibited_by_access_constraint') && relevance.some(item => /application|account|license|payment|restricted|anonymous/i.test(item.access_implications)), 'Access restrictions materially influence relevance judgments.');

  const positiveByQuestion = new Map();
  for (const judgment of relevance) positiveByQuestion.set(judgment.question_id, [...(positiveByQuestion.get(judgment.question_id) ?? []), judgment]);
  const negativeByQuestion = new Map();
  for (const judgment of negatives) negativeByQuestion.set(judgment.question_id, [...(negativeByQuestion.get(judgment.question_id) ?? []), judgment]);
  const planErrors = [];
  for (const question of questions) {
    const positives = positiveByQuestion.get(question.question_id) ?? [];
    const essentialIds = positives.filter(item => item.label === 'essential').map(item => item.source_record_id);
    const allPositiveIds = positives.map(item => item.source_record_id);
    const plan = planById.get(question.question_id);
    if (!plan) { planErrors.push(`${question.question_id}: answer plan missing`); continue; }
    addPlanSemanticErrors(plan, question, essentialIds, allPositiveIds, bundleByQuestion, sourceById, planErrors);
    if (question.expected_response_type === 'single_source' && essentialIds.length !== 1) planErrors.push(`${question.question_id}: single-source question must have exactly one essential source`);
    if (question.expected_response_type === 'multi_source_bundle' && essentialIds.length < 2) planErrors.push(`${question.question_id}: bundle question needs at least two essential sources`);
    if (question.expected_response_type === 'clarification_required' && essentialIds.length !== 0) planErrors.push(`${question.question_id}: clarification question cannot rank an essential source before clarification`);
    if (question.expected_response_type === 'unsupported_or_incomplete' && (positives.length !== 0 || (negativeByQuestion.get(question.question_id) ?? []).length === 0)) planErrors.push(`${question.question_id}: unsupported question must have no positive source and at least one scoped negative judgment`);
  }
  check('plans:complete_and_consistent', planErrors.length === 0 && plans.length === questions.length && new Set(plans.map(item => item.question_id)).size === plans.length, planErrors.length === 0 ? `${plans.length} answer plans reconcile to question response types.` : planErrors.slice(0, 10).join('; '));

  const bundleErrors = [];
  for (const bundle of bundles) {
    const question = questionById.get(bundle.question_id);
    if (!question || question.expected_response_type !== 'multi_source_bundle') bundleErrors.push(`${bundle.bundle_id}: bundle question is not multi_source_bundle`);
    if (bundle.join_status === 'join_proven' || bundle.actual_join_proven !== false) bundleErrors.push(`${bundle.bundle_id}: join proof is not permitted without existing project proof`);
    if (new Set(bundle.minimum_viable_bundle).size !== bundle.minimum_viable_bundle.length || bundle.minimum_viable_bundle.length < 2) bundleErrors.push(`${bundle.bundle_id}: minimum viable bundle must contain at least two unique sources`);
    const essentials = (positiveByQuestion.get(bundle.question_id) ?? []).filter(item => item.label === 'essential').map(item => item.source_record_id);
    if (!sameJson([...bundle.minimum_viable_bundle].sort(), [...essentials].sort())) bundleErrors.push(`${bundle.bundle_id}: minimum viable bundle does not equal essential judgments`);
    for (const id of [...bundle.minimum_viable_bundle, ...bundle.optional_enrichment_sources]) if (!sourceById.has(id)) bundleErrors.push(`${bundle.bundle_id}: unknown source ${id}`);
    for (const role of bundle.required_analytical_roles ?? []) if (!role.source_record_ids?.every(id => bundle.minimum_viable_bundle.includes(id))) bundleErrors.push(`${bundle.bundle_id}: required role references a non-essential source`);
    for (const assessment of bundle.join_assessments ?? []) {
      if (!JOIN_STATUSES.includes(assessment.status)) bundleErrors.push(`${bundle.bundle_id}: invalid join status ${assessment.status}`);
      addEvidenceErrors(bundleErrors, assessment.evidence_references, `${bundle.bundle_id}.${assessment.assessment_id}`);
    }
    addEvidenceErrors(bundleErrors, bundle.evidence_references, bundle.bundle_id);
  }
  check('bundles:count_and_coherence', bundles.length === EXPECTED_COUNTS.response_type_composition.multi_source_bundle && bundleErrors.length === 0, bundleErrors.length === 0 ? `${bundles.length} coherent multi-source bundle records; no join_proven assertion.` : bundleErrors.slice(0, 10).join('; '));
  check('bundles:join_status_vocab', bundles.every(item => JOIN_STATUSES.includes(item.join_status)), 'All bundle join statuses use the controlled vocabulary.');
  check('bundles:provenance_gate', bundles.every(item => item.actual_join_proven === false && item.join_status !== 'join_proven'), 'No bundle claims join_proven or actual join proof.');

  const reviewErrors = [];
  for (const item of reviewQueue) {
    if (!item.question_ids.every(id => questionById.has(id))) reviewErrors.push(`${item.review_id}: unknown question ID`);
    if (!item.source_record_ids.every(id => sourceById.has(id))) reviewErrors.push(`${item.review_id}: unknown source record ID`);
    addEvidenceErrors(reviewErrors, item.evidence_references, item.review_id);
  }
  check('review:open_queue', reviewQueue.length >= 1 && reviewErrors.length === 0 && reviewQueue.every(item => item.status === 'open'), reviewErrors.length === 0 ? `${reviewQueue.length} open human-review items resolve to current records.` : reviewErrors.join('; '));

  const metrics = records.metrics ?? {};
  check('metrics:required_groups', ['retrieval', 'constraint_handling', 'bundle_quality', 'explanation_and_trust', 'abstention'].every(key => Array.isArray(metrics[key]) && metrics[key].length > 0), 'All required evaluation metric groups are present.');
  check('metrics:required_names', ['Recall@k', 'Precision@k', 'MRR', 'nDCG@k', 'Essential-source recall', 'Near-miss rejection'].every(name => metrics.retrieval?.some(metric => metric.name === name)), 'Required retrieval metrics are explicitly specified.');
  check('metrics:specification_only', metrics.status === 'specification_only' && metrics.external_requests === 0, 'Metrics are specification-only and offline.');

  const statistics = records.statistics ?? {};
  check('statistics:reconcile', statistics.question_count === questions.length && sameJson(statistics.question_composition, geographyCounts) && sameJson(statistics.response_type_composition, typeCounts) && sameJson(statistics.split_counts, splitCounts) && statistics.bundle_counts?.records === bundles.length && statistics.human_review_count === reviewQueue.length, 'benchmark_statistics.json reconciles to generated artifacts.');
  check('statistics:seed_coverage', Object.values(statistics.seed_coverage ?? {}).every(item => item.matched === true), 'All required seed questions are represented.');
  check('statistics:external_requests', statistics.external_requests === 0, 'benchmark_statistics.json records external_requests=0.');

  const invalidFixtureExpectations = [
    ['fixtures/invalid/question.missing-access.json', 'question.schema.json', true],
    ['fixtures/invalid/relevance.no-evidence.json', 'relevance-judgment.schema.json', true],
    ['fixtures/invalid/bundle.unknown-join-status.json', 'bundle-gold.schema.json', true],
    ['fixtures/invalid/negative.recommended.json', 'negative-judgment.schema.json', true],
    ['fixtures/invalid/answer-plan.confident-unsupported.json', 'answer-plan.schema.json', false]
  ];
  const invalidFixtureErrors = [];
  for (const [fixturePath, schemaName, shapeMustFail] of invalidFixtureExpectations) {
    try {
      const fixture = await readJson(fixturePath);
      const shapeErrors = validateRecordShape(fixture, schemas[schemaName]);
      if (shapeMustFail && shapeErrors.length === 0) invalidFixtureErrors.push(`${fixturePath}: expected schema failure`);
      if (!shapeMustFail && (shapeErrors.length > 0 || !fixture.recommendation?.source_record_ids?.includes('fake'))) invalidFixtureErrors.push(`${fixturePath}: expected semantic confident-unsupported failure`);
    } catch (error) { invalidFixtureErrors.push(`${fixturePath}: ${error.message}`); }
  }
  check('fixtures:valid_invalid', invalidFixtureErrors.length === 0, invalidFixtureErrors.length === 0 ? 'Valid fixtures pass shape checks and invalid fixtures fail their intended checks.' : invalidFixtureErrors.join('; '));

  const packageManifest = records.manifest ?? {};
  const manifestErrors = [];
  if (packageManifest.external_requests !== 0 || packageManifest.offline !== true || packageManifest.identity_merge_performed !== false || packageManifest.retrieval_engine_implemented !== false) manifestErrors.push('package manifest prohibited-action flags are not fail-closed');
  const computedFiles = await listPackageFiles();
  const manifestFiles = (packageManifest.files ?? []).map(item => normalizePath(item.path)).sort();
  if (!sameJson(computedFiles, manifestFiles)) manifestErrors.push(`manifest file list mismatch; computed ${computedFiles.length}, recorded ${manifestFiles.length}`);
  let computedBytes = 0;
  for (const relative of computedFiles) {
    const digest = await hashPackageFile(relative);
    computedBytes += digest.bytes;
    const recorded = (packageManifest.files ?? []).find(item => normalizePath(item.path) === relative);
    if (!recorded || recorded.bytes !== digest.bytes || recorded.sha256 !== digest.sha256) manifestErrors.push(`${relative}: manifest hash/byte mismatch`);
  }
  if (packageManifest.file_count !== computedFiles.length || packageManifest.payload_bytes !== computedBytes) manifestErrors.push('manifest file_count/payload_bytes mismatch');
  for (const pin of packageManifest.source_pins ?? []) {
    try {
      const digest = await hashProjectFile(pin.artifact_path);
      if (digest.bytes !== pin.bytes || digest.sha256 !== pin.sha256) manifestErrors.push(`${pin.artifact_path}: source pin hash mismatch`);
    } catch (error) { manifestErrors.push(`${pin.artifact_path}: ${error.message}`); }
  }
  check('manifest:reconciliation', manifestErrors.length === 0, manifestErrors.length === 0 ? `${computedFiles.length} payload files and ${packageManifest.source_pins?.length ?? 0} source pins match recorded hashes.` : manifestErrors.slice(0, 10).join('; '));

  const packageSourceFiles = (await listPackageFiles()).filter(file => file.endsWith('.mjs'));
  const prohibitedCodePatterns = [/\bfetch\s*\(/i, /https?:\/\/(?!json-schema\.org)/i, /\baxios\b/i, /\bhttps?\.request\b/i, /\bchild_process\b/i, /\bspawn\s*\(/i];
  const codeMatches = [];
  for (const file of packageSourceFiles) {
    const text = await fs.readFile(packageAbsolute(file), 'utf8');
    if (prohibitedCodePatterns.some(pattern => pattern.test(text))) codeMatches.push(file);
  }
  check('controls:no_retrieval_engine_or_network', codeMatches.length === 0 && packageManifest.retrieval_engine_implemented === false, codeMatches.length === 0 ? 'Package code contains no retrieval/network implementation.' : `Potential retrieval/network code in ${codeMatches.join(', ')}`);
  check('controls:offline_attestation', packageManifest.external_requests === 0 && records.metrics?.external_requests === 0 && records.splits?.external_requests === 0 && records.statistics?.external_requests === 0 && sourceIndex.external_requests === 0, 'All package-level external request counters are zero.');
  check('controls:identity_and_full_data', packageManifest.identity_merge_performed === false && statistics.prohibited_action_attestation?.identity_merge_performed === false && statistics.prohibited_action_attestation?.full_data_job_executed === false && statistics.prohibited_action_attestation?.heavy_analysis_lock_acquired === false, 'No identity merge, full-data job, or heavy-analysis lock is attested.');

  const report = {
    $schema: './schemas/validation-report.schema.json',
    validation_version: 'question-to-data-validation.v1',
    benchmark_package: 'ushso-question-to-data-v0.1.0',
    generated_at: FIXED_TIME,
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    external_requests: 0,
    checks,
    summary: {
      question_count: questions.length,
      positive_judgment_count: relevance.length,
      negative_judgment_count: negatives.length,
      bundle_count: bundles.length,
      answer_plan_count: plans.length,
      human_review_count: reviewQueue.length,
      passed_checks: checks.filter(item => item.status === 'PASS').length,
      failed_checks: checks.filter(item => item.status === 'FAIL').length,
      issue_count: issues.length
    },
    manifest_reconciliation: {
      computed_file_count: computedFiles.length,
      recorded_file_count: packageManifest.file_count ?? null,
      computed_payload_bytes: computedBytes,
      recorded_payload_bytes: packageManifest.payload_bytes ?? null,
      hashes_match: manifestErrors.length === 0
    },
    prohibited_action_attestation: {
      external_requests: 0,
      retrieval_engine_implemented: false,
      identity_merge_performed: false,
      full_data_job_executed: false,
      heavy_analysis_lock_acquired: false,
      source_records_mutated: false,
      statement: 'Offline benchmark construction and validation only; no retrieval, acquisition, identity merge, or full-data analysis was executed.'
    }
  };
  if (writeReport) {
    const target = packageAbsolute('validation_report.json');
    const partial = `${target}.partial`;
    await fs.writeFile(partial, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await fs.rename(partial, target);
  }
  return { ok: issues.length === 0, issues, checks, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runValidation({ writeReport: true }).then(result => {
    process.stdout.write(`${JSON.stringify({ ok: result.ok, status: result.report.status, issues: result.issues.length, external_requests: 0 }, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  }).catch(error => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
