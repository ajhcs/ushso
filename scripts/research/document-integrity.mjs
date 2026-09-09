import {hash} from './source-extractors.mjs';
export async function verifyDocumentCache(receipt,url,read) {
 if(receipt.url!==url)throw Error('DOCUMENT_URL_IDENTITY');
 if(receipt.status!=='captured_document')return receipt;
 if(!/^[a-f0-9]{64}$/.test(receipt.sha256)||!/^[a-f0-9]{64}$/.test(receipt.text_sha256))throw Error('DOCUMENT_DIGEST_INVALID');
 const pdf=await read(receipt.sha256+'.pdf'),text=await read(receipt.sha256+'.text.json');
 if(hash(pdf)!==receipt.sha256||hash(text)!==receipt.text_sha256)throw Error('DOCUMENT_CACHE_HASH');
 const parsed=JSON.parse(text);
 if(!Array.isArray(parsed.pages)||parsed.parser!==receipt.parser||parsed.version!==receipt.parser_version)throw Error('DOCUMENT_PARSER_IDENTITY');
 return receipt;
}
