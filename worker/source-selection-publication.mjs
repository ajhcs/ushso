import { validateProjectionViews } from '../packages/source-selection/projection-contract.mjs';
import { readBoundedText } from './bounded-request-body.mjs';
import { canonicalJson } from '../packages/machine-toolkit/src/json.mjs';
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value))))].map(n => n.toString(16).padStart(2, '0')).join('');
const unavailable = reason => ({ status: 'unavailable', reason });
// The independently maintained rights pin is trusted deployment configuration,
// never supplied by a caller or inferred from the packaged bundle itself.
export async function loadAcceptedPublication(request, env, { now = Date.now() } = {}) {
  if (!/^[a-f0-9]{64}$/.test(env?.USHSO_ACCEPTED_RIGHTS_HASH ?? '')) return unavailable('current_rights_pin_required');
  if (!env?.ASSETS?.fetch) return unavailable('publication_not_packaged');
  try {
    const response = await env.ASSETS.fetch(new Request(new URL('/source-selection/publication.json', request.url)));
    if (!response.ok) return unavailable('publication_not_packaged');
    const publication = JSON.parse(await readBoundedText(response, 4 * 1024 * 1024));
    if (publication.status !== 'available') return unavailable('publication_not_packaged');
    if (publication.rights_hash !== env.USHSO_ACCEPTED_RIGHTS_HASH) return unavailable('rights_changed');
    const { bundle } = publication;
    if (!bundle || !Array.isArray(bundle.views) || !bundle.data_manifest
      || await digest(bundle) !== publication.bundle_hash
      || await digest(bundle.data_manifest) !== publication.generation_id
      || bundle.data_manifest.rights_policy_sha256 !== publication.rights_hash
      || bundle.data_manifest.accepted_ledger_revision !== publication.revision) return unavailable('publication_invalid');
    if (bundle.rights_expire_at != null && (!Number.isFinite(Date.parse(bundle.rights_expire_at)) || Date.parse(bundle.rights_expire_at) <= now)) return unavailable('rights_expired');
    const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    const manifest = bundle.data_manifest;
    if (Object.keys(manifest).sort().join(',') !== ['accepted_ledger_revision','accepted_ledger_sha256','evidence_manifest_sha256','input_schema_sha256','rights_policy_sha256'].sort().join(',') || ['accepted_ledger_revision','accepted_ledger_sha256','evidence_manifest_sha256','rights_policy_sha256'].some(k => !hex(manifest[k])) || !manifest.input_schema_sha256 || typeof manifest.input_schema_sha256 !== 'object' || Array.isArray(manifest.input_schema_sha256) || !Object.keys(manifest.input_schema_sha256).length || Object.values(manifest.input_schema_sha256).some(v => !hex(v))) return unavailable('publication_invalid');
    if (manifest.accepted_ledger_sha256 !== manifest.accepted_ledger_revision || !validateProjectionViews(bundle.views, publication.generation_id)) return unavailable('publication_invalid');
    return publication;
  } catch { return unavailable('publication_invalid'); }
}

export function acceptedPublicationPin(publication) {
 return { generation_id: publication.generation_id, data_manifest_sha256: publication.generation_id, ranking_version: 'accepted-projection-order.v1', schema_version: 'ushso.source-selection.v1' };
}
export function compareAccepted(publication, input) {
 const pin = acceptedPublicationPin(publication);
 const allowed = ['identity','purpose','geography','grain','population','observation_period','publication_date','revision_date','access_routes','dictionaries','joins','limitations'];
 if (!input || input.contract_version !== 'ushso.compare-assets.input.v2' || Object.keys(input).some(k => !['contract_version','asset_ids','dimensions','expected_pin'].includes(k)) || !Array.isArray(input.asset_ids) || !input.asset_ids.length || input.asset_ids.length > 4 || new Set(input.asset_ids).size !== input.asset_ids.length || input.asset_ids.some(id => typeof id !== 'string') || !Array.isArray(input.dimensions) || !input.dimensions.length || new Set(input.dimensions).size !== input.dimensions.length || input.dimensions.some(d => !allowed.includes(d))) return { status: 400, body: { status: 'invalid_request' } };
 if (canonicalJson(input.expected_pin ?? null) !== canonicalJson(pin)) return { status: 409, body: { status: 'generation_mismatch', restart_required: true } };
 const items = input.asset_ids.map(asset_id => {
  const view = publication.bundle.views.find(v => v.asset_id === asset_id);
  return {asset_id,release_id:view?.release_id ?? null,distribution_id:view?.distribution_id ?? null,dimensions:Object.fromEntries(input.dimensions.map(d => [d,view?.[d] ?? {status:'unavailable',value:null,assertion_ids:[],evidence_ids:[]}]))};
 });
 return {status:200,body:{contract_version:'ushso.compare-assets.result.v2',pin,items,unresolved:items.filter(i => Object.values(i.dimensions).some(d => d.status !== 'verified')).map(i => i.asset_id)}};
}
