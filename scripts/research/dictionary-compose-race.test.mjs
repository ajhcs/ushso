import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {composeDictionaryPackages} from './dictionary-package-closure.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const scratch = [process.env.TMPDIR, process.env.RUNNER_TEMP].find((v) => typeof v === 'string' && path.isAbsolute(v) && path.resolve(v) !== '/');

test('compose manifest creation must fail if another writer wins after mkdir', async () => {
  assert.ok(scratch, 'TMPDIR or RUNNER_TEMP scratch required');
  const root = await fs.mkdtemp(path.join(scratch, 'compose-race-'));
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
      evidence: [{evidence_id: 'e', provenance_ids: ['p']}],
      provenance: [{provenance_id: 'p', locator: 'https://example.test', content_sha256: 'c'.repeat(64)}],
      limitations: ['Synthetic fixture pending review.'], isolated_fields: [],
      publication_authorized: false, review_status: 'pending_owner_review',
      schema_applicability: 'unresolved', variable_count: 1,
      pages: [{sha256: pageSha, count: 1, bytes: Buffer.byteLength(rows)}]};
    const descriptorBytes = JSON.stringify(descriptor);
    const descriptorFile = 'records/' + hash('record-a') + '.json';
    await fs.writeFile(path.join(input, descriptorFile), descriptorBytes);
    await fs.writeFile(path.join(input, 'manifest.json'), JSON.stringify({
      format: 'ushso.dictionary-review-package.v1', generation: 'g', review_status: 'pending_owner_review',
      publication_authorized: false, canonical_records_changed: 0,
      records: [{record_id: 'record-a', file: descriptorFile, sha256: hash(descriptorBytes), variables: 1}],
      variables: 1, pages: 1, maximum_page_bytes: Buffer.byteLength(rows),
    }));

    const output = path.join(root, 'output');
    const realWriteFile = fs.writeFile;
    let injected = false;
    fs.writeFile = async (file, data, options) => {
      if (!injected && file === path.join(output, 'manifest.json')) {
        injected = true;
        await realWriteFile(file, 'attacker', {flag: 'wx'});
      }
      return realWriteFile(file, data, options);
    };
    try {
      await assert.rejects(composeDictionaryPackages({inputs: [input], output}), {code: 'EEXIST'});
    } finally {
      fs.writeFile = realWriteFile;
    }
    assert.equal(injected, true);
    assert.equal(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'), 'attacker');
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});
