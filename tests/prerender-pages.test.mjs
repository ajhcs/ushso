import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prerenderPublicPages } from '../scripts/prerender-public-pages.mjs';
import { inventoryPage, renderInitialPage } from '../packages/web-discoverability/src/initial-pages.mjs';
const shell = '<!doctype html><html><head><title>Old</title><meta name="description" content="Old"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';
const record = { record_id: 'obs:asset:fixture', title: 'Title <img src=x onerror=alert(1)>', description: 'Captured <script>alert(1)</script> metadata', evidence: [{ state: 'source_asserted', evidence_id: 'ev:<script>' }, { state: 'inferred', evidence_id: 'do-not-publish' }], access: { status: 'public' }, capabilities: { pending: 'do-not-publish' } };
test('no-JavaScript document retains metadata, explicit unknowns, escaped fields and mount root', () => {
  const html = renderInitialPage(inventoryPage(record), { shell });
  assert.match(html, /<noscript><main/);
  assert.match(html, /Captured &lt;script&gt;/);
  assert.match(html, /ev:&lt;script&gt;/);
  assert.match(html, /Access and authorization<\/dt><dd>Unresolved/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /href="https:\/\/ushso.org\/datasets\/obs%3Aasset%3Afixture"/);
  assert.doesNotMatch(html, /<img|<script>alert|do-not-publish|schema.org\/Dataset/);
});
test('malicious IDs cannot become files or canonical paths; origin rejects unsafe hosts', () => {
  for (const id of ['../escape', '/absolute', 'x%2fy', 'x?query', 'x#hash', 'x\\y', '<script>']) assert.throws(() => inventoryPage({ ...record, record_id: id }));
  assert.throws(() => renderInitialPage(inventoryPage(record), { shell, origin: 'https://ushso.org@evil.test/path' }));
  const inferred = inventoryPage({ ...record, evidence: [{ state: 'inferred', evidence_id: 'infer' }] });
  assert.doesNotMatch(inferred.body, /Captured/);
});
test('build produces inspectable per-source HTML, exact sitemap and bounded routing manifest', async () => {
  const base = os.tmpdir();
  await fs.mkdir(base, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(base, 'prerender-test-'));
  try {
    const dist = path.join(temporary, 'dist'); const corpusDirectory = path.join(temporary, 'corpus');
    await fs.mkdir(dist); await fs.mkdir(corpusDirectory);
    await fs.writeFile(path.join(dist, 'index.html'), shell);
    await fs.writeFile(path.join(corpusDirectory, 'corpus.json'), JSON.stringify({ record_files: ['records.jsonl'], publication: { generation: 'legacy-only' } }));
    await fs.writeFile(path.join(corpusDirectory, 'records.jsonl'), JSON.stringify(record));
    const manifest = await prerenderPublicPages({ dist, corpusDirectory });
    assert.equal(manifest.accepted_generation_id, null);
    assert.equal(manifest.page_count, 5);
    for (const route of manifest.routes) {
      const html = await fs.readFile(path.join(dist, route.file), 'utf8');
      assert.match(html, /<h1>/); assert.match(html, /Accepted generation: unavailable/);
      assert.match(html, /<meta property="og:url"/);
    }
    assert.match(await fs.readFile(path.join(dist, '404.html'), 'utf8'), /noindex/);
    const sitemap = await fs.readFile(path.join(dist, 'sitemap.xml'), 'utf8');
    assert.equal((sitemap.match(/<loc>/g) ?? []).length, manifest.routes.length);
    assert.doesNotMatch(sitemap, /search|private|review/);
    assert.equal(manifest.routes.some(route => route.path.includes('unknown')), false);
    await assert.rejects(prerenderPublicPages({ dist, corpusDirectory, origin: 'https://www.ushso.org' }), /CANONICAL/);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
