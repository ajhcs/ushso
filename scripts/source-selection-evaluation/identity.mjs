import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
/** Pin the actual local module dependency closure, not just the factory file. */
export async function executionIdentity() {
  const visited = new Map();
  async function visit(file) {
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(root + path.sep)) throw new Error('MODULE_OUTSIDE_ROOT');
    if (visited.has(file)) return;
    const bytes = await readFile(absolute);
    visited.set(file, sha(bytes));
    if (!/\.[cm]?js$/.test(file)) return;
    const source = bytes.toString('utf8');
    const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]/g)];
    for (const match of imports) await visit(path.relative(root, path.resolve(path.dirname(absolute), match[1])));
  }
  await visit('worker/index.mjs');
  for (const f of ['scripts/source-selection-evaluation/execute.mjs','scripts/source-selection-evaluation/identity.mjs']) await visit(f);
  const modules = Object.fromEntries([...visited].sort(([a],[b])=>a.localeCompare(b)));
  return { source_commit: execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    source_graph_sha256: sha(JSON.stringify(modules)), modules,
    lockfile_sha256: sha(await readFile(path.join(root,'package-lock.json'))), node_version: process.version };
}
