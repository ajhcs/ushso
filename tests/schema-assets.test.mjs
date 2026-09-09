import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectSchemaAssets, schemaAssetPath} from '../scripts/schema-assets.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('all supported schema bytes and transitive dependencies stage deterministically',async()=>{
 const first=await collectSchemaAssets(root),second=await collectSchemaAssets(root);
 assert.deepEqual(first,second);
 for(const version of ['v1.0.0','v1.1.0']) assert.ok(first.some(x=>x.relative.includes(`/machine-toolkit/${version}/`)));
 assert.ok(first.some(x=>x.relative.includes('/research-plan/')));
 for(const item of first) assert.deepEqual(item.bytes,await fs.readFile(path.join(root,item.relative)));
});
test('absent schema dependency fails explicitly before staging',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ushso-schema-missing-'));
 try {
  const assets=await collectSchemaAssets(root);
  for(const item of assets){await fs.mkdir(path.dirname(path.join(dir,item.relative)),{recursive:true});await fs.writeFile(path.join(dir,item.relative),item.bytes);}
  await fs.unlink(path.join(dir,'contracts/research-plan/v1.0.0/schemas/research-plan.schema.json'));
  await assert.rejects(collectSchemaAssets(dir),/SCHEMA_DEPENDENCY_MISSING/);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('schema resolution refuses uncontrolled networks and noncontract paths',()=>{
 for(const value of ['https://example.org/contracts/a/v1.0.0/schemas/a.json','https://ushso.org/private.json','https://ushso.org/contracts/a/v1.0.0/schemas/a.json?x=1']) assert.throws(()=>schemaAssetPath(value),/OUT_OF_SCOPE/);
});
