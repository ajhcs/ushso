import { validatorForFile, validationMessage } from './schema.mjs';
import { validateRecordSemantics, validateRecordSet, validateTransition } from './semantics.mjs';

export async function validateIngestionRecord(schemaName, value) {
  const validate = await validatorForFile(schemaName);
  if (!validate(value)) return { valid: false, issues: [{ code: 'SCHEMA_INVALID', pointer: '/', detail: validationMessage(validate) }] };
  const issues = validateRecordSemantics(schemaName, value);
  return { valid: issues.length === 0, issues };
}

export { validateRecordSet, validateTransition };
export {
  CLOUDFLARE_WORKFLOW_INSTANCE_ID_MAX_LENGTH,
  CLOUDFLARE_WORKFLOW_INSTANCE_ID_PATTERN,
  assertCloudflareWorkflowInstanceId,
  isCloudflareWorkflowInstanceId,
  upgradeHarvestRunV10ToV11,
} from './workflow-instance-id.mjs';
