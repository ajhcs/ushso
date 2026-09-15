#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJoinFixtures, publishRoutes, R08_MINIMUM_QUALIFIED_ROUTES } from '../../packages/enrichment/join-evidence.mjs';
import { LAST_GOOD_GENERATION } from './ingest-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = 'evaluation/research-program/joins/priority-routes.json';

export function documentJoinRoutes({ repoRoot = ROOT } = {}) {
  const relative = FIXTURE;
  const bytes = readFileSync(path.join(repoRoot, relative));
  const fixtures = loadJoinFixtures(path.join(repoRoot, relative));
  const published = publishRoutes(fixtures, {
    qualifiedIds: [],
    machine: { compatibility: 'candidate', ccn_equals_npi: false },
    ui: { compatibility: 'candidate', ccn_equals_npi: false },
  });
  return {
    format: 'ushso.join-route-disposition.v1',
    generation: LAST_GOOD_GENERATION,
    evidence_reference: relative,
    evidence_sha256: createHash('sha256').update(bytes).digest('hex'),
    documented_routes: fixtures.routes.length,
    independently_qualified_routes: published.qualified_count,
    r08_minimum: R08_MINIMUM_QUALIFIED_ROUTES,
    r08_complete: published.r08_complete,
    ccn_equals_npi: false,
    sql_success_is_not_join_validity: true,
    tiny_sample_cannot_report_universal_match_rate: true,
    accepted: false,
    note: 'Fifteen documented fixture routes are not independently qualified routes.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = documentJoinRoutes();
  mkdirSync(path.join(ROOT, 'verification/research-program/evidence'), { recursive: true });
  writeFileSync(path.join(ROOT, 'verification/research-program/evidence/join-route-disposition.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
