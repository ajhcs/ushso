export const identities = {
 '44060-2d9b0e057caefa17': ['44060663-47d8-4ced-a115-b53b4c270acb','e216d1f303095bdd57acec09c9f11b70c5188c8ee3460d201a5556db64d9b410','2023-01-01/2023-12-31'],
 'a69d3-2982df0010b49135': ['a69d3df7-3f66-4a0d-b5b8-0d66049bd565','75dc19f2e9a3823d26ac413bc33d2292fdb0be5616eceebc218afcf3381a49e6','2023-01-01/2023-12-31'],
 'ae8c9-ecfcb36cea3a804f': ['ae8c9418-acc9-4442-b217-33291448f6b8','562533a5a9c466173856d083a3d13b947bde0ad79b68d71106eca121019515a9','2024-01-01/2024-12-31'],
 '62e62-450d1e84ffd2ee25': ['62e62d07-1837-4dbf-bb4f-a4820e0c7b16','a2ba9f9ce3ada916ae894de6be4da68f45c60d92b1130bcd29a1e04f82fbd3d5','2024-01-01/2024-12-31']
};
export function selectScientificDocument(docs,key) {
 const identity=identities[key];if(!identity)throw Error('UNKNOWN_SCIENTIFIC_SELECTION');
 const [uuid,pdfHash,temporal]=identity;
 const recordId='obs:asset:cms-data-catalog:data.cms.gov-data-api-v1-dataset-'+key;
 const native='https://data.cms.gov/data-api/v1/dataset/'+uuid+'/data-viewer';
 const resources='https://data.cms.gov/data-api/v1/dataset-resources/'+uuid;
 const matches=docs.filter(x=>{
  const b=x.document.release_binding??x.record.binding;
  return x.record.record_id===recordId&&x.record.source_native_id===native&&x.document.sha256===pdfHash&&x.document.status==='captured_document'
   &&b?.resources_url===resources&&b.distribution?.resourcesAPI===resources&&b.distribution?.accessURL===native.replace(/data-viewer$/,'data')&&b.distribution?.temporal===temporal;
 });
 if(matches.length!==1)throw Error(matches.length?'AMBIGUOUS_SCIENTIFIC_EVIDENCE':'MISSING_SCIENTIFIC_EVIDENCE');
 return matches[0];
}
