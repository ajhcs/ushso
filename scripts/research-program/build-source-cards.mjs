#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { buildSourceCard } from '../../packages/enrichment/source-card.mjs';
import { LAST_GOOD_GENERATION } from './ingest-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CORPUS_REL = 'packages/retrieval/versions/v1.2.0/corpus';
const HEAD = 'da3b5e44e2a79e1a39ea414e35808d54313a399c';

function sha256File(abs) {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

async function indexCorpus(repoRoot) {
  const corpus = JSON.parse(readFileSync(path.join(repoRoot, CORPUS_REL, 'corpus.json'), 'utf8'));
  const index = new Map();
  for (const rel of corpus.record_files) {
    const fileRel = `${CORPUS_REL}/${rel}`;
    const abs = path.join(repoRoot, fileRel);
    const fileSha = sha256File(abs);
    const rl = readline.createInterface({ input: createReadStream(abs, { encoding: 'utf8' }), crlfDelay: Infinity });
    let line = 0;
    for await (const text of rl) {
      line += 1;
      if (!text.trim()) continue;
      const rec = JSON.parse(text);
      index.set(rec.record_id, { fileRel, line, fileSha, rec });
    }
  }
  return index;
}

function catalogCardInput(product, hit) {
  const rec = hit.rec;
  const evidence = Array.isArray(rec.evidence) ? rec.evidence[0] : null;
  const access = rec.access ?? {};
  const retrieval = rec.retrieval ?? {};
  const steps = (retrieval.instructions ?? []).map((step, index) => ({
    sequence: step.sequence ?? index + 1,
    instruction: step.instruction,
    tested: false,
    executed: false,
    requires_human: step.requires_human === true,
    url: step.url ?? rec.authoritative_url ?? null,
  }));
  const claims = evidence?.claim
    ? [{
      text: evidence.claim,
      evidence_ids: [evidence.evidence_id].filter(Boolean),
      publisher_passage: evidence.claim,
    }]
    : [];
  return {
    source_id: product.product_key,
    purpose: product.title,
    coverage: product.rationale ?? rec.description ?? null,
    grain: null,
    example_variables: [],
    access_steps: steps,
    tested_state: 'catalog_metadata_only',
    limits: [
      access.restriction_note ?? 'Dataset contents, authorization, and payload retrieval were not executed.',
      'Catalog membership is not payload access.',
      'Generic unit_of_analysis tags are not a research grain.',
      ...(evidence?.limitations ?? []),
    ],
    citation: rec.authoritative_url ?? product.anchor?.representative?.authoritative_url ?? null,
    documented_use: [],
    reviewed_recommendation: [],
    unsupported_use: ['Payload analysis from catalog metadata alone'],
    claims,
    release_id: rec.record_id,
    schema_id: rec.schema_version ?? null,
    example_ids: [],
    unknowns: ['payload schema', 'example variables', 'research grain', 'bounded sample'],
  };
}

function intakeCardInput(product) {
  const intake = product.anchor?.intake ?? {};
  return {
    source_id: product.product_key,
    purpose: product.title,
    coverage: null,
    grain: null,
    example_variables: [],
    access_steps: intake.locator
      ? [{ sequence: 1, instruction: `Locator recorded as ${intake.locator_kind ?? 'unverified'}: ${intake.locator}`, tested: false }]
      : [],
    tested_state: 'named_intake_unverified_locator',
    limits: [
      'Named intake only. Locator is unverified.',
      'Catalog membership is not payload access.',
    ],
    citation: intake.locator ?? null,
    documented_use: [],
    reviewed_recommendation: [],
    unsupported_use: ['Any payload or join use before verified intake'],
    claims: [],
    example_ids: [],
    unknowns: ['catalog record', 'payload schema', 'example variables', 'research grain', 'access route'],
  };
}

export async function buildCatalogSourceCards({ repoRoot = ROOT } = {}) {
  const index = await indexCorpus(repoRoot);
  const cohorts = JSON.parse(readFileSync(path.join(repoRoot, 'evaluation/research-program/cohorts.json'), 'utf8'));
  const cards = [];
  for (const product of cohorts.products) {
    const rid = product.anchor?.representative?.record_id ?? null;
    const status = product.anchor?.status;
    let input;
    let evidenceReference = null;
    let evidenceSha256 = null;
    if (status === 'resolved_catalog_record' && rid && index.has(rid)) {
      const hit = index.get(rid);
      input = catalogCardInput(product, hit);
      evidenceReference = hit.fileRel;
      evidenceSha256 = hit.fileSha;
    } else {
      input = intakeCardInput(product);
    }
    const card = buildSourceCard(input);
    cards.push({
      product_key: product.product_key,
      access_expectation: product.access_expectation,
      anchor_status: status ?? null,
      evidence_reference: evidenceReference,
      evidence_sha256: evidenceSha256,
      candidate_head: HEAD,
      generation: LAST_GOOD_GENERATION,
      card,
    });
  }
  return cards;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cards = await buildCatalogSourceCards();
  const dir = path.join(ROOT, 'verification/research-program/evidence');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'source-cards.jsonl'), `${cards.map((row) => JSON.stringify(row)).join('\n')}\n`);
  const summary = {
    format: 'ushso.source-card-summary.v1',
    generation: LAST_GOOD_GENERATION,
    candidate_head: HEAD,
    product_count: cards.length,
    incomplete: cards.filter((row) => row.card.incomplete).length,
    research_ready: cards.filter((row) => row.card.status === 'research_ready').length,
    missing_grain: cards.filter((row) => row.card.missing_essential.includes('grain')).length,
    missing_example_variables: cards.filter((row) => row.card.missing_essential.includes('example_variables')).length,
    named_intake: cards.filter((row) => row.anchor_status === 'named_intake').length,
    catalog_metadata_only: true,
    payload_samples: 0,
    note: 'Incomplete catalog-metadata cards. Grain and example variables are not inferred from generic tags. Not R04 acceptance.',
  };
  writeFileSync(path.join(dir, 'source-card-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
