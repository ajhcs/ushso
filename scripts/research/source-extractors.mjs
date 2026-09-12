import { createVariableContext, createVariableIdentity, createVariableProvenance } from '../../packages/identity/src/index.mjs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const dimensions = ['dictionary','observation_unit','dates','geography','access_requirements','limitations'];
export function documentedEnumeration(raw) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Object.keys(raw).length||!Object.values(raw).every(x=>typeof x==='string'))return null;
  return {codes:Object.keys(raw),labels:raw};
}
const text = x => typeof x === 'string' && x.trim() ? x : null;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export function customMetadataDimensions(label) {
  const words=label.replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const matches=allowed=>words.some(word=>allowed.includes(word));
  return [matches(['temporal','date','dates','updated','period','periods'])?'dates':null,
    matches(['geographic','geographical','geography','spatial'])?'geography':null,
    matches(['access','rights','license','licence','licensing','restriction','restrictions'])?'access_requirements':null].filter(Boolean);
}
export function pointerValue(value,pointer) {
  if(pointer==='')return value;
  if(!pointer.startsWith('/'))throw Error('INVALID_POINTER');
  if(/~(?:[^01]|$)/.test(pointer))throw Error('INVALID_POINTER_ESCAPE');
  return pointer.slice(1).split('/').reduce((v,k)=>v?.[k.replace(/~1/g,'/').replace(/~0/g,'~')],value);
}
const escape = s => s.replace(/~/g,'~0').replace(/\//g,'~1');
export function bindCatalog(record,capture) {
  if(capture.status!=='captured')throw Error('CAPTURE_UNAVAILABLE');
  const rows=capture.data?.dataset;
  if(!Array.isArray(rows))throw Error('CATALOG_SHAPE');
  const id=record.identity.match_fields.source_id;
  const matches=rows.map((row,index)=>({row,index})).filter(x=>x.row?.identifier===id);
  if(matches.length!==1)throw Error(matches.length?'AMBIGUOUS_IDENTITY':'IDENTITY_NOT_FOUND');
  return {...matches[0],pointer:`/dataset/${matches[0].index}`,identity:id};
}
export function dictionaryFrom(value,kind) {
  if(kind==='cdc'){
    if(!Array.isArray(value))throw Error('MALFORMED_COLUMNS');
    const columns=value.filter(c=>object(c)&&text(c.fieldName)&&!c.fieldName.startsWith(':'));
    if(columns.some(c=>value.filter(x=>x?.fieldName===c.fieldName).length!==1))throw Error('DUPLICATE_VARIABLE');
    return columns.map(c=>({name:c.fieldName,label:text(c.name),description:text(c.description)??'',data_type:text(c.dataTypeName),unit:null,allowed_values:[]}));
  }
  if(kind==='census'){
    if(!object(value))throw Error('MALFORMED_VARIABLES');
    return Object.entries(value).filter(([,v])=>object(v)).map(([name,v])=>({name,label:text(v.label),description:text(v.concept)??'',data_type:text(v.predicateType),unit:null,allowed_values:[],concept_is_not_variable_definition:true,predicate_only:v.predicateOnly===true}));
  }
  throw Error('UNSUPPORTED_DICTIONARY_KIND');
}
export function extractRecord(record,{metadata,variables,geography,documentation},generation) {
  const source=record.identity.source.source_id,id=record.identity.match_fields.source_id;
  const claims=[],issues=[];
  const base={record_id:record.record_id,source_id:source,source_native_id:id,generation,record_sha256:hash(JSON.stringify(record))};
  const add=(dimension,field,value,capture,pointer,scope,transformation='literal',status='bound_partial')=>{
    if(value===undefined||value===null||value===''||(Array.isArray(value)&&!value.length))return;
    const raw=pointerValue(capture.data,pointer);
    if(raw===undefined)throw Error('UNRESOLVED_EVIDENCE_POINTER');
    claims.push({...base,dimension,field,value,evidence:{url:capture.url,capture_sha256:capture.sha256,observed_at:capture.captured_at,pointer,raw_value_sha256:hash(JSON.stringify(raw)),transformation},scope,status,review_status:'pending_owner_review',publication_authorized:false});
  };
  try{
    if(!metadata||metadata.status!=='captured')throw Error('METADATA_UNAVAILABLE');
    let row,prefix;
    if(source==='cdc-socrata'){
      row=metadata.data;prefix='';
      if(row?.id!==id||metadata.url!==`https://data.cdc.gov/api/views/${id}.json`)throw Error('IDENTITY_MISMATCH');
      if(row.columns!==undefined){const vars=dictionaryFrom(row.columns,'cdc');add('dictionary','variable_documentation',vars,metadata,'/columns','publisher_view_columns; data rows and release continuity not verified','cdc_columns');}
      const label=row.metadata?.rowLabel;
      if(text(label)&&!/^(rows?|records?|data|datasets?|database|rows of data)$/i.test(label.trim())&&!/^(daily|weekly|monthly|quarterly|annually|yearly)$/i.test(label.trim()))add('observation_unit','publisher_row_label',label,metadata,'/metadata/rowLabel','publisher view row label; not uniqueness or analytic grain certification');
      for(const k of ['rowsUpdatedAt','viewLastModified','publicationDate'])if(typeof row[k]==='number')add('dates',`publisher_metadata_${k}`,row[k],metadata,`/${k}`,'publisher metadata timestamp semantics only; not observation/release date');
      for(const [section,fields] of Object.entries(row.metadata?.custom_fields??{})){
        if(!object(fields))continue;
        for(const [k,v]of Object.entries(fields)){
          const p=`/metadata/custom_fields/${escape(section)}/${escape(k)}`;
          const classified=customMetadataDimensions(k);
          if(classified.includes('dates'))add('dates',`publisher_custom:${section}:${k}`,v,metadata,p,'publisher-labelled temporal metadata; no date-role inference');
          if(classified.includes('geography'))add('geography',`publisher_custom:${section}:${k}`,v,metadata,p,'publisher-labelled geographic metadata; not complete geographic coverage');
          if(classified.includes('access_requirements'))add('access_requirements',`publisher_custom:${section}:${k}`,v,metadata,p,'publisher access statement; catalog visibility and no-fee access are separate');
        }
      }
    }else{
      const binding=bindCatalog(record,metadata);row=binding.row;prefix=binding.pointer;
      for(const k of ['issued','modified','temporal','c_vintage'])add('dates',`publisher_catalog_${k}`,row[k],metadata,`${prefix}/${k}`,'publisher-labelled catalog field; vintage/modified are not observation/release dates');
      for(const k of ['spatial'])add('geography',`publisher_catalog_${k}`,row[k],metadata,`${prefix}/${k}`,'publisher spatial assertion; extent not independently tested');
      for(const k of ['accessLevel','accessRights','rights','license'])add('access_requirements',`publisher_catalog_${k}`,row[k],metadata,`${prefix}/${k}`,'catalog access/rights statement; no payload authorization or no-fee assertion');
      if(source==='census-api'){
        for(const [c,k,dim,field,transform] of [[variables,'c_variablesLink','dictionary','variable_documentation','census_variables'],[geography,'c_geographyLink','geography','query_geography_levels','literal']]){
          if(!c||c.status!=='captured'){if(text(row[k]))issues.push({code:'LINK_CAPTURE_MISSING',field,expected_url:row[k],capture_status:c?.status??'not_available'});continue;}
          if(!text(row[k])||new URL(row[k]).hostname!=='api.census.gov'||c.url!==row[k].replace(/^http:/,'https:'))throw Error('LINK_IDENTITY_MISMATCH');
          const pointer=k==='c_variablesLink'?'/variables':'/fips';
          const raw=pointerValue(c.data,pointer);
          if(k==='c_geographyLink'&&!Array.isArray(raw))throw Error('MALFORMED_GEOGRAPHY');
          const value=k==='c_variablesLink'?dictionaryFrom(raw,'census'):raw;
          const n=claims.length;
          add(dim,field,value,c,pointer,k==='c_variablesLink'?'publisher API variables including predicates; labels/concepts are not complete definitions or measurement units':'supported query geography levels; not all areas populated or statistically estimable',transform);
          if(claims.length>n)claims.at(-1).evidence.parent={url:metadata.url,capture_sha256:metadata.sha256,identity_pointer:`${prefix}/identifier`,link_pointer:`${prefix}/${k}`,publisher_link:row[k],transport_upgrade:row[k].startsWith('http:')?'HTTPS requested at same host/path; exact returned URL verified':null};
        }
      }
      if(text(row.describedBy))add('dictionary','dictionary_locator',row.describedBy,metadata,`${prefix}/describedBy`,'publisher-linked dictionary locator; contents not parsed','literal','captured_unbound');
    }
    if(text(row.description)){
      const sentences=row.description.split(/(?<=[.!?])\s+/).filter(s=>/limitation|restrict|suppres|not (?:include|represent|available|suitable)|caution|provisional|confiden|missing|incomplete|discontin|use agreement|fee|public.use/i.test(s));
      if(sentences.length)add('limitations','publisher_limitation_passages',sentences,metadata,`${prefix}/description`,'verbatim candidates only; statements may refer to related products and require semantic review','limitation_sentences');
      if(/restrict/i.test(record.title)&&/public.use/i.test(row.description))issues.push({code:'RESTRICTED_ASSET_WITH_PUBLIC_PRODUCT_REFERENCE',field:'access_requirements',resolution:'preserve restriction precedence; no public payload promotion'});
    }
    if(source==='cms-data-catalog'&&documentation?.status==='captured')issues.push({code:'DICTIONARY_PAGE_CAPTURED_PARSER_PENDING',url:documentation.url});
  }catch(error){issues.push({code:error.message,resolution:'record isolated from unsupported promotion; valid peers continue'});}
  return {...base,claims,issues,release_binding:'current captured publisher metadata snapshot only; historical payload release continuity unresolved'};
}
export function verifyProposalClaim(claim,diff,captures,record,generation) {
  if(!isDeepStrictEqual(diff.evidence,claim.evidence)||diff.scope!==claim.scope)throw Error('DIFF_EVIDENCE_BINDING');
  verifyClaim({...claim,value:diff.after},captures,record,generation);
  return {...claim,value:diff.after};
}
export function verifyClaim(claim,captures,record,generation) {
  if(typeof generation!=='string'||!generation||claim.generation!==generation)throw Error('GENERATION_BINDING');
  for(const c of captures.values())if(c.status==='captured'&&(!Number.isFinite(Date.parse(c.captured_at))||Date.parse(c.captured_at)>Date.now()))throw Error('CAPTURE_TIME_INVALID');
  if(claim.record_id!==record.record_id||claim.source_id!==record.identity.source.source_id||claim.source_native_id!==record.identity.match_fields.source_id||claim.record_sha256!==hash(JSON.stringify(record)))throw Error('RECORD_BINDING');
  const capture=captures.get(claim.evidence.url);
  if(!capture||capture.status!=='captured'||capture.sha256!==claim.evidence.capture_sha256||hash(capture.text)!==capture.sha256)throw Error('CAPTURE_BINDING');
  const raw=pointerValue(capture.data,claim.evidence.pointer);
  if(raw===undefined||hash(JSON.stringify(raw))!==claim.evidence.raw_value_sha256)throw Error('PASSAGE_BINDING');
  let expected=raw;
  if(claim.evidence.transformation==='cdc_columns')expected=dictionaryFrom(raw,'cdc');
  else if(claim.evidence.transformation==='census_variables')expected=dictionaryFrom(raw,'census');
  else if(claim.evidence.transformation==='limitation_sentences')expected=raw.split(/(?<=[.!?])\s+/).filter(s=>/limitation|restrict|suppres|not (?:include|represent|available|suitable)|caution|provisional|confiden|missing|incomplete|discontin|use agreement|fee|public.use/i.test(s));
  else if(claim.evidence.transformation!=='literal')throw Error('UNKNOWN_TRANSFORMATION');
  if(!isDeepStrictEqual(expected,claim.value))throw Error('UNSUPPORTED_VALUE');
  if(claim.publication_authorized!==false||claim.review_status!=='pending_owner_review')throw Error('UNAUTHORIZED_APPROVAL');
  // Reconstruct the permitted claim from independently hash-checked publisher
  // bodies. A valid quote alone cannot authorize another asset, field or scope.
  for(const c of captures.values())if(c.status==='captured'&&(hash(c.text)!==c.sha256||JSON.stringify(JSON.parse(c.text))!==JSON.stringify(c.data)))throw Error('CAPTURE_BODY_MISMATCH');
  const source=record.identity.source.source_id;
  const metadataURL=source==='cdc-socrata'?`https://data.cdc.gov/api/views/${record.identity.match_fields.source_id}.json`:source==='census-api'?'https://api.census.gov/data.json':'https://data.cms.gov/data.json';
  const metadata=captures.get(metadataURL);
  let variables,geography;
  if(source==='census-api'&&metadata){
    const {row}=bindCatalog(record,metadata);
    variables=typeof row.c_variablesLink==='string'?captures.get(row.c_variablesLink.replace(/^http:/,'https:')):undefined;
    geography=typeof row.c_geographyLink==='string'?captures.get(row.c_geographyLink.replace(/^http:/,'https:')):undefined;
  }
  const permitted=extractRecord(record,{metadata,variables,geography},generation).claims;
  if(!permitted.some(c=>isDeepStrictEqual(c,claim)))throw Error('CLAIM_SCOPE_OR_IDENTITY');
  return true;
}

export const VERSIONED_VARIABLE_TRANSFORMATIONS = Object.freeze({
  cdc: Object.freeze({ name: 'cdc_variable_identity', version: '1.0.0' }),
  census: Object.freeze({ name: 'census_variable_identity', version: '1.0.0' }),
  cms: Object.freeze({ name: 'cms_variable_identity', version: '1.0.0' }),
});
const VERSIONED_TRANSFORMATION_KINDS = Object.freeze(Object.fromEntries(Object.entries(VERSIONED_VARIABLE_TRANSFORMATIONS).map(([kind, transformation]) => [transformation.name, kind])));

function versionedKind(kind) {
  const value = String(kind ?? '').toLowerCase();
  if (value === 'cdc' || value === 'cdc-socrata') return 'cdc';
  if (value === 'census' || value === 'census-api') return 'census';
  if (value === 'cms' || value === 'cms-data-catalog') return 'cms';
  throw Error('UNSUPPORTED_VERSIONED_VARIABLE_KIND');
}

function requireVersionedCapture(capture, { requireBytes = false } = {}) {
  if (!object(capture) || !text(capture.url) || !/^[a-f0-9]{64}$/.test(capture.sha256 ?? '')) throw Error('VARIABLE_CAPTURE_REQUIRED');
  if (capture.status !== 'captured') throw Error('VARIABLE_CAPTURE_NOT_SUCCESSFUL');
  if (capture.data === undefined) throw Error('VARIABLE_CAPTURE_DATA_REQUIRED');
  if (requireBytes && typeof capture.text !== 'string') throw Error('VARIABLE_CAPTURE_BYTES_REQUIRED');
  return capture;
}

function versionedEvidenceIds(capture, options = {}) {
  const supplied = Array.isArray(options.evidence_ids) ? options.evidence_ids : [];
  const fromCapture = typeof capture.evidence_id === 'string' ? [capture.evidence_id] : [];
  const fallback = supplied.length || fromCapture.length ? [] : [`evidence:variable-capture:${capture.sha256.slice(0, 24)}`];
  return [...new Set([...supplied, ...fromCapture, ...fallback])].sort((left, right) => left.localeCompare(right));
}

function versionedEntries(value, kind) {
  if (kind === 'cdc') {
    if (!Array.isArray(value)) {
      if (object(value) && Array.isArray(value.columns)) value = value.columns;
      else throw Error('MALFORMED_VERSIONED_COLUMNS');
    }
    return value.map((entry, index) => ({ entry, pointer: `/columns/${index}` })).filter(({ entry }) => object(entry) && typeof entry.fieldName === 'string' && entry.fieldName.length > 0 && !entry.fieldName.startsWith(':'));
  }
  if (kind === 'census') {
    if (object(value) && object(value.variables)) value = value.variables;
    if (!object(value)) throw Error('MALFORMED_VERSIONED_VARIABLES');
    return Object.entries(value).filter(([, entry]) => object(entry)).map(([name, entry]) => ({ entry: { ...entry, __wire_name: name }, pointer: `/variables/${escape(name)}` }));
  }
  if (object(value) && Array.isArray(value.variables)) {
    return value.variables.map((entry, index) => ({ entry, pointer: `/variables/${index}` })).filter(({ entry }) => object(entry));
  }
  if (Array.isArray(value)) return value.map((entry, index) => ({ entry, pointer: `/variables/${index}` })).filter(({ entry }) => object(entry));
  throw Error('MALFORMED_VERSIONED_CMS_VARIABLES');
}

function literalCodeInput(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (object(raw) && Object.hasOwn(raw, 'item')) raw = raw.item;
  if (Array.isArray(raw)) {
    const values = raw.map((entry) => {
      if (typeof entry === 'string') return entry;
      if (typeof entry === 'number' || typeof entry === 'boolean') return String(entry);
      if (object(entry) && typeof entry.code !== 'undefined') return { code: String(entry.code), label: entry.label ?? null };
      return entry;
    });
    return values.length ? values : undefined;
  }
  if (object(raw)) return Object.keys(raw).length ? raw : undefined;
  return undefined;
}

function fieldType(entry, kind) {
  return text(entry.dataTypeName) ?? text(entry.predicateType) ?? text(entry.publisher_type) ?? text(entry.data_type) ?? text(entry.publisher_format) ?? (kind === 'cms' ? text(entry.type) : null);
}

function fieldWireName(entry, kind) {
  if (Object.hasOwn(entry, 'wire_name')) return entry.wire_name;
  if (kind === 'cdc') return entry.fieldName ?? null;
  if (kind === 'census') return entry.__wire_name ?? null;
  // CMS parser names are documented layout names, not independently verified payload wire names.
  // An exact or reviewed-alias CMS mapping requires separately supplied wire-name evidence
  // (an explicit wire_name field together with an explicit mapping). Until then wire stays null.
  return null;
}

function fieldDocumentedName(entry, wireName, kind) {
  if (entry.documented_name !== undefined && entry.documented_name !== null) return entry.documented_name;
  // Preserve CMS parser names as documented names even though they are not wire names.
  // CDC/Census keep their native-key behavior: documented falls back to the wire name first.
  if (kind === 'cms') {
    const cmsDocumented = entry.name ?? entry.variable_name;
    if (typeof cmsDocumented === 'string' && cmsDocumented.length > 0) return cmsDocumented;
  }
  return wireName ?? entry.label ?? entry.term_name ?? null;
}

function fieldLabel(entry) {
  return entry.label ?? entry.name ?? entry.term_name ?? entry.termName ?? null;
}

function fieldDefinition(entry) {
  return entry.definition ?? entry.description ?? entry.publisher_definition ?? null;
}

function fieldCodes(entry, kind) {
  if (kind === 'census' && object(entry.values) && Object.hasOwn(entry.values, 'item')) return entry.values.item;
  return entry.code_values ?? entry.allowed_values ?? entry.values ?? null;
}

function fieldObservedType(entry, options, index, evidenceIds) {
  const supplied = typeof options.observedTypeFor === 'function' ? options.observedTypeFor(entry, index) : entry.observed_type ?? entry.observedType;
  if (object(supplied)) return { ...supplied, evidence_ids: supplied.evidence_ids ?? options.evidence_ids ?? evidenceIds };
  if (typeof supplied === 'string' && supplied.length > 0) return { state: 'observed', value: supplied, evidence_ids: options.evidence_ids ?? evidenceIds };
  return { state: 'unknown', value: null, evidence_ids: [] };
}

function fieldUnit(entry, options, index, evidenceIds) {
  const supplied = typeof options.unitFor === 'function' ? options.unitFor(entry, index) : entry.unit ?? entry.measurement_unit;
  if (object(supplied)) return { ...supplied, evidence_ids: supplied.evidence_ids ?? evidenceIds };
  if (typeof supplied === 'string' && supplied.length > 0) return { state: 'documented', value: supplied, evidence_ids: evidenceIds };
  if (entry.unit_state) return { state: entry.unit_state, value: entry.unit_value ?? null, rationale: entry.unit_rationale ?? null, evidence_ids: evidenceIds };
  return { state: 'unknown', value: null, evidence_ids: [] };
}

function fieldMapping(entry, options, index, wireName, documentedName) {
  const supplied = typeof options.mappingFor === 'function' ? options.mappingFor(entry, index, wireName) : entry.mapping;
  if (supplied) return supplied;
  if (wireName === null) return { state: 'unmatched', documented_name: documentedName, wire_name: null, candidate_wire_names: [], evidence_ids: [] };
  if (documentedName !== wireName) throw Error('VERSIONED_VARIABLE_MAPPING_REQUIRED');
  return { state: 'exact', documented_name: wireName, wire_name: wireName, candidate_wire_names: [], evidence_ids: [] };
}

function fieldContext(options, entry, index) {
  const supplied = typeof options.contextFor === 'function' ? options.contextFor(entry, index) : options.context_binding ?? options.context;
  if (supplied) return supplied;
  return { state: 'unresolved', binding_state: 'unresolved', reason: 'release, distribution and schema binding were not supplied with this dictionary capture' };
}

function fieldLimitations(entry, kind, source) {
  const limitations = ['Literal publisher documentation does not certify payload schema, release continuity, measurement units, join compatibility or scientific fitness.'];
  if (kind === 'cms' && (source.status === 'partial' || source.unparsed_pages?.length || entry.continuation_pending)) limitations.push('CMS parser output is partial; continuation or unparsed pages remain unresolved.');
  if (entry.eligible_for_schema_promotion === false) limitations.push('The source parser marks this row ineligible for schema promotion pending review.');
  return limitations;
}

function cmsSuppliedMapping(entry, options, index, wireName) {
  const supplied = typeof options.mappingFor === 'function' ? options.mappingFor(entry, index, wireName) : entry.mapping;
  return supplied ?? null;
}

function cmsMappingEvidenceIds(supplied) {
  if (!supplied || !Array.isArray(supplied.evidence_ids)) return [];
  return supplied.evidence_ids.filter((id) => typeof id === 'string' && id.length > 0);
}

function variableIdentityFromEntry(entry, kind, index, pointer, capture, options, evidenceIds) {
  let wireName = fieldWireName(entry, kind);
  const documentedName = fieldDocumentedName(entry, wireName, kind);
  let mapping = fieldMapping(entry, options, index, wireName, documentedName);
  // CMS exact/reviewed-alias mappings require an explicit mapping object with
  // non-empty mapping evidence plus an explicit wire_name field. Wire spelling
  // alone (derived exact with empty evidence) stays unresolved.
  if (kind === 'cms' && (mapping.state === 'exact' || mapping.state === 'reviewed_alias')) {
    const supplied = cmsSuppliedMapping(entry, options, index, wireName);
    const hasExplicitWire = Object.hasOwn(entry, 'wire_name') && typeof entry.wire_name === 'string' && entry.wire_name.length > 0;
    const hasEvidence = cmsMappingEvidenceIds(supplied).length > 0 && cmsMappingEvidenceIds(mapping).length > 0;
    if (supplied === null || !hasExplicitWire || !hasEvidence) {
      wireName = null;
      mapping = { state: 'unmatched', documented_name: documentedName, wire_name: null, candidate_wire_names: [], evidence_ids: [] };
    }
  }
  if ((typeof wireName !== 'string' || wireName.length === 0) && (typeof documentedName !== 'string' || documentedName.length === 0)) throw Error('VERSIONED_VARIABLE_NAME_MISSING');
  const transformation = VERSIONED_VARIABLE_TRANSFORMATIONS[kind];
  const rawEntry = kind === 'census' ? Object.fromEntries(Object.entries(entry).filter(([key]) => key !== '__wire_name')) : entry;
  const sourceTypeValue = fieldType(entry, kind);
  const sourceType = sourceTypeValue ? { state: 'documented', value: sourceTypeValue, evidence_ids: evidenceIds } : { state: 'unknown', value: null, evidence_ids: [] };
  const observedType = fieldObservedType(entry, options, index, evidenceIds);
  const context = fieldContext(options, entry, index);
  const publisherConcept = entry.concept ?? entry.publisher_concept ?? null;
  const definition = fieldDefinition(entry);
  const provenance = createVariableProvenance({
    capture,
    pointer,
    raw: rawEntry,
    transformation,
    evidence_ids: evidenceIds,
  });
  return createVariableIdentity({
    context_binding: context,
    wire_name: wireName,
    documented_name: documentedName,
    publisher_label: fieldLabel(entry),
    publisher_concept: publisherConcept,
    definition,
    source_type: sourceType,
    observed_type: observedType,
    semantic_role: typeof options.semanticRoleFor === 'function' ? options.semanticRoleFor(entry, index) : entry.semantic_role ?? 'unknown',
    unit: fieldUnit(entry, options, index, evidenceIds),
    code_values: literalCodeInput(fieldCodes(entry, kind)) === undefined
      ? undefined
      : { state: 'documented', values: literalCodeInput(fieldCodes(entry, kind)), evidence_ids: evidenceIds },
    missingness: literalCodeInput(entry.missingness ?? entry.missing_values) === undefined
      ? undefined
      : { state: 'documented', values: literalCodeInput(entry.missingness ?? entry.missing_values), evidence_ids: evidenceIds },
    mapping,
    provenance,
    evidence_ids: evidenceIds,
    evidence_state: options.evidence_state ?? 'documented',
    limitations: [...fieldLimitations(entry, kind, capture.data ?? {})],
  });
}

export function extractVersionedVariables(value, kind, options = {}) {
  const normalizedKind = versionedKind(kind);
  const capture = requireVersionedCapture(options.capture);
  const entries = versionedEntries(value, normalizedKind);
  const evidenceIds = versionedEvidenceIds(capture, options);
  const mappedOptions = { ...options, raw: value };
  return entries.map(({ entry, pointer }, index) => variableIdentityFromEntry(entry, normalizedKind, index, pointer, capture, mappedOptions, evidenceIds));
}

export const extractVariableIdentities = extractVersionedVariables;
export const extractVariableIdentity = extractVersionedVariables;

export function extractVariableIdentityBundle(value, kind, options = {}) {
  const normalizedKind = versionedKind(kind);
  const variables = extractVersionedVariables(value, normalizedKind, options);
  const transformation = VERSIONED_VARIABLE_TRANSFORMATIONS[normalizedKind];
  return {
    schema_version: 'ushso.variable-identity.v1.2.0',
    source_kind: normalizedKind,
    transformation,
    variables,
    source_acceptance: 'unresolved',
    publication_authorized: false,
    promotion_eligible: false,
  };
}

function captureForClaim(claim, captures) {
  if (captures instanceof Map) return captures.get(claim.provenance?.source_locator) ?? null;
  return captures ?? null;
}

export function verifyVariableIdentity(claim, captures, options = {}) {
  if (!object(claim) || !object(claim.provenance)) throw Error('VARIABLE_CLAIM_MALFORMED');
  const capture = requireVersionedCapture(captureForClaim(claim, captures), { requireBytes: true });
  if (claim.publication_authorized !== false || claim.promotion_eligible !== false) throw Error('UNAUTHORIZED_VARIABLE_APPROVAL');
  if (capture.sha256 !== claim.provenance.capture_sha256) throw Error('VARIABLE_CAPTURE_BINDING');
  if (hash(capture.text) !== capture.sha256) throw Error('VARIABLE_CAPTURE_BINDING');
  if (capture.data !== undefined && JSON.stringify(JSON.parse(capture.text)) !== JSON.stringify(capture.data)) throw Error('VARIABLE_CAPTURE_BODY_MISMATCH');
  const raw = pointerValue(capture.data, claim.provenance.pointer);
  if (raw === undefined || hash(JSON.stringify(raw)) !== claim.provenance.raw_value_sha256) throw Error('VARIABLE_PASSAGE_BINDING');
  const kind = VERSIONED_TRANSFORMATION_KINDS[claim.provenance.transformation?.name];
  if (!kind || claim.provenance.transformation.version !== VERSIONED_VARIABLE_TRANSFORMATIONS[kind].version) throw Error('UNKNOWN_VERSIONED_TRANSFORMATION');

  const claimContext = createVariableContext(claim.context_binding ?? {});
  const resolvedClaim = claimContext.state === 'resolved';
  const suppliedContext = options.context_binding;
  if (resolvedClaim && suppliedContext === undefined) throw Error('VARIABLE_TRUSTED_CONTEXT_REQUIRED');
  const trustedContext = suppliedContext === undefined ? claimContext : createVariableContext(suppliedContext);
  if (resolvedClaim) {
    if (trustedContext.state !== 'resolved' || trustedContext.binding_state !== 'exact') throw Error('VARIABLE_TRUSTED_CONTEXT_UNRESOLVED');
    if (!isDeepStrictEqual(trustedContext, claimContext)) throw Error('VARIABLE_TRUSTED_CONTEXT_MISMATCH');
  }
  const trustedEvidenceIds = Array.isArray(options.evidence_ids)
    ? options.evidence_ids
    : versionedEvidenceIds(capture);
  if (resolvedClaim && trustedEvidenceIds.length === 0) throw Error('VARIABLE_TRUSTED_EVIDENCE_REQUIRED');
  // A resolved replay defaults to documented capture evidence. The claim's
  // evidence state/IDs are never used to authorize a resolved context.
  const trustedEvidenceState = options.evidence_state ?? (resolvedClaim ? 'documented' : claim.evidence_state);
  const collection = kind === 'cdc' ? capture.data.columns : kind === 'census' ? capture.data.variables : capture.data;
  const expected = extractVersionedVariables(collection, kind, {
    ...options,
    // A caller hook cannot override the independently trusted replay context.
    contextFor: undefined,
    capture,
    context_binding: trustedContext,
    evidence_ids: trustedEvidenceIds,
    evidence_state: trustedEvidenceState,
  }).find((item) => item.provenance.pointer === claim.provenance.pointer);
  if (!expected || !isDeepStrictEqual(expected, claim)) throw Error('UNSUPPORTED_VERSIONED_VALUE');
  return true;
}

export function verifyVersionedVariables(claims, captures, options = {}) {
  if (!Array.isArray(claims)) throw Error('VARIABLE_CLAIMS_MALFORMED');
  for (const claim of claims) verifyVariableIdentity(claim, captures, options);
  return true;
}
