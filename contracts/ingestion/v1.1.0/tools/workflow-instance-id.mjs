import { validateIngestionRecord as validateV10IngestionRecord } from '../../v1.0.0/tools/index.mjs';
import { validationMessage, validatorForFile } from './schema.mjs';
import { validateRecordSemantics } from './semantics.mjs';

const PROVIDER_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/u;

export const CLOUDFLARE_WORKFLOW_INSTANCE_ID_MAX_LENGTH = 100;
export const CLOUDFLARE_WORKFLOW_INSTANCE_ID_PATTERN = '^[A-Za-z0-9_][A-Za-z0-9_-]*$';

export class WorkflowInstanceIdCompatibilityError extends Error {
  constructor(code, detail = null) {
    super(`${code}${detail ? `:${detail}` : ''}`);
    this.name = 'WorkflowInstanceIdCompatibilityError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, detail) {
  throw new WorkflowInstanceIdCompatibilityError(code, detail);
}

export function isCloudflareWorkflowInstanceId(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= CLOUDFLARE_WORKFLOW_INSTANCE_ID_MAX_LENGTH
    && PROVIDER_PATTERN.test(value);
}

export function assertCloudflareWorkflowInstanceId(value) {
  if (!isCloudflareWorkflowInstanceId(value)) fail('WORKFLOW_INSTANCE_ID_PROVIDER_INCOMPATIBLE');
  return value;
}

export async function upgradeHarvestRunV10ToV11(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('HARVEST_RUN_OBJECT_REQUIRED');
  if (value.contract_version !== 'ingestion.v1.0.0') fail('HARVEST_RUN_PREDECESSOR_VERSION_REQUIRED');
  const predecessor = await validateV10IngestionRecord('harvest-run.schema.json', value);
  if (!predecessor.valid) fail('HARVEST_RUN_PREDECESSOR_INVALID', predecessor.issues[0]?.code ?? 'UNKNOWN');
  const expected = `harvest-${value.run_id}-${value.active_attempt}`;
  if (value.workflow?.instance_id !== expected) fail('WORKFLOW_INSTANCE_ID_MISMATCH', expected);
  assertCloudflareWorkflowInstanceId(value.workflow.instance_id);
  const upgraded = structuredClone({ ...value, contract_version: 'ingestion.v1.1.0' });
  const successorSchema = await validatorForFile('harvest-run.schema.json');
  if (!successorSchema(upgraded)) fail('HARVEST_RUN_SUCCESSOR_INVALID', validationMessage(successorSchema));
  const semanticIssues = validateRecordSemantics('harvest-run.schema.json', upgraded);
  if (semanticIssues.length > 0) fail('HARVEST_RUN_SUCCESSOR_INVALID', semanticIssues[0].code);
  return upgraded;
}
