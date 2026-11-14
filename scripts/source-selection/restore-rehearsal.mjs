#!/usr/bin/env node
// Local nonproduction materialization only. Does not switch an active pointer.
import {open, readFile, mkdir, rename, realpath, stat, statfs} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonical, sha256, validateLedger, projectLedger} from '../../packages/source-selection/index.mjs';
const fail = code => { throw Object.assign(new Error(code), {code}); };
const hash = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const roles = ['application','catalog','ledger','policy','configuration','compatibility'];
const json = bytes => { try { return JSON.parse(bytes.toString('utf8')); } catch { fail('invalid_package'); } };
async function safeParent(destination) {
 const dst=resolve(destination); if (!dst.startsWith('/workspace/')) fail('workspace_required');
 const parent=await realpath(dirname(dst)); if (!parent.startsWith('/workspace/')) fail('workspace_required');
 if ((await stat(parent)).dev !== (await stat('/workspace')).dev) fail('workspace_mount_mismatch');
 const fs=await statfs(parent,{bigint:true}); if (fs.bavail*fs.bsize < 16n*1024n*1024n) fail('insufficient_space');
 return {dst,parent};
}
/** Verify a separately pinned package and independently pinned current policy; never activate it. */
export async function rehearseRestore({packagePath, expectedPackageHash, currentPolicyPath, expectedPolicyHash, compatibility, destination, asOf}) {
 if (!hash(expectedPackageHash) || !hash(expectedPolicyHash) || !compatibility || !asOf || Number.isNaN(Date.parse(asOf))) fail('invalid_input');
 const {dst,parent}=await safeParent(destination);
 if (await realpath(packagePath) === await realpath(currentPolicyPath)) fail('independent_rights_required');
 const [packageBytes,policyBytes]=await Promise.all([readFile(packagePath),readFile(currentPolicyPath)]);
 if (sha256(packageBytes)!==expectedPackageHash) fail('package_hash_mismatch');
 if (sha256(policyBytes)!==expectedPolicyHash) fail('current_rights_hash_mismatch');
 const pkg=json(packageBytes), current=json(policyBytes);
 if (pkg.format !== 'ushso.restore-package.v1' || !pkg.components || Object.keys(pkg.components).sort().join(',') !== roles.slice().sort().join(',') || !Array.isArray(current.revoked_rights) || current.revoked_rights.some(id => typeof id !== 'string' || !id.trim())) fail('invalid_package');
 const files={};
 for (const role of roles) { const part=pkg.components[role]; if (!part || !hash(part.sha256) || typeof part.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(part.base64)) fail('invalid_component'); const data=Buffer.from(part.base64,'base64'); if (!data.length || sha256(data)!==part.sha256) fail('component_hash_mismatch'); files[role]=data; }
 const savedPolicy=json(files.policy); if (canonical(savedPolicy)!==canonical(current)) fail('rights_policy_changed');
 const expectedCompat=json(files.compatibility); if (canonical(expectedCompat)!==canonical(compatibility)) fail('incompatible_runtime');
 const ledger=json(files.ledger); validateLedger(ledger); const catalog=json(files.catalog);
 const schemaHashes = pkg.data_manifest?.input_schema_sha256; if (!schemaHashes || typeof schemaHashes !== 'object' || Array.isArray(schemaHashes) || !Object.keys(schemaHashes).length || Object.values(schemaHashes).some(x => !hash(x))) fail('incompatible_schema');
 if (!hash(pkg.generation_id) || !pkg.data_manifest || sha256(canonical(pkg.data_manifest))!==pkg.generation_id || pkg.data_manifest.accepted_ledger_sha256!==sha256(canonical(ledger)) || pkg.data_manifest.accepted_ledger_revision!==sha256(canonical(ledger)) || pkg.data_manifest.evidence_manifest_sha256!==sha256(canonical(ledger.captures)) || pkg.data_manifest.rights_policy_sha256!==expectedPolicyHash) fail('generation_mismatch');
 if (!Array.isArray(catalog) || catalog.some(v => !Array.isArray(v.evidence_ids))) fail('invalid_package');
 const evidence=new Set(catalog.flatMap(v=>v.evidence_ids)); const used=new Set(ledger.captures.filter(c=>evidence.has(c.capture_id)).map(c=>c.rights_id));
 for (const id of used) { const r=ledger.rights.find(x=>x.rights_id===id); if (!r || current.revoked_rights.includes(id) || r.actions.metadata_capture!=='allowed' || r.actions.publish_metadata!=='allowed' || (r.expires_at && Date.parse(r.expires_at)<=Math.max(Date.parse(asOf),Date.now()))) fail('rights_blocked'); }
 const projected=projectLedger(ledger,pkg.generation_id,{revokedRights:current.revoked_rights});
 if (canonical(projected)!==canonical(catalog)) fail('catalog_mismatch');
 // Retained packages with byte captures are not yet portable: no silent missing artifacts.
 if (ledger.captures.some(c=>c.retention_mode==='bytes' && !current.revoked_rights.includes(c.rights_id))) fail('capture_bytes_not_packaged');
 const config=json(files.configuration); if (!config || typeof config !== 'object' || Array.isArray(config)) fail('invalid_configuration');
 const temp=dst; try { await mkdir(temp,{mode:0o700}); } catch(e) { if (e.code === 'EEXIST') fail('destination_exists'); throw e; }
 try { for (const role of roles) { const h=await open(join(temp,`${role}.artifact`),'wx',0o400); try { await h.writeFile(files[role]); await h.sync(); } finally {await h.close();} const readback=await readFile(join(temp,`${role}.artifact`)); if (sha256(readback)!==pkg.components[role].sha256) fail('restore_readback_failed'); } const h=await open(temp,'r'); try {await h.sync();} finally {await h.close();} const p=await open(parent,'r'); try {await p.sync();} finally {await p.close();} if (sha256(await readFile(currentPolicyPath)) !== expectedPolicyHash) fail('current_rights_changed'); }
 catch(e) { if(e.code==='EEXIST' || e.code==='ENOTEMPTY') fail('destination_exists'); throw e; }
 return {status:'rehearsed',generation_id:pkg.generation_id,package_sha256:expectedPackageHash,current_rights_sha256:expectedPolicyHash,destination:dst,health_status:'not_run',active_pointer:'unchanged'};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 try { const [packagePath,expectedPackageHash,currentPolicyPath,expectedPolicyHash,compatibilityPath,destination,asOf,...extra]=process.argv.slice(2); if (!asOf || extra.length) fail('usage'); const compatibility=json(await readFile(compatibilityPath)); console.log(JSON.stringify(await rehearseRestore({packagePath,expectedPackageHash,currentPolicyPath,expectedPolicyHash,compatibility,destination,asOf}),null,2)); }
 catch(e) { console.error(JSON.stringify({status:'failed',code:e.code || 'error',message:e.message})); process.exitCode=1; }
}
