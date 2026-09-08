import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../scripts/research/source-extractors.mjs';
import {verifyDocumentCache} from '../scripts/research/document-integrity.mjs';
test('Muse CMS cache: exact bytes/parser pass; URL substitutions, edits and missing peers fail',async()=>{
 const pdf=Buffer.from('%PDF-test'),text=Buffer.from(JSON.stringify({parser:'pypdf',version:'x',pages:[]}));
 const r={url:'https://data.cms.gov/dictionary.pdf',status:'captured_document',sha256:hash(pdf),text_sha256:hash(text),parser:'pypdf',parser_version:'x'};
 const read=async n=>n.endsWith('.pdf')?pdf:text;
 assert.equal(await verifyDocumentCache(r,r.url,read),r);
 await assert.rejects(verifyDocumentCache(r,'https://data.cms.gov/other.pdf',read),/URL_IDENTITY/);
 await assert.rejects(verifyDocumentCache(r,r.url,async()=>Buffer.from('tampered')),/CACHE_HASH/);
 await assert.rejects(verifyDocumentCache(r,r.url,async()=>{throw Error('ENOENT')}),/ENOENT/);
 await assert.rejects(verifyDocumentCache({...r,parser_version:'other'},r.url,read),/PARSER_IDENTITY/);
 assert.equal(await verifyDocumentCache(r,r.url,read),r,'a malformed document does not invalidate a valid peer');
});
