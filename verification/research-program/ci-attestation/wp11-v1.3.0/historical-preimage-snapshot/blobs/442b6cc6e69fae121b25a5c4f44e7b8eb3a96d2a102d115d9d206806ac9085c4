import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTechnicalEvidence } from './technical-evidence.mjs';
import { runSuccessorCli } from '../../../successor-support.mjs';
export const packageId = '@ushso/wp11-verification-v1.3.0@1.3.0';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSuccessorCli({ packageId, packageRoot: fileURLToPath(new URL('../', import.meta.url)), buildTechnicalEvidence })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
