import { mkdir, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { constants } from 'node:fs';
import { workspacePath } from './restore-release.mjs';
import { readPublished } from '../../packages/source-selection/ledger.mjs';
import { canonical } from '../../packages/source-selection/index.mjs';
export async function stagePublication({ ledgerRoot, assetsDirectory }) {
  const publication = await readPublished(ledgerRoot);
  const target = await workspacePath(join(resolve(assetsDirectory), 'source-selection'));
  await mkdir(target, { recursive: true });
  await workspacePath(target);
  const handle = await open(join(target, 'publication.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(canonical(publication)); await handle.sync(); } finally { await handle.close(); }
  return { status: publication.status, generation_id: publication.generation_id ?? null };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [ledgerRoot, assetsDirectory] = process.argv.slice(2);
  if (!ledgerRoot || !assetsDirectory) throw new Error('usage: stage-publication.mjs LEDGER_ROOT ASSETS_DIRECTORY');
  console.log(JSON.stringify(await stagePublication({ ledgerRoot, assetsDirectory })));
}
