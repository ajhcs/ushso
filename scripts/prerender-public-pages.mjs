import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { informationPages, inventoryPage, renderInitialPage, renderNotFoundHtml, PUBLIC_PAGE_SCHEMA } from '../packages/web-discoverability/src/initial-pages.mjs';
import { siteOrigin, xmlText } from '../packages/web-discoverability/src/safety.mjs';

export async function prerenderPublicPages({ dist, corpusDirectory, origin = 'https://ushso.org' }) {
  origin = siteOrigin(origin);
  if (origin !== 'https://ushso.org') throw new Error('PUBLIC_CANONICAL_ORIGIN_NOT_APPROVED');
  const shell = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
  const corpus = JSON.parse(await fs.readFile(path.join(corpusDirectory, 'corpus.json'), 'utf8'));
  const records = [];
  for (const filename of corpus.record_files ?? ['records.jsonl']) {
    if (!/^records(?:-[0-9]+)?\.jsonl$/.test(filename)) throw new Error('PUBLIC_CORPUS_PATH_INVALID');
    const lines = (await fs.readFile(path.join(corpusDirectory, filename), 'utf8')).split('\n').filter(Boolean);
    records.push(...lines.map(line => JSON.parse(line)));
  }
  const pages = [...informationPages, ...records.map(inventoryPage)];
  if (new Set(pages.map(page => page.path)).size !== pages.length) throw new Error('PUBLIC_ROUTE_DUPLICATE');
  // Validate and render every input before mutating the built output.
  const legacyGeneration = corpus.publication?.generation ?? null;
  const rendered = pages.map(page => ({ path: page.path, file: page.path === '/' ? '/index.html' : `${page.path}/index.html`, status: 200, html: renderInitialPage(page, { shell, origin, legacyGeneration }) }));
  for (const page of rendered) {
    const destination = path.join(dist, page.file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, page.html);
  }
  await fs.writeFile(path.join(dist, '404.html'), renderNotFoundHtml());
  await fs.writeFile(path.join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map(page => `<url><loc>${xmlText(origin + page.path)}</loc></url>`).join('')}</urlset>\n`);
  const manifest = { schema_version: PUBLIC_PAGE_SCHEMA, mode: 'legacy_inventory_only', accepted_generation_id: null, legacy_generation: legacyGeneration, routes: rendered.map(({ path, file, status }) => ({ path, file, status })), page_count: rendered.length, total_html_bytes: rendered.reduce((sum, page) => sum + Buffer.byteLength(page.html), 0) };
  await fs.writeFile(path.join(dist, 'public-pages.json'), JSON.stringify(manifest));
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await prerenderPublicPages({ dist: path.join(root, 'apps/web/dist'), corpusDirectory: path.join(root, 'packages/retrieval/versions/v1.2.0/corpus') });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', page_count: result.page_count, total_html_bytes: result.total_html_bytes, mode: result.mode })}\n`);
}
