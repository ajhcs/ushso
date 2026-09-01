import { deepFreeze } from './canonical.mjs';

export const CONNECTOR_CONTRACT_VALIDATION_TARGETS = deepFreeze({
  source_descriptor: {
    contract_version: 'ingestion.v1.1.0',
    package_version: 'v1.1.0',
    schema_file: 'source-descriptor.schema.json',
  },
  harvest_plan: {
    contract_version: 'ingestion.v1.0.0',
    package_version: 'v1.0.0',
    schema_file: 'harvest-plan.schema.json',
  },
  checkpoint: {
    contract_version: 'ingestion.v1.0.0',
    package_version: 'v1.0.0',
    schema_file: 'checkpoint.schema.json',
  },
  metadata_fetch: {
    contract_version: 'ingestion.v1.0.0',
    package_version: 'v1.0.0',
    schema_file: 'metadata-fetch.schema.json',
  },
  capture_reference: {
    contract_version: 'ingestion.v1.0.0',
    package_version: 'v1.0.0',
    schema_file: 'capture-reference.schema.json',
  },
});

export function contractValidationTarget(recordKind, contractVersion) {
  const target = CONNECTOR_CONTRACT_VALIDATION_TARGETS[recordKind];
  if (!target || target.contract_version !== contractVersion) {
    throw new TypeError(`Unsupported connector contract pairing: ${recordKind}/${contractVersion}`);
  }
  return structuredClone(target);
}
