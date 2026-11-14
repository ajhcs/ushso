import { canonicalJson } from '../packages/machine-toolkit/src/json.mjs';
import { RANKING_VERSION } from '../packages/retrieval/tools/retrieval-core-v1.2.mjs';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const TTL=15*60*1000,DOMAIN='ushso.external-discovery-cursor.v2';
const routeNames=['GET /api/catalog','POST /api/discover','POST /api/discovery-controls/v1/search'];
const routes=new Set(routeNames);
const fail=(code='invalid_cursor')=>{throw Object.assign(new TypeError('Restart discovery from the first page.'),{code,restart_required:true});};
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
function decode(text){if(typeof text!=='string'||!/^[A-Za-z0-9_-]+$/.test(text))fail();try{const bytes=Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));if(encode(bytes)!==text)fail();return bytes;}catch{fail();}}
const nested=route=>route==='POST /api/discovery-controls/v1/search';
function queryBody(input,route){return nested(route)?input?.query:input;}
function withoutCursor(input,route){const copy=structuredClone(input);const query=queryBody(copy,route);if(query&&typeof query==='object'){delete query.cursor;delete query.generation;}return copy;}
function coreCursor(inner){
 let value;try{value=JSON.parse(decoder.decode(decode(inner)));}catch{fail();}
 if(!value||Object.keys(value).sort().join(',')!=='generation,offset,signature,v'||value.v!==1||typeof value.generation!=='string'||!value.generation||value.generation.length>160||!(/^[a-f0-9]{16}$/).test(value.signature)||!Number.isSafeInteger(value.offset)||value.offset<0)fail();
 return value;
}
function replaceCursor(input,route,cursor){const copy=structuredClone(input);const query=queryBody(copy,route);if(query&&typeof query==='object')query.cursor=cursor;return copy;}
// Ciphertext hides the internal engine's stable query digest and offset. Both
// encryption and HMAC keys are independently domain-derived from the dedicated
// deployment key; these cursors grant no access to non-public data.
export function createExternalDiscoveryCursor({signingKey,clock=()=>Date.now(),cryptoProvider=globalThis.crypto,rankingVersion=RANKING_VERSION}={}){
 let keysPromise;const timelines=new WeakMap();
 function keys(){if(!keysPromise)keysPromise=(async()=>{
  const bytes=signingKey===undefined?cryptoProvider.getRandomValues(new Uint8Array(32)):typeof signingKey==='string'?encoder.encode(signingKey):null;
  if(!bytes||bytes.length<32||bytes.length>1024)throw new Error('EXTERNAL_CURSOR_KEY_INVALID');
  const master=await cryptoProvider.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const derive=label=>cryptoProvider.subtle.sign('HMAC',master,encoder.encode(`${DOMAIN}.${label}`));
  return {auth:await cryptoProvider.subtle.importKey('raw',await derive('authentication'),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']),encryption:await cryptoProvider.subtle.importKey('raw',await derive('encryption'),{name:'AES-GCM'},false,['encrypt','decrypt'])};
 })();return keysPromise;}
 const binding=async(input,route)=>encode(new Uint8Array(await cryptoProvider.subtle.sign('HMAC',(await keys()).auth,encoder.encode(`${DOMAIN}.query:${canonicalJson({route,ranking_version:rankingVersion,query:withoutCursor(input,route)})}`))));
 async function seal(inner,input,route,generation){
  if(!routes.has(route)||typeof inner!=='string'||inner.length>4096)fail();
  const core=coreCursor(inner);if(core.generation!==generation)fail('generation_unavailable');
  const timeline=timelines.get(input),issued=timeline?.issued??clock(),expires=timeline?.expires??issued+TTL;
  if(!Number.isSafeInteger(issued)||issued<0||!Number.isSafeInteger(expires)||expires<=clock())fail();
  // Preserve every core field while removing JSON key names, duplicate generation
  // and base64 expansion. Ranking and query are bound inside the encrypted HMAC.
  const payload=[routeNames.indexOf(route),core.generation,core.signature,core.offset,issued,await binding(input,route)];
  const nonce=cryptoProvider.getRandomValues(new Uint8Array(12)),key=await keys();
  const ciphertext=await cryptoProvider.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:encoder.encode(DOMAIN)},key.encryption,encoder.encode(canonicalJson(payload)));
  const body=`v2.${encode(nonce)}.${encode(new Uint8Array(ciphertext))}`;
  const token=`${body}.${encode(new Uint8Array(await cryptoProvider.subtle.sign('HMAC',key.auth,encoder.encode(`${DOMAIN}.envelope:${body}`))))}`;
  if(token.length>512)throw new Error('EXTERNAL_CURSOR_SIZE_EXCEEDED');
  return token;
 }
 async function openPayload(token,input,route){
  if(typeof token!=='string'||token.length>512||!routes.has(route))fail();
  const parts=token.split('.');if(parts.length!==4||parts[0]!=='v2')fail();
  const key=await keys(),body=parts.slice(0,3).join('.');let payload;
  try{
   if(!await cryptoProvider.subtle.verify('HMAC',key.auth,decode(parts[3]),encoder.encode(`${DOMAIN}.envelope:${body}`)))fail();
   const nonce=decode(parts[1]);if(nonce.length!==12)fail();
   payload=JSON.parse(decoder.decode(await cryptoProvider.subtle.decrypt({name:'AES-GCM',iv:nonce,additionalData:encoder.encode(DOMAIN)},key.encryption,decode(parts[2]))));
  }catch{fail();}
  if(!Array.isArray(payload)||payload.length!==6||payload[0]!==routeNames.indexOf(route)||typeof payload[1]!=='string'||!payload[1]||payload[1].length>160||!(/^[a-f0-9]{16}$/).test(payload[2])||!Number.isSafeInteger(payload[3])||payload[3]<0||!Number.isSafeInteger(payload[4])||payload[4]<0||payload[4]>clock()||!Number.isSafeInteger(payload[4]+TTL)||payload[4]+TTL<=clock()||typeof payload[5]!=='string'||payload[5].length!==43)fail();
  const [routeId,generation,signature,offset,issued,queryBinding]=payload;
  payload={generation,issued,expires:issued+TTL,binding:queryBinding,inner:encode(encoder.encode(JSON.stringify({v:1,generation,signature,offset})))};
  const pin=queryBody(input,route)?.generation;
  if(pin!=null&&pin!==payload.generation)fail('generation_unavailable');
  if(payload.binding!==await binding(input,route))fail('cursor_query_mismatch');
  return payload;
 }
 return Object.freeze({ephemeral:signingKey===undefined,seal,async open(token,input,route){return (await openPayload(token,input,route)).inner;},
  async unwrap(input,route){const cursor=queryBody(input,route)?.cursor;if(cursor==null||cursor==='')return input;const payload=await openPayload(cursor,input,route);timelines.set(input,{issued:payload.issued,expires:payload.expires});return replaceCursor(input,route,payload.inner);},
  async wrap(response,originalInput,route){
   const result=nested(route)?response?.discovery:response;if(!result?.pagination)return response;
   if(result.ranking?.version!==rankingVersion)throw new Error('EXTERNAL_CURSOR_RANKING_MISMATCH');
   const originalCursor=queryBody(originalInput,route)?.cursor??null;
   const next=result.pagination.next_cursor?await seal(result.pagination.next_cursor,originalInput,route,result.pagination.generation):null;
   const clean={...result,pagination:{...result.pagination,cursor:originalCursor,next_cursor:next}};
   if(result.query?.filters)clean.query={...result.query,filters:{...result.query.filters,cursor:originalCursor}};
   if(result.receipt?.filters)clean.receipt={...result.receipt,filters:{...result.receipt.filters,cursor:originalCursor}};
   if(next&&signingKey===undefined)clean.warnings=[...(result.warnings??[]),'Continuation is limited to this Worker instance because a persistent signing key is not configured; a different isolate requires restarting.'];
   return nested(route)?{...response,discovery:clean}:clean;
  }
 });
}
