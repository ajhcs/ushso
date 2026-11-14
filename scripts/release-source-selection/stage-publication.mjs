import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPublished } from '../../packages/source-selection/ledger.mjs';
import { canonical } from '../../packages/source-selection/index.mjs';
export async function stagePublication({ ledgerRoot, assetsDirectory }) {
  const publication = await readPublished(ledgerRoot);
  const target = join(resolve(assetsDirectory), 'source-selection');
  if (!target.startsWith('/workspace/')) throw new Error('WORKSPACE_OUTPUT_REQUIRED');
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'publication.json'), canonical(publication));
  return { status: publication.status, generation_id: publication.generation_id ?? null };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [ledgerRoot, assetsDirectory] = process.argv.slice(2);
  if (!ledgerRoot || !assetsDirectory) throw new Error('usage: stage-publication.mjs LEDGER_ROOT ASSETS_DIRECTORY');
  console.log(JSON.stringify(await stagePublication({ ledgerRoot, assetsDirectory })));
}
