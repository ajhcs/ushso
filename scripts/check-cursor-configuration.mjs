import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function inspectCursorConfiguration(env) {
  const key = env.USHSO_CURSOR_SIGNING_KEY;
  if (key === undefined) return { ready: false, state: 'missing', binding: 'USHSO_CURSOR_SIGNING_KEY', value_disclosed: false, reason: 'Absent binding uses instance-local cursors; persistent pagination is not provisioned.' };
  if (typeof key !== 'string' || Buffer.byteLength(key) < 32 || Buffer.byteLength(key) > 1024) return { ready: false, state: 'invalid', binding: 'USHSO_CURSOR_SIGNING_KEY', value_disclosed: false, reason: 'Dedicated binding must contain 32–1024 UTF-8 bytes.' };
  return { ready: true, state: 'configured', binding: 'USHSO_CURSOR_SIGNING_KEY', value_disclosed: false, scope: 'Local supplied environment only; does not verify a remote deployment.', rotation: 'Changing the key invalidates existing cursors; clients must restart traversal.' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectCursorConfiguration(process.env); console.log(JSON.stringify(result)); if (!result.ready) process.exitCode = 1;
}
