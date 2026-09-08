// Local artifact preparation only. Existing output directories are rejected.
  // Hash the full bundled source graph, not a hand-selected tokenizer file list.
  // Re-read corpus inputs to catch a publisher/staging update during generation.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function buildIndexedWorker({ assetsDirectory, outputDirectory }) {
  const assets = path.resolve(assetsDirectory), out = path.resolve(outputDirectory);
  const base = path.join(assets, "corpus-v1.2.0"), corpusBytes = await fs.readFile(path.join(base, "corpus/corpus.json"));
  const corpus = JSON.parse(corpusBytes);
  if (!Array.isArray(corpus.record_files) || corpus.record_files.length > 1e3 || corpus.record_files.some((f) => !/^[-a-zA-Z0-9._]+\.jsonl$/.test(f))) throw Error("LEXICAL_BUILD_SHARDS_INVALID");
  const shards = await Promise.all(corpus.record_files.map((f) => fs.readFile(path.join(base, "corpus", f))));
  const vocabulary = await fs.readFile(path.join(base, "fixtures/controlled-vocabulary.json"));
  const records = shards.flatMap((b) => b.toString("utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse));
  if (records.length !== corpus.record_count) throw Error("LEXICAL_BUILD_RECORD_COUNT");
  const options = { absWorkingDir: root, entryPoints: ["worker/index.mjs"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", keepNames: true, metafile: true, outfile: "index.js" };
  const control = await build({ ...options, define: { USHSO_LEXICAL_BUILD_PIN: "null" } });
  const physicalInputs = (result) => Object.keys(result.metafile.inputs).filter((name) => !name.startsWith("<define:")).sort();
  const inputNames = physicalInputs(control);
  const sourceInventory = async () => Promise.all(inputNames.map(async (relative) => ({ path: relative, sha256: sha(await fs.readFile(path.resolve(root, relative))) })));
  const sources = await sourceInventory();
  const { buildLexicalEntries } = await import("../packages/retrieval/tools/retrieval-core-v1.2.mjs");
  const { validateCatalogRecords } = await import("../packages/retrieval/tools/catalog-contract.mjs");
  const validation = validateCatalogRecords(records);
  if (typeof corpus.publication?.generation !== "string" || !corpus.publication.generation) throw Error("LEXICAL_BUILD_PUBLICATION_GENERATION_REQUIRED");
  const identity = { generation: corpus.publication.generation, corpus_sha256: sha(corpusBytes), source_sha256: sha(Buffer.concat(shards)), vocabulary_sha256: sha(vocabulary), tokenizer_sha256: sha(JSON.stringify(sources)) };
  const bytes = Buffer.from(JSON.stringify({ format: "ushso.lexical-index.v1", ...identity, entries: buildLexicalEntries(validation.valid) }));
  if (bytes.length > 8 * 1024 * 1024) throw Error("LEXICAL_BUILD_SIZE");
  const pin = { ...identity, artifact_sha256: sha(bytes) };
  const candidate = await build({ ...options, define: { USHSO_LEXICAL_BUILD_PIN: JSON.stringify(pin) } });
  if (JSON.stringify(physicalInputs(candidate)) !== JSON.stringify(inputNames) || JSON.stringify(await sourceInventory()) !== JSON.stringify(sources)) throw Error("LEXICAL_BUILD_SOURCE_CHANGED");
  if (!corpusBytes.equals(await fs.readFile(path.join(base, "corpus/corpus.json"))) || !vocabulary.equals(await fs.readFile(path.join(base, "fixtures/controlled-vocabulary.json")))) throw Error("LEXICAL_BUILD_DATA_CHANGED");
  for (let i = 0; i < shards.length; i++) if (!shards[i].equals(await fs.readFile(path.join(base, "corpus", corpus.record_files[i])))) throw Error("LEXICAL_BUILD_DATA_CHANGED");
  await fs.mkdir(out);
  await fs.mkdir(path.join(out, "assets/corpus-v1.2.0/corpus"), { recursive: true });
  await fs.writeFile(path.join(out, "assets/corpus-v1.2.0/corpus/lexical-index.json"), bytes, { flag: "wx" });
  const worker = candidate.outputFiles.find((f) => f.path.endsWith("index.js")).contents;
  await fs.writeFile(path.join(out, "index.js"), worker, { flag: "wx" });
  const receipt = { format: "ushso.indexed-worker-build.v1", pin, worker_sha256: sha(worker), index_bytes: bytes.length, records: records.length, accepted_records: validation.valid.length, isolated_records: validation.invalid.length, sources, source_assets: assets, scope: "Partial output: index and Worker only. Compose with the exact source assets and inventory all files before qualification." };
  await fs.writeFile(path.join(out, "build-identity.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  return receipt;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [assetsDirectory, outputDirectory] = process.argv.slice(2);
  if (!assetsDirectory || !outputDirectory) throw Error("usage: node scripts/build-indexed-worker.mjs EXACT_ASSETS_DIRECTORY NEW_OUTPUT_DIRECTORY");
  console.log(JSON.stringify(await buildIndexedWorker({ assetsDirectory, outputDirectory })));
}
export {
  buildIndexedWorker
};
