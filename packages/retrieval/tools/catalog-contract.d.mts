export function browserRecordErrors(record: unknown): string[];
export function validateCatalogRecords(records: unknown[]): { valid: unknown[]; invalid: Array<{ index: number; record_id: string | null; code: string; errors: string[] }> };
export function documentedPublicPayload(record: unknown): boolean;
