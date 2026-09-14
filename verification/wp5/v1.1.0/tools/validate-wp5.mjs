import { verifyCurrent } from './common.mjs';
process.stdout.write(JSON.stringify(await verifyCurrent(), null, 2) + '\n');
