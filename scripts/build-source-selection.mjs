import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { stagePublication } from './release-source-selection/stage-publication.mjs';

// No environment setting is an explicit unavailable publication, never a
// promotion of the candidate inventory or a previous build's accepted facts.
const assetsDirectory = resolve('apps/web/dist');
const ledgerRoot = process.env.USHSO_SOURCE_SELECTION_LEDGER;
if (ledgerRoot) {
  console.log(JSON.stringify(await stagePublication({ ledgerRoot, assetsDirectory })));
} else {
  const directory = join(assetsDirectory, 'source-selection');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'publication.json'), JSON.stringify({
    status: 'unavailable', reason: 'accepted_publication_not_configured',
  }) + '\n');
  console.log('Source-selection publication unavailable: no accepted ledger configured.');
}
