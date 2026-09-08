import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { hash, verifyProposalClaim, documentedEnumeration } from './source-extractors.mjs';
async function readBounded(file, maximum = 64 * 1024 * 1024) {
  if ((await fs.stat(file)).size > maximum) throw Error('EVIDENCE_SIZE_LIMIT');
  return fs.readFile(file, 'utf8');
}
export async function verifyDictionaryProposal(proposal, record, generation, captureDirectory) {
  const diffBytes = await readBounded(proposal.source_diff_file);
  if (hash(diffBytes) !== proposal.source_diff_sha256) throw Error('SOURCE_DIFF_HASH');
  const source = JSON.parse(diffBytes), diff = source.diff.find(d => d.path === '/variable_documentation');
  const { value_in_diff_path, ...claim } = source.claims.find(c => c.field === 'variable_documentation');
  const captures = new Map();
  for (const item of Object.values(source.captures).filter(c => c?.url)) {
    const receipt = JSON.parse(await readBounded(path.join(captureDirectory, hash(item.url) + '.json')));
    if (receipt.url !== item.url) throw Error('CAPTURE_URL_IDENTITY');
    if (receipt.sha256) {
      if (!/^[a-f0-9]{64}$/.test(receipt.sha256)) throw Error('CAPTURE_HASH_FORMAT');
      receipt.text = await readBounded(path.join(captureDirectory, receipt.sha256 + '.body'));
      if (hash(receipt.text) !== receipt.sha256) throw Error('CAPTURE_HASH');
      try { receipt.data = JSON.parse(receipt.text); } catch { receipt.status = 'captured_non_json'; }
    }
    captures.set(item.url, receipt);
  }
  const verified = verifyProposalClaim(claim, diff, captures, record, generation), e = verified.evidence;
  if (!isDeepStrictEqual(e, proposal.source_evidence)) throw Error('SOURCE_EVIDENCE_BINDING');
  const id = 'evidence:dictionary:' + hash(JSON.stringify(e)).slice(0, 24), pid = 'provenance:dictionary:' + e.capture_sha256.slice(0, 24);
  const limitations = [diff.scope, 'Pending owner scientific review. Captured publisher dictionary, not executed payload schema, release continuity, join compatibility, free access or fitness certification.', 'Measurement units and allowed values are unresolved unless literally documented; none inferred from names.'];
  const provenance = [{ provenance_id: pid, kind: 'catalog_metadata', locator: e.url, observed_at: e.observed_at, capture_state: 'captured_hashed', content_sha256: e.capture_sha256 }];
  if (e.parent) provenance.push({ provenance_id: 'provenance:dictionary-parent:' + e.parent.capture_sha256.slice(0, 24), kind: 'catalog_metadata', locator: e.parent.url, observed_at: captures.get(e.parent.url).captured_at, capture_state: 'captured_hashed', content_sha256: e.parent.capture_sha256 });
  const evidence = [{ evidence_id: id, claim: 'The captured publisher documentation contains these named variable entries at ' + e.pointer + '.', state: 'verified_first_party', provenance_ids: provenance.map(p => p.provenance_id), limitations }];
  const variables = diff.after.map(v => {
    const raw = record.identity.source.source_id === 'census-api' ? captures.get(e.url).data.variables[v.name]?.values?.item : null;
    const labels = documentedEnumeration(raw)?.labels ?? null;
    return { ...v, description: v.concept_is_not_variable_definition ? '' : v.description, publisher_concept: v.concept_is_not_variable_definition ? v.description : null,
      allowed_values: labels ? Object.keys(labels) : v.allowed_values, publisher_value_labels: labels,
      publisher_value_labels_evidence: labels ? { url: e.url, capture_sha256: e.capture_sha256, pointer: e.pointer + '/' + v.name.replace(/~/g, '~0').replace(/\//g, '~1') + '/values/item', raw_value_sha256: hash(JSON.stringify(labels)) } : null,
      evidence_ids: [id], evidence_state: 'verified_first_party' };
  });
  const dictionary = { status: 'partial', summary: 'Publisher dictionary entries captured; scientific review pending.', variable_count: variables.length, variables, evidence_ids: [id], limitations, evidence_state: 'verified_first_party', codebook: { title: 'Captured publisher variable documentation', url: e.url } };
  const actualDictionary = proposal.changes.filter(c => c.path === '/variable_documentation');
  if (actualDictionary.length !== 1 || !isDeepStrictEqual(actualDictionary[0].after, dictionary)
    || !isDeepStrictEqual(proposal.changes.filter(c => c.path === '/provenance/-').map(c => c.after), provenance)
    || !isDeepStrictEqual(proposal.changes.filter(c => c.path === '/evidence/-').map(c => c.after), evidence)) throw Error('UNSUPPORTED_DICTIONARY_PROPOSAL');
  return { evidence, provenance, limitations, evidence_ids: [id], dictionary_scope: diff.scope };
}
