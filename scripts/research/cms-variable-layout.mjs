import { createContextScopedSchemaFieldId } from '../../packages/identity/src/schema-catalog.mjs';
export function parseVariableLayout(document){
 if(document.status!=='captured'||document.mode!=='layout')throw Error('LAYOUT_UNAVAILABLE');
 const lines=document.text.split('\n'),header=lines.findIndex(l=>/^\s*Variable Name\s+Term Name\s+Definition\s*$/.test(l));
 if(header<0)throw Error('LAYOUT_HEADER');
 const first=lines[header+1]??'',cells=first.trim().split(/ {2,}/);
 if(first.length>2048||cells.length!==3)throw Error('LAYOUT_FIRST_ROW');
 let cursor=0;const positions=cells.map(cell=>{const i=first.indexOf(cell,cursor);cursor=i+cell.length;return i});
 const labelStart=Math.max(0,positions[1]-2),descriptionStart=positions[2]-2,rows=[];let active;
 if(!(0<labelStart&&labelStart<descriptionStart))throw Error('LAYOUT_COLUMNS');
 for(let i=header+1;i<lines.length;i++){
  const line=lines[i];if(!line.trim())continue;
  const name=line.slice(0,labelStart).trim(),label=line.slice(labelStart,descriptionStart).trim(),description=line.slice(descriptionStart).trim();
  if(name){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)||!label||!description)throw Error('LAYOUT_AMBIGUOUS_ROW:'+String(i+1));active={name,label,description,data_type:null,unit:null,allowed_values_state:'unresolved',page:1,start_line:i+1,end_line:i+1};rows.push(active);}
  else if(active){active.label=[active.label,label].filter(Boolean).join(' ');active.description=[active.description,description].filter(Boolean).join(' ');active.end_line=i+1;}
  else throw Error('LAYOUT_ORPHAN_CONTINUATION');
 }
 if(!rows.length||new Set(rows.map(r=>r.name)).size!==rows.length)throw Error('LAYOUT_VARIABLE_IDENTITY');
 for(const row of rows){row.source_quote=lines.slice(row.start_line-1,row.end_line).join('\n');row.continuation_pending=row===rows.at(-1)&&document.total_pages>1;row.eligible_for_schema_promotion=false;}
 return {status:'partial',pages_parsed:[1],unparsed_pages:Array.from({length:Math.max(0,document.total_pages-1)},(_,i)=>i+2),columns:{labelStart,descriptionStart},variables:rows,review_status:'pending_owner_review',publication_authorized:false};
}

export async function blockedFetch() {
  const error = new Error('WIRE_KEY_LIVE_NETWORK_FORBIDDEN');
  error.code = 'WIRE_KEY_LIVE_NETWORK_FORBIDDEN';
  throw error;
}

function differenceKinds(documentedName, wireName) {
  if (documentedName === wireName) return Object.freeze(['exact']);
  const kinds = [];
  if (documentedName.toLowerCase() === wireName.toLowerCase()) kinds.push('case');
    const dash = (value) => value.replace(/\s*[\u2010\u2011\u2012\u2013\u2014\-]\s*/g, '-');
  if (dash(documentedName) === dash(wireName) && documentedName !== wireName) kinds.push('hyphen_or_dash');
  const adultFold = (value) => value.replace(/\bAdults\b/g, 'Adult');
  if (adultFold(documentedName) === adultFold(wireName) && documentedName !== wireName) kinds.push('adult_adults_wording');
  const punctFold = (value) => value.replace(/[\s\p{P}\p{S}]+/gu, '');
  if (punctFold(documentedName) === punctFold(wireName) && documentedName !== wireName) kinds.push('punctuation_or_whitespace');
  return Object.freeze(kinds.length ? kinds : Object.freeze(['literal_difference']));
}

export function compareExactKeys(documentedNames, wireNames) {
  const documented = [...documentedNames];
  const wire = [...wireNames];
  const count_equal = documented.length === wire.length;
  const documentedSet = new Set(documented);
  const wireSet = new Set(wire);
  const onlyDocumented = documented.filter((name) => !wireSet.has(name));
  const onlyWire = wire.filter((name) => !documentedSet.has(name));
  return Object.freeze({
    documented_count: documented.length,
    wire_count: wire.length,
    count_equal,
    exact_key_equal: count_equal && onlyDocumented.length === 0 && onlyWire.length === 0,
    only_documented: Object.freeze(onlyDocumented),
    only_wire: Object.freeze(onlyWire),
    mismatch_count: onlyDocumented.length,
  });
}

export function expandCountedHcrisNames(fixture) {
  const exact = Array.from({ length: fixture.exact_match_count }, (_, index) => `HCRIS_EXACT_${String(index + 1).padStart(3, '0')}`);
  return Object.freeze({
    documented_names: Object.freeze([...exact, ...fixture.mismatches.map((row) => row.documented_name)]),
    wire_names: Object.freeze([...exact, ...fixture.mismatches.map((row) => row.wire_name)]),
  });
}

export function proposeWireKeyReconciliation({ documentedName, candidateWireNames = [], reviews = [] }) {
  if (typeof documentedName !== 'string' || documentedName.length < 1) {
    const error = new Error('DOCUMENTED_NAME_REQUIRED');
    error.code = 'DOCUMENTED_NAME_REQUIRED';
    throw error;
  }
  const candidates = [...new Set(candidateWireNames.filter((name) => typeof name === 'string' && name.length > 0))];
  const exact = candidates.filter((name) => name === documentedName);
  if (exact.length === 1) {
    return Object.freeze({
      state: 'exact',
      documented_name: documentedName,
      wire_name: exact[0],
      candidate_wire_names: Object.freeze([]),
      proposals: Object.freeze([]),
      evidence_ids: Object.freeze([]),
      silent_pick: false,
    });
  }
  const proposals = candidates.map((wireName) => Object.freeze({
    wire_name: wireName,
    differences: differenceKinds(documentedName, wireName),
  }));
  const accepted = reviews.filter((review) => review && review.accepted === true && review.documented_name === documentedName && typeof review.wire_name === 'string');
  if (accepted.length > 1) {
    return Object.freeze({
      state: 'ambiguous',
      documented_name: documentedName,
      wire_name: null,
      candidate_wire_names: Object.freeze(candidates),
      proposals,
      evidence_ids: Object.freeze([]),
      silent_pick: false,
      reason: 'review_collision',
    });
  }
  if (accepted.length === 1) {
    const review = accepted[0];
    if (typeof review.evidence_id !== 'string' || review.evidence_id.length < 3) {
      const error = new Error('REVIEW_EVIDENCE_REQUIRED');
      error.code = 'REVIEW_EVIDENCE_REQUIRED';
      throw error;
    }
    if (!candidates.includes(review.wire_name) && candidates.length > 0) {
      return Object.freeze({
        state: 'ambiguous',
        documented_name: documentedName,
        wire_name: null,
        candidate_wire_names: Object.freeze(candidates),
        proposals,
        evidence_ids: Object.freeze([review.evidence_id]),
        silent_pick: false,
        reason: 'review_not_in_candidates',
      });
    }
    return Object.freeze({
      state: 'reviewed_alias',
      documented_name: documentedName,
      wire_name: review.wire_name,
      candidate_wire_names: Object.freeze([review.wire_name]),
      proposals,
      evidence_ids: Object.freeze([review.evidence_id]),
      mapping_version: review.mapping_version ?? 'v1',
      silent_pick: false,
    });
  }
  return Object.freeze({
    state: candidates.length ? 'ambiguous' : 'unmatched',
    documented_name: documentedName,
    wire_name: null,
    candidate_wire_names: Object.freeze(candidates),
    proposals,
    evidence_ids: Object.freeze([]),
    silent_pick: false,
    reason: candidates.length > 1 ? 'multiple_candidates' : 'nonexact_requires_review',
  });
}

export function buildMappedRecipe({ mapping, label, dictionaryCitation, mappingVersion, get = [] }) {
  if (!mapping || !['exact', 'reviewed_alias'].includes(mapping.state) || typeof mapping.wire_name !== 'string') {
    return Object.freeze({ emitted: false, reason: 'mapping_not_accepted', payload_success: false, publication_authorized: false });
  }
  if (mapping.state === 'reviewed_alias' && !(mapping.evidence_ids && mapping.evidence_ids.length)) {
    return Object.freeze({ emitted: false, reason: 'missing_review_evidence', payload_success: false, publication_authorized: false });
  }
  return Object.freeze({
    emitted: true,
    get: Object.freeze([mapping.wire_name, ...get.filter((name) => name !== mapping.wire_name)]),
    wire_name: mapping.wire_name,
    label: label ?? null,
    dictionary_citation: dictionaryCitation ?? null,
    mapping_version: mappingVersion ?? mapping.mapping_version ?? null,
    documented_name: mapping.documented_name,
    payload_success: false,
    publication_authorized: false,
  });
}

export function invalidateMappingOnDocumentationUpdate({ mapping, previousDocumentedName, nextDocumentedName, mappingVersion = null }) {
  if (!mapping) return Object.freeze({ invalidated: false, reason: 'missing_mapping' });
  if (mapping.documented_name !== previousDocumentedName) {
    return Object.freeze({ invalidated: false, mapping, reason: 'unaffected' });
  }
  if (previousDocumentedName === nextDocumentedName) {
    return Object.freeze({ invalidated: false, mapping, reason: 'documented_name_unchanged' });
  }
  return Object.freeze({
    invalidated: true,
    mapping: Object.freeze({
      state: 'unmatched',
      documented_name: nextDocumentedName,
      wire_name: null,
      candidate_wire_names: Object.freeze([]),
      evidence_ids: Object.freeze([]),
      previous_wire_name: mapping.wire_name,
      previous_mapping_version: mappingVersion ?? mapping.mapping_version ?? null,
    }),
    reason: 'documented_name_changed',
  });
}

export function fieldIdForAcceptedWireMapping(context, mapping) {
  if (!mapping || !['exact', 'reviewed_alias'].includes(mapping.state) || typeof mapping.wire_name !== 'string' || mapping.wire_name.length < 1) {
    const error = new Error('ACCEPTED_WIRE_MAPPING_REQUIRED');
    error.code = 'ACCEPTED_WIRE_MAPPING_REQUIRED';
    throw error;
  }
  if (mapping.state === 'reviewed_alias' && !(Array.isArray(mapping.evidence_ids) && mapping.evidence_ids.length > 0)) {
    const error = new Error('REVIEW_EVIDENCE_REQUIRED');
    error.code = 'REVIEW_EVIDENCE_REQUIRED';
    throw error;
  }
  return createContextScopedSchemaFieldId(context, mapping.wire_name);
}
