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
