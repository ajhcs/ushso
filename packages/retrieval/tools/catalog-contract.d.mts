export function browserRecordErrors(record: unknown, options?: {allowEvidenceBoundMissingDescriptions?: boolean}): string[];
export function validateCatalogRecords(records: unknown[], options?: {allowEvidenceBoundMissingDescriptions?: boolean}): { valid: unknown[]; invalid: Array<{ index: number; record_id: string | null; code: string; errors: string[] }> };
export function documentedPublicPayload(record: unknown): boolean;

export function hasEvidenceBoundMissingDescription(record: unknown): boolean;
