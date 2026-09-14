import fs from 'node:fs/promises';
import path from 'node:path';
import { assertFixtureOnly, PACKAGE_ROOT, prettyJson, publishImmutable } from './package-common.mjs';
import { compileAnalysisUseCard, recommendResearchSets } from './analysis-use-cards.mjs';
import { loadVerifiedAnalysisRequirements } from './verified-analysis-requirements.mjs';

assertFixtureOnly(process.argv.slice(2));

const contractRoot = path.join(PACKAGE_ROOT, 'analysis-use', 'v1.0.0');
const readJson = async relative => JSON.parse(await fs.readFile(path.join(contractRoot, relative), 'utf8'));
const datasetProfiles = await readJson('fixtures/hhi-analysis-input-profiles.json');
const compatibilityAssertions = await readJson('fixtures/hhi-analysis-compatibility.json');
const semanticJoins = await readJson('fixtures/hhi-semantic-joins.json');
const joinRoutes = await readJson('fixtures/hhi-join-routes.json');
const verifiedRequirements = await loadVerifiedAnalysisRequirements({ contractRoot });

const shared = {
  verifiedRequirements,
  analysisId: 'market_concentration_hhi',
  semanticJoins,
  compatibilityAssertions,
  joinRoutes,
};
const cards = [
  compileAnalysisUseCard({ ...shared, datasetProfiles: [datasetProfiles[0]] }),
  ...recommendResearchSets({ ...shared, datasetProfiles, maxSources: 2 }),
];
const result = await publishImmutable(
  'analysis-use/v1.0.0/fixtures/hhi-use-cards.json',
  prettyJson(cards),
);

process.stdout.write(`${JSON.stringify({ status: 'PASS', fixture_only: true, artifact: result }, null, 2)}\n`);
