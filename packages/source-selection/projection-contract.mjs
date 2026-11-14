// Browser/Worker-safe structural contract shared with accepted-ledger validation.
export const projectionFields = Object.freeze(['identity','purpose','geography','grain','population','observation_period','publication_date','revision_date','access_routes','dictionaries','joins','limitations']);
export const criticalProjectionFields = Object.freeze(['identity','purpose','geography','grain','population','observation_period','access_routes','limitations']);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const strings = value => Array.isArray(value) && value.every(text) && new Set(value).size === value.length;
export const validProjectionDate = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d+)?Z)?$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value.slice(0,10);
const timestamp = value => validProjectionDate(value) && value.includes('T');
const url = value => { try { const parsed = new URL(value); return typeof value === 'string' && ['http:','https:'].includes(parsed.protocol) && !parsed.username && !parsed.password; } catch { return false; } };
export function typedProjectionValue(predicate, value) {
 switch (predicate) {
  case 'identity': return object(value) && text(value.asset_id) && text(value.publisher_id) && text(value.title);
  case 'purpose': case 'grain': case 'population': case 'family_id': case 'release_id': case 'distribution_id': return text(value);
  case 'geography': return object(value) && text(value.level) && strings(value.regions) && value.regions.length > 0;
  case 'observation_period': return object(value) && validProjectionDate(value.start) && validProjectionDate(value.end) && value.start <= value.end;
  case 'publication_date': case 'revision_date': return validProjectionDate(value);
  case 'access_routes': return Array.isArray(value) && value.length > 0 && value.every(route => object(route) && text(route.kind) && url(route.url));
  case 'dictionaries': return Array.isArray(value) && value.length > 0 && value.every(dictionary => object(dictionary) && text(dictionary.distribution_id) && url(dictionary.url));
  case 'joins': return Array.isArray(value) && value.length > 0 && value.every(join => object(join) && ['candidate','incompatible','unresolved'].includes(join.compatibility) && text(join.left_distribution_id) && text(join.right_distribution_id));
  case 'limitations': return strings(value) && value.length > 0;
  default: return false;
 }
}
const statuses = new Set(['verified','unresolved','unavailable','blocked','conflict']);
function wrapper(field, value, view, usedAssertions) {
 if (!object(value) || Object.keys(value).sort().join(',') !== 'assertion_ids,evidence_ids,status,value' || !statuses.has(value.status) || !strings(value.assertion_ids) || !strings(value.evidence_ids)) return false;
 if (value.assertion_ids.some(id => !view.assertion_ids.includes(id) || usedAssertions.has(id)) || value.evidence_ids.some(id => !view.evidence_ids.includes(id))) return false;
 for (const id of value.assertion_ids) usedAssertions.add(id);
 if (value.status !== 'verified') return value.value === null;
 if (!value.assertion_ids.length || !value.evidence_ids.length || !typedProjectionValue(field,value.value)) return false;
 if (field === 'identity' && (value.value.asset_id !== view.asset_id || value.value.publisher_id !== view.publisher_id || value.value.title !== view.title)) return false;
 if (field === 'dictionaries' && (!view.release_id || !view.distribution_id || value.value.some(item => item.distribution_id !== view.distribution_id))) return false;
 if (field === 'joins' && (!view.release_id || !view.distribution_id || value.value.some(item => item.left_distribution_id !== view.distribution_id))) return false;
 return true;
}
export function validateProjectionViews(views, generation) {
 if (!Array.isArray(views) || !/^[a-f0-9]{64}$/.test(generation) || new Set(views.map(view => view?.asset_id)).size !== views.length) return false;
 const globalAssertions = new Set();
 for (const view of views) {
  if (!object(view) || view.schema_version !== 'ushso.source-selection.v1' || view.generation_id !== generation || !text(view.asset_id) || !text(view.publisher_id) || !text(view.title) || !['reviewed_core','inventory_only'].includes(view.core_status) || !['inventory_only','decision_ready'].includes(view.decision_readiness) || !strings(view.assertion_ids) || !strings(view.evidence_ids) || !strings(view.unresolved)) return false;
  if (view.assertion_ids.some(id => globalAssertions.has(id))) return false;
  for (const id of view.assertion_ids) globalAssertions.add(id);
  for (const field of ['family_id','release_id','distribution_id']) if (view[field] !== null && !text(view[field])) return false;
  if (view.distribution_id !== null && view.release_id === null) return false;
  if (view.reviewed_at !== null && !timestamp(view.reviewed_at) || view.checked_at !== null && !validProjectionDate(view.checked_at)) return false;
  if (!object(view.freshness) || !['current','due','overdue','failed','blocked','unknown'].includes(view.freshness.status)) return false;
  for (const key of ['due_at','last_attempt_at','last_success_at']) if (view.freshness[key] != null && !validProjectionDate(view.freshness[key])) return false;
  if (!Array.isArray(view.citations) || view.citations.length !== view.evidence_ids.length || new Set(view.citations.map(c => c?.capture_id)).size !== view.citations.length) return false;
  for (const citation of view.citations) {
   if (!object(citation) || Object.keys(citation).sort().join(',') !== 'canonical_url,capture_id,content_sha256,locator_scheme,locators,retrieved_at' || !view.evidence_ids.includes(citation.capture_id) || !url(citation.canonical_url) || !timestamp(citation.retrieved_at) || !text(citation.locator_scheme) || (citation.content_sha256 !== null && !/^[a-f0-9]{64}$/.test(citation.content_sha256)) || !Array.isArray(citation.locators) || !citation.locators.length || citation.locators.some(l => !(text(l) || (object(l) && Number.isSafeInteger(l.start) && Number.isSafeInteger(l.end) && l.start >= 0 && l.end > l.start && Object.keys(l).sort().join(',') === 'end,start')))) return false;
  }
  const usedAssertions = new Set();
  if (projectionFields.some(field => !wrapper(field,view[field],view,usedAssertions))) return false;
  if (view.identity.status !== 'verified') return false;
  const unresolved = projectionFields.filter(field => view[field].status !== 'verified').concat(['family_id','release_id','distribution_id'].filter(field => view[field] === null)).sort();
  if (JSON.stringify([...view.unresolved].sort()) !== JSON.stringify(unresolved)) return false;
  if (view.decision_readiness === 'decision_ready' && (view.core_status !== 'reviewed_core' || !timestamp(view.reviewed_at) || criticalProjectionFields.some(field => view[field].status !== 'verified'))) return false;
 }
 return true;
}
