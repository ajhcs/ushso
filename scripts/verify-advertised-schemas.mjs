import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {schemaAssetPath, schemaReferences} from './schema-assets.mjs';
export async function verifyAdvertisedSchemas(base, discovery, fetchImpl = fetch) {
  assert.equal(discovery.input_contract_version,'observatory-machine-toolkit.v1.0.0');
  assert.equal(discovery.response_contract_version,'observatory-machine-toolkit.v1.1.0');
  assert.equal(discovery.tools.length,8);
  assert.equal(new Set(discovery.tools.map(x=>x.capability)).size,8);
  assert.ok(!discovery.tools.some(x=>x.capability==='plan_research'));
  const schemas=new Map();
  async function load(identity) {
    const relative=schemaAssetPath(identity), id=`https://ushso.org/${relative}`;
    if(schemas.has(id)) return;
    const response=await fetchImpl(new URL('/'+relative,base),{headers:{accept:'application/json'}});
    assert.equal(response.status,200,`SCHEMA_HTTP_STATUS:${relative}`);
    assert.match(response.headers.get('content-type')??'',/^application\/json(?:;|$)/i,`SCHEMA_NOT_JSON:${relative}`);
    const reader=response.body.getReader();let total=0;const chunks=[];
    try {while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>2*1024*1024)throw Error(`SCHEMA_SIZE_LIMIT:${relative}`);chunks.push(value);}}finally{await reader.cancel();}
    const schema=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(schema.$id,id,`SCHEMA_ID_MISMATCH:${relative}`);
    schemas.set(id,schema);
    for(const ref of schemaReferences(schema)) await load(new URL(ref,id).href);
  }
  for(const tool of discovery.tools) {
    const stem=tool.capability.replaceAll('_','-');
    assert.equal(tool.input_schema,`/contracts/machine-toolkit/v1.0.0/schemas/${stem}-input.schema.json`);
    assert.equal(tool.response_schema,`/contracts/machine-toolkit/v1.1.0/schemas/${stem}-response.schema.json`);
    await load(new URL(tool.input_schema,'https://ushso.org').href);
    await load(new URL(tool.response_schema,'https://ushso.org').href);
  }
  await load('https://ushso.org/contracts/machine-toolkit/v1.0.0/schemas/get-asset-response.schema.json');
  const ajv=new Ajv2020({strict:false,validateFormats:false});
  for(const schema of schemas.values())ajv.addSchema(schema);
  const validators=new Map();
  for(const tool of discovery.tools) validators.set(tool.capability,ajv.getSchema(new URL(tool.response_schema,'https://ushso.org').href));
  const legacy=ajv.getSchema('https://ushso.org/contracts/machine-toolkit/v1.0.0/schemas/get-asset-response.schema.json');
  return {schema_ids:[...schemas.keys()].sort(),validators,legacy,validate(capability,value){
    const check=validators.get(capability);assert.ok(check,`SCHEMA_CAPABILITY_UNKNOWN:${capability}`);
    assert.equal(check(value),true,`${capability}:${JSON.stringify(check.errors)}`);
    assert.equal(value.tool_contract_version,discovery.response_contract_version);
    if(value.rate_limit.state==='unknown')for(const key of ['policy_id','limit','remaining','reset_at','retry_after_seconds'])assert.equal(value.rate_limit[key],null);
  }};
}
