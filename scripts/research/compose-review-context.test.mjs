import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runComposition} from './compose-dictionary-review.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const scratch = [process.env.TMPDIR, process.env.RUNNER_TEMP].find((v) => typeof v === 'string' && path.isAbsolute(v) && path.resolve(v) !== '/');

test('review context with an empty descriptor evidence array is typed', async () => {
  assert.ok(scratch, 'TMPDIR or RUNNER_TEMP scratch required');
  const root = await fs.mkdtemp(path.join(scratch, 'compose-context-'));
  try {
    const input = path.join(root, 'input');
    await fs.mkdir(path.join(input, 'records'), {recursive: true});
    await fs.mkdir(path.join(input, 'pages'));
    const rows = JSON.stringify([{name: 'field'}]);
    const pageSha = hash(rows);
    await fs.writeFile(path.join(input, 'pages', pageSha + '.json'), rows);
    const descriptor = {format: 'ushso.dictionary-review.v1', record_id: 'record-a', generation: 'g',
      baseline_record_sha256: hash(JSON.stringify({record_id: 'record-a'})),
      source_proposal_sha256: hash(rows), source_evidence: {source: 'synthetic-fixture'},
      publication_authorized: false, review_status: 'pending_owner_review', schema_applicability: 'unresolved',
      variable_count: 1, evidence: [], provenance: [], limitations: [], isolated_fields: [],
      pages: [{sha256: pageSha, count: 1, bytes: Buffer.byteLength(rows)}]};
    const descriptorBytes = JSON.stringify(descriptor);
    const descriptorFile = 'records/' + hash('record-a') + '.json';
    await fs.writeFile(path.join(input, descriptorFile), descriptorBytes);
    const manifestBytes = JSON.stringify({format: 'ushso.dictionary-review-package.v1', generation: 'g',
      review_status: 'pending_owner_review', publication_authorized: false, canonical_records_changed: 0,
      records: [{record_id: 'record-a', file: descriptorFile, sha256: hash(descriptorBytes), variables: 1}],
      variables: 1, pages: 1, maximum_page_bytes: Buffer.byteLength(rows)});
    await fs.writeFile(path.join(input, 'manifest.json'), manifestBytes);
    const sourceBytes = JSON.stringify({variables: [{name: 'field'}]});
    const sourceFile = path.join(root, 'source.json');
    await fs.writeFile(sourceFile, sourceBytes);
    const specFile = path.join(root, 'spec.json');
    await fs.writeFile(specFile, JSON.stringify({format: 'ushso.dictionary-composition-inputs.v1', generation: 'g',
      publication_authorized: false,
      packages: [{directory: input, manifest_sha256: hash(manifestBytes)}],
      expected_fields: [{record_id: 'record-a', file: sourceFile, sha256: hash(sourceBytes), pointer: '/variables', add_review_context: true}]}));
    await assert.rejects(runComposition({specFile, output: path.join(root, 'output')}), /COMPOSITION_REVIEW_CONTEXT/);
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});
