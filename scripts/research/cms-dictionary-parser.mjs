// Deliberately bounded to two reviewed publisher layouts and exact PDF bytes.
// Output is a review proposal, not an executed schema or release approval.
export const templates={hospital:'40342bb506d4c39ad6a3306d188f414e97e683c8c7241aa5e0975bdc59c87b81',aco:'56ebaea5550af0c26e8d0483da7dc9330d951d55af982bbd2818746e31fd3cf8'};
export function parseCmsDictionary(document,pdfSha256) {
 const lines=document.pages?.find(p=>p.page===1)?.text?.split('\n');
 if(!lines)throw Error('CMS_DICTIONARY_PAGE_MISSING');
 const starts=[];
 if(pdfSha256===templates.hospital){
  if(!lines.some(l=>l.trim()==='Variable Name Cost Report Worksheet Element Definition'))throw Error('CMS_DICTIONARY_HEADER');
  for(let i=0;i<lines.length;i++){
   const m=lines[i].trim().match(/^(.+?)\s+(NA|S\d+[‐-]Part\d+[‐-]Line(?:[‐-]|\s)\d+[‐-]Column[‐-]\d+)(?:\s+(.*))?$/u);
   if(m)starts.push({name:m[1],worksheet:m[2],line:i});
  }
 }else if(pdfSha256===templates.aco){
  if(!lines.some(l=>l.trim()==='Term Name Variable Name Definition Footnotes'))throw Error('CMS_DICTIONARY_HEADER');
  const names=['Year','ACO_ID','State_Name','County_Name','State_ID','County_ID','AB_Psn_Yrs_ESRD','AB_Psn_Yrs_DIS'];
  for(const name of names){
   const i=lines.findIndex(l=>l.trim().split(/\s+/).includes(name));
   if(i<0)throw Error('CMS_DICTIONARY_VARIABLE_MISSING:'+name);
   const start=name.startsWith('AB_Psn_Yrs_')?i-3:i;
   starts.push({name,worksheet:null,line:start});
  }
 }else throw Error('CMS_DICTIONARY_LAYOUT_UNSUPPORTED');
 if(!starts.length||new Set(starts.map(s=>s.name)).size!==starts.length)throw Error('CMS_DICTIONARY_VARIABLE_IDENTITY');
 return {status:'partial',review_status:'pending_owner_review',publication_authorized:false,pages_parsed:[1],unparsed_pages:document.pages.filter(p=>p.page!==1).map(p=>p.page),variables:starts.map((s,i)=>({name:s.name,worksheet:s.worksheet,data_type:null,unit:null,allowed_values_state:'unresolved',page:1,start_line:s.line+1,end_line:(starts[i+1]?.line??lines.length),publisher_definition_and_notes:lines.slice(s.line,starts[i+1]?.line??lines.length).join('\n'),scope:'Verbatim bounded dictionary table row including notes; not normalized value domains, payload schema, identifier join compatibility or certified release applicability.'}))};
}
