import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const CANDIDATE_MANIFEST_PATH = 'verification/source-selection-candidate/transition.json';
export const CANDIDATE_TRANSITION = JSON.parse(readFileSync(new URL('../verification/source-selection-candidate/transition.json',import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function candidatePinMatches(relativePath,bytes) {
  const pin=CANDIDATE_TRANSITION.pins.find(x=>x.path===relativePath);
  return Boolean(pin && pin.bytes===bytes.length && pin.sha256===sha(bytes));
}
export async function validateCandidateTransition(root, readCurrentFile = (r,p)=>readFile(path.resolve(r,p))) {
  assert.equal(CANDIDATE_TRANSITION.status,'pending_independent_review');
  assert.equal(CANDIDATE_TRANSITION.approval,null);
  assert.equal(CANDIDATE_TRANSITION.historical_approval_transferred,false);
  assert.equal(CANDIDATE_TRANSITION.release_qualified,false);
  const bytes=new Map();
  for (const pin of CANDIDATE_TRANSITION.pins) {
    const b=await readCurrentFile(root,pin.path);
    assert.ok(candidatePinMatches(pin.path,b),`SOURCE_SELECTION_CANDIDATE_PIN_MISMATCH:${pin.path}`);
    bytes.set(pin.path,b);
  }
  const pkg=JSON.parse(bytes.get('package.json'));
  const lock=JSON.parse(bytes.get('package-lock.json'));
  const originalBytes=await readFile(new URL('../verification/source-selection-candidate/fixtures/pr003-package.json',import.meta.url));
  assert.equal(sha(originalBytes),'b6c3469c7b10ecb90114199c18c3ebb293d801b8c8a3521cb25ded2fdba8d05e','SOURCE_SELECTION_PRIOR_PACKAGE_CHANGED');
  const original=JSON.parse(originalBytes);
  for (const [name,command] of Object.entries(original.scripts)) {
    if (name==='build:web') continue;
    assert.equal(pkg.scripts[name],command,`SOURCE_SELECTION_LEGACY_SCRIPT_CHANGED:${name}`);
  }
  assert.equal(pkg.scripts['build:web'],'npm run stage:corpus && npm run stage:research && npm run build --workspace @ushso/observatory-web && npm run stage:source-selection && node scripts/prerender-public-pages.mjs');
  for (const key of ['name','version','private','type','license','engines','packageManager','workspaces','overrides']) assert.deepEqual(pkg[key],original[key],`SOURCE_SELECTION_PACKAGE_FIELD_CHANGED:${key}`);
  assert.equal(pkg.devDependencies['@playwright/test'],'1.56.1');
  assert.equal(lock.lockfileVersion,3);
  assert.deepEqual(lock.packages[''].devDependencies,pkg.devDependencies);
  assert.deepEqual(lock.packages[''].workspaces,pkg.workspaces);
  const workflow=bytes.get('.github/workflows/ci.yml').toString();
  assert.match(workflow,/permissions:\n  contents: read/);
  assert.match(workflow,/node-version: '22\.15\.0'/);
  for (const command of ['npm test','npm run build','npm run cf:dry-run:artifact','npm run test:e2e:browser']) assert.ok(workflow.includes(command),`SOURCE_SELECTION_CI_GATE_MISSING:${command}`);
  assert.doesNotMatch(workflow,/run:\s*npm run cf:deploy(?:\s|$)/m);
  return {status:'structurally_verified_pending_review',approval:null,historical_approval_transferred:false,release_qualified:false,pins:CANDIDATE_TRANSITION.pins};
}
