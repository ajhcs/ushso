
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { buildLexicalEntries, createRetrievalEngine } from "../packages/retrieval/tools/retrieval-core-v1.2.mjs";
import { loadLexicalArtifact, consumeLexicalArtifact } from "../packages/retrieval/tools/lexical-artifact.mjs";
import { loadCatalogFromAssets } from "../worker/index.mjs";
import { buildIndexedWorker } from "../scripts/build-indexed-worker.mjs";
const fixture = JSON.parse(await fs.readFile(new URL("./fixtures/direct-base-input.json", import.meta.url)));
const sha = (b) => createHash("sha256").update(b).digest("hex");
function setup() {
  const rows = [0, 1, 2].map((i) => ({ ...structuredClone(fixture.record), record_id: fixture.record.record_id + "-" + i, title: "Hospital costs " + i }));
  for (const row of rows) row.identity.asset.asset_id = row.record_id;
  const recordText = rows.map(JSON.stringify).join("\n") + "\n", vocabularyText = JSON.stringify(fixture.vocabulary);
  const corpus = { ...fixture.corpus, publication: { ...fixture.corpus.publication, generation: "lexical-test-publication" }, record_files: ["records.jsonl"], search_document_files: [], record_count: rows.length, search_document_count: 0 };
  const identity = { generation: corpus.publication.generation, corpus_sha256: sha(JSON.stringify(corpus)), source_sha256: sha(recordText), vocabulary_sha256: sha(vocabularyText), tokenizer_sha256: "fixture-source-graph-sha" };
  const value = { format: "ushso.lexical-index.v1", ...identity, entries: buildLexicalEntries(rows) }, bytes = Buffer.from(JSON.stringify(value)), pin = { ...identity, artifact_sha256: sha(bytes) };
  const content = /* @__PURE__ */ new Map([["/corpus-v1.2.0/corpus/corpus.json", JSON.stringify(corpus)], ["/corpus-v1.2.0/corpus/records.jsonl", recordText], ["/corpus-v1.2.0/corpus/join-routes.jsonl", ""], ["/corpus-v1.2.0/fixtures/controlled-vocabulary.json", vocabularyText], ["/corpus-v1.2.0/corpus/lexical-index.json", bytes]]);
  let reads = 0;
  const assets = { async fetch(request2) {
    reads++;
    const data = content.get(new URL(request2.url).pathname);
    return new Response(data ?? "missing", { status: data === void 0 ? 404 : 200 });
  } };
  return { rows, corpus, value, bytes, pin, content, assets, get reads() {
    return reads;
  } };
}
const request = new Request("http://local.test/api/discover");
test("indexed build deterministically pins physical source graph and rejects output overwrite", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ushso-lexical-build-"));
  try {
    const f = setup(), assets = path.join(temporary, "assets");
    for (const [relative, bytes] of f.content) {
      const target = path.join(assets, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
    }
    const a = await buildIndexedWorker({ assetsDirectory: assets, outputDirectory: path.join(temporary, "first") }), b = await buildIndexedWorker({ assetsDirectory: assets, outputDirectory: path.join(temporary, "second") });
    assert.equal(a.worker_sha256, b.worker_sha256);
    assert.equal(a.pin.artifact_sha256, b.pin.artifact_sha256);
    assert.ok(a.sources.some((s) => s.path.endsWith("question-parser-v1.2.mjs")));
    assert.ok(a.sources.some((s) => s.path.endsWith("catalog-contract.mjs")));
    assert.equal(a.pin.tokenizer_sha256, sha(JSON.stringify(a.sources)));
    await assert.rejects(buildIndexedWorker({ assetsDirectory: assets, outputDirectory: path.join(temporary, "first") }), { code: "EEXIST" });
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
test("build-pinned loader reuses concurrent and repeated initialization, rejects changed options", async () => {
  const f = setup(), env = { ASSETS: f.assets };
  const [a, b] = await Promise.all([loadCatalogFromAssets(request, env, { lexicalExpected: f.pin }), loadCatalogFromAssets(request, env, { lexicalExpected: { ...f.pin } })]);
  assert.equal(a, b);
  const reads = f.reads;
  assert.equal(await loadCatalogFromAssets(request, env, { lexicalExpected: f.pin }), a);
  assert.equal(f.reads, reads);
  await assert.rejects(loadCatalogFromAssets(request, env, { lexicalExpected: null }), /LEXICAL_OPTIONS_REQUIRE_FRESH_BINDING/);
  await assert.rejects(loadCatalogFromAssets(request, env, { lexicalExpected: { ...f.pin, tokenizer_sha256: "changed" } }), /LEXICAL_OPTIONS_REQUIRE_FRESH_BINDING/);
  const ordinary = setup();
  await loadCatalogFromAssets(request, { ASSETS: ordinary.assets });
  await assert.rejects(loadCatalogFromAssets(request, { ASSETS: ordinary.assets }, { lexicalExpected: ordinary.pin }), /LEXICAL_OPTIONS_REQUIRE_FRESH_BINDING/);
});
test("missing index remains a typed pinned initialization failure and cannot silently restart", async () => {
  const f = setup();
  f.content.delete("/corpus-v1.2.0/corpus/lexical-index.json");
  const env = { ASSETS: f.assets };
  await assert.rejects(loadCatalogFromAssets(request, env, { lexicalExpected: f.pin }), /LEXICAL_ASSET_UNAVAILABLE/);
  f.content.set("/corpus-v1.2.0/corpus/lexical-index.json", f.bytes);
  const reads = f.reads;
  await assert.rejects(loadCatalogFromAssets(request, env, { lexicalExpected: f.pin }), /LEXICAL_ASSET_UNAVAILABLE/);
  assert.equal(f.reads, reads);
  await assert.rejects(loadCatalogFromAssets(request, env), /LEXICAL_OPTIONS_REQUIRE_FRESH_BINDING/);
});
test("loader checks actual source, publication generation and corpus bytes rather than self-claims", async () => {
  const f = setup();
  f.content.set("/corpus-v1.2.0/corpus/records.jsonl", f.content.get("/corpus-v1.2.0/corpus/records.jsonl").replace("Hospital", "Changed"));
  await assert.rejects(loadCatalogFromAssets(request, { ASSETS: f.assets }, { lexicalExpected: f.pin }), /LEXICAL_LOADER_SOURCE_MISMATCH/);
  const publication = setup(), changed = structuredClone(publication.corpus);
  changed.publication.generation = "different-publication";
  assert.equal(changed.manifest_sha256, publication.corpus.manifest_sha256);
  publication.content.set("/corpus-v1.2.0/corpus/corpus.json", JSON.stringify(changed));
  await assert.rejects(loadCatalogFromAssets(request, { ASSETS: publication.assets }, { lexicalExpected: publication.pin }), /LEXICAL_LOADER_SOURCE_MISMATCH/);
  const metadata = setup(), changedMetadata = { ...metadata.corpus, description: "changed metadata with identical publication and manifest SHA" };
  metadata.content.set("/corpus-v1.2.0/corpus/corpus.json", JSON.stringify(changedMetadata));
  await assert.rejects(loadCatalogFromAssets(request, { ASSETS: metadata.assets }, { lexicalExpected: metadata.pin }), /LEXICAL_LOADER_SOURCE_MISMATCH/);
});
test("bounded verifier rejects malformed identity/hash/structure and forged tokens", async () => {
  const f = setup(), ids = f.rows.map((r) => r.record_id);
  await assert.rejects(loadLexicalArtifact(new Uint8Array(8 * 1024 * 1024 + 1), f.pin, ids), /LEXICAL_SIZE_INVALID/);
  await assert.rejects(loadLexicalArtifact(f.bytes, {}, ids), /LEXICAL_PIN_REQUIRED/);
  await assert.rejects(loadLexicalArtifact(Buffer.from("bad"), f.pin, ids), /LEXICAL_HASH_MISMATCH/);
  for (const key of ["generation", "corpus_sha256", "source_sha256", "vocabulary_sha256", "tokenizer_sha256"]) await assert.rejects(loadLexicalArtifact(f.bytes, { ...f.pin, [key]: "bad" }, ids), /LEXICAL_IDENTITY_MISMATCH/);
  for (const change of [(v) => v.entries.reverse(), (v) => v.entries[0][1][0].weight = 99, (v) => v.entries[0][1][0].text = "x".repeat(512 * 1024 + 1), (v) => v.entries[0][1][0].unexpected = true]) {
    const value = structuredClone(f.value);
    change(value);
    const bytes = Buffer.from(JSON.stringify(value));
    await assert.rejects(loadLexicalArtifact(bytes, { ...f.pin, artifact_sha256: sha(bytes) }, ids), /LEXICAL_(FIELD|RECORD_ORDER)_INVALID/);
  }
  assert.throws(() => consumeLexicalArtifact({}, ids), /LEXICAL_UNVERIFIED/);
});
test("loaded index preserves lexical fixtures, ordering, cursor continuation and immutable input", async () => {
  for (const [title, description, question] of [["Cities counties", "city county", "cities"], ["Boxes churches dishes", "box church dish", "boxes"], ["Caf\xE9 H\xD4SPITAL", "r\xE9sum\xE9 mortality", "cafe hospital"], ["hospital-costs, county/rates", "hospital; cost: rates", "hospital costs"], ["hospital", "cost reports", "hospital cost reports"], ["hospitals hospitals hospital", "costs costs cost", "hospital costs"], ["buses bus business", "businesses analyses analysis", "bus business"]]) {
    const f = setup();
    for (const row of f.rows) {
      row.title = title;
      row.description = description;
    }
    const before = JSON.stringify(f.rows), bytes = Buffer.from(JSON.stringify({ ...f.value, entries: buildLexicalEntries(f.rows) })), token = await loadLexicalArtifact(bytes, { ...f.pin, artifact_sha256: sha(bytes) }, f.rows.map((r) => r.record_id));
    const args = { records: f.rows, searchDocuments: null, vocabulary: fixture.vocabulary, corpus: f.corpus, catalogValidation: { valid: f.rows, invalid: [] } }, a = createRetrievalEngine(args), b = createRetrievalEngine({ ...args, lexicalArtifact: token });
    for (const sort of ["canonical_relevance", "title_asc", "release_newest", "observation_latest"]) {
      let cursor = null;
      do {
        const query = { question, sort, limit: 1, page_size: 1, cursor }, x = a.retrieve(query), y = b.retrieve(query);
        assert.equal(JSON.stringify(x), JSON.stringify(y));
        cursor = x.pagination.next_cursor;
      } while (cursor);
    }
    assert.equal(JSON.stringify(f.rows), before);
    assert.throws(() => createRetrievalEngine({ ...args, searchDocuments: [], lexicalArtifact: token }), /LEXICAL_PROJECTION_MODE_MISMATCH/);
  }
});
