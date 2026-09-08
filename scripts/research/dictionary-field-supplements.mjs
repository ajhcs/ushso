import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const FIELD_STUB_PREVIEW_BYTES = 4 * 1024;
const PREVIEW_KEYS = ['label', 'description', 'unit'];
function copyBoundedPreview(stub, variable) {
  for (const key of PREVIEW_KEYS) {
    if (!Object.hasOwn(variable, key)) continue;
    const value = variable[key];
    if (value === null) {
      stub[key] = null;
      continue;
    }
    if (typeof value !== 'string') continue;
    if (Buffer.byteLength(value, 'utf8') > FIELD_STUB_PREVIEW_BYTES) continue;
    stub[key] = value;
  }
}
export async function packageFieldSupplement(variable, output) {
  const raw = Buffer.from(JSON.stringify(variable));
  if (raw.length > 64 * 1024 * 1024) throw Error('FIELD_SUPPLEMENT_SIZE');
  const fieldSha256 = hash(raw), fragments = [];
  await fs.mkdir(path.join(output, 'supplements'), { recursive: true });
  for (let offset = 0; offset < raw.length; offset += 32768) {
    const chunk = raw.subarray(offset, offset + 32768), fragment = { encoding: 'base64', index: fragments.length, byte_offset: offset, decoded_bytes: chunk.length, data: chunk.toString('base64') };
    const body = JSON.stringify(fragment) + '\n', sha256 = hash(body);
    if (Buffer.byteLength(body) > 65536) throw Error('FIELD_FRAGMENT_SIZE');
    await fs.writeFile(path.join(output, 'supplements', sha256 + '.json'), body);
    fragments.push({ sha256, bytes: Buffer.byteLength(body), decoded_bytes: chunk.length });
  }
  const descriptor = { format: 'ushso.dictionary-field-supplement.v1', field_sha256: fieldSha256, name: variable.name,
    evidence_ids: variable.evidence_ids, encoding: 'base64-raw-utf8-json', total_bytes: raw.length, fragment_count: fragments.length,
    review_status: 'pending_owner_review', publication_authorized: false, fragments };
  const body = JSON.stringify(descriptor) + '\n', sha256 = hash(body);
  if (Buffer.byteLength(body) > 262144 || fragments.length > 2048) throw Error('FIELD_SUPPLEMENT_DESCRIPTOR_SIZE');
  await fs.writeFile(path.join(output, 'supplements', sha256 + '.json'), body);
  const stub = {
    name: variable.name, evidence_ids: variable.evidence_ids, field_completeness: 'partial', full_field_available: true,
    supplement: { field_sha256: fieldSha256, descriptor_sha256: sha256, encoding: descriptor.encoding, total_bytes: raw.length, fragment_count: fragments.length },
    omitted_field_content: 'Full original field JSON is available losslessly through the field selector; no omitted property is asserted absent or inferred.' };
  copyBoundedPreview(stub, variable);
  return { binding: { field_sha256: fieldSha256, descriptor_sha256: sha256 }, stub };
}
