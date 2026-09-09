import fs from 'node:fs/promises';
import path from 'node:path';
export const SUPPORTED_TOOLKIT_CONTRACTS = Object.freeze(['v1.0.0', 'v1.1.0']);
export function schemaReferences(value, result = []) {
  if (Array.isArray(value)) for (const item of value) schemaReferences(item, result);
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (key === '$ref' && typeof item === 'string') result.push(item);
    else schemaReferences(item, result);
  }
  return result;
}
export function schemaAssetPath(identity) {
  const url = new URL(identity);
  if (url.origin !== 'https://ushso.org' || url.search || !/^\/contracts\/[a-z0-9-]+\/v\d+\.\d+\.\d+\/schemas\/[a-z0-9.-]+\.json$/.test(url.pathname)) throw Error(`SCHEMA_REFERENCE_OUT_OF_SCOPE:${identity}`);
  return url.pathname.slice(1);
}
export async function collectSchemaAssets(root) {
  const result = new Map();
  async function visit(relative) {
    if (result.has(relative)) return;
    const absolute = path.join(root, relative);
    let bytes;
    try { bytes = await fs.readFile(absolute); } catch (error) { throw Error(`SCHEMA_DEPENDENCY_MISSING:${relative}`, {cause:error}); }
    const schema = JSON.parse(bytes);
    if (schemaAssetPath(schema.$id) !== relative || new URL(schema.$id).hash) throw Error(`SCHEMA_ID_MISMATCH:${relative}`);
    result.set(relative, {relative, absolute, bytes, schema});
    for (const reference of schemaReferences(schema)) await visit(schemaAssetPath(new URL(reference, schema.$id).href));
  }
  for (const version of SUPPORTED_TOOLKIT_CONTRACTS) {
    const directory = `contracts/machine-toolkit/${version}/schemas`;
    for (const name of (await fs.readdir(path.join(root,directory))).filter(x=>x.endsWith('.json')).sort()) await visit(`${directory}/${name}`);
  }
  return [...result.values()].sort((a,b)=>a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0);
}
