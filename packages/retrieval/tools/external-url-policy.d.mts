export const MAX_EXTERNAL_URL_LENGTH: number;
export function safeExternalHttpsUrl(value: unknown): string | null;
export function safePreservedHttpUrl(value: unknown): string | null;
export function isSafeEvidenceLocator(value: unknown): value is string;
