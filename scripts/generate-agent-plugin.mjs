import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {TOOL_DEFINITIONS} from '../packages/machine-toolkit/src/manifest.mjs';
const root=new URL('../',import.meta.url),plugin=new URL('plugins/ushso-research/',root);
const read=async p=>JSON.parse(await fs.readFile(new URL(p,root)));
const common=await read('contracts/machine-toolkit/v1.0.0/schemas/common.schema.json');
const tools=[];
const discovery=await read('packages/machine-toolkit/public-webmcp-tool.json');
for(const t of TOOL_DEFINITIONS.filter(t=>t.capability!=='plan_research')){
 const schema=await read('contracts/machine-toolkit/v1.0.0/schemas/'+t.inputSchemaId.split('/').at(-1));
 const inputSchema={...JSON.parse(JSON.stringify(schema).replaceAll('common.schema.json#/$defs/','#/$defs/')),type:'object',$defs:common.$defs};
 tools.push({name:t.toolName,title:t.title,description:t.description,inputSchema,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true},capability:t.capability,outputMaxBytes:t.outputMaxBytes});
}
await fs.mkdir(new URL('assets/',plugin),{recursive:true});await fs.mkdir(new URL('scripts/',plugin),{recursive:true});
await fs.writeFile(new URL('assets/tools.json',plugin),JSON.stringify(tools,null,2)+'\n');
await fs.writeFile(new URL('assets/discovery.json',plugin),JSON.stringify(discovery,null,2)+'\n');
const clientSource=await fs.readFile(new URL('apps/web/src/providers/machineToolkitClient.ts',root),'utf8');
const output=stripTypeScriptTypes(clientSource).replace(/[ \t]+$/gm, '').trimEnd()+'\n';
await fs.writeFile(new URL('scripts/client.mjs',plugin),'// Generated from the WebMCP HTTP client. Regenerate with scripts/generate-agent-plugin.mjs.\n'+output);
await fs.writeFile(new URL('assets/source-identity.json',plugin),JSON.stringify({browser_client_sha256:createHash('sha256').update(clientSource).digest('hex'),capabilities:tools.map(t=>t.capability),target:'Astra-compatible MCP/WebMCP clients; native-model qualification separate'},null,2)+'\n');
console.log('Generated eight canonical tool schemas and shared HTTP client');
