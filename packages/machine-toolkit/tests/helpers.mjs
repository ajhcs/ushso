import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(directory, '..', '..', '..');

export async function fixtureBundle() {
  return JSON.parse(await fs.readFile(path.join(repositoryRoot, 'contracts/machine-toolkit/v1.0.0/fixtures/conformance.json'), 'utf8'));
}

export async function frozenManifest() {
  return JSON.parse(await fs.readFile(path.join(repositoryRoot, 'contracts/machine-toolkit/v1.0.0/contracts/toolkit-manifest.json'), 'utf8'));
}

export function responseCore(response) {
  const copy = structuredClone(response);
  for (const field of ['transport_adapter', 'request_id', 'response_generated_at', 'result_snapshot_id', 'candidate_snapshot_id']) delete copy[field];
  return copy;
}

export function contextFrom(response) {
  return {
    registry_revision: response.registry_revision,
    index_generation: response.index_generation,
    publication_manifest_id: response.publication_manifest_id,
    canonical_as_of: response.canonical_as_of,
    coverage_snapshot_id: response.coverage_snapshot_id,
    generation_retention_expires_at: response.generation_retention_expires_at,
    rate_limit: response.rate_limit
  };
}

export function serviceReturning(getCore, calls = []) {
  const method = (name) => async (input, options) => {
    calls.push({ name, input, signal: options.signal });
    return structuredClone(getCore());
  };
  return {
    searchAssets: method('searchAssets'),
    getAsset: method('getAsset'),
    getAccessPlan: method('getAccessPlan'),
    getRetrievalRecipe: method('getRetrievalRecipe'),
    getVariables: method('getVariables'),
    getJoinRoutes: method('getJoinRoutes'),
    compareAssets: method('compareAssets'),
    getCoverageStatus: method('getCoverageStatus'),
    planResearch: method('planResearch')
  };
}
