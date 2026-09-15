import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockedFetch, createExampleReceipt } from '../../packages/connectors/src/testing/example-runner.mjs';
import { QUALIFIED_ROUTES, buildRetrievalRecipe } from '../../packages/registry/qualified-access-routes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GENERATION = 'live-2026-09-03-85b50522b420';

function fail(code, detail) {
  const error = new Error(detail);
  error.code = code;
  throw error;
}

export async function checkGuideExamples({ repositoryRoot = root } = {}) {
  const content = await readFile(path.join(repositoryRoot, 'apps/web/src/content/learn/guides.ts'), 'utf8');
  const learnPage = await readFile(path.join(repositoryRoot, 'apps/web/src/pages/LearnPage.tsx'), 'utf8');
  const cms = QUALIFIED_ROUTES.find((route) => route.kind === 'public_cms');
  const census = QUALIFIED_ROUTES.find((route) => route.kind === 'keyed_census');
  const hcup = QUALIFIED_ROUTES.find((route) => route.kind === 'restricted_hcup');
  const cmsRecipe = buildRetrievalRecipe(cms);
  const censusRecipe = buildRetrievalRecipe(census);
  const hcupRecipe = buildRetrievalRecipe(hcup);

  if (!content.includes(cmsRecipe.sample_requests[0])) fail('GUIDE_EXAMPLE_BOUNDS', 'CMS guide example is missing the tested recipe request bound');
  if (!content.includes(censusRecipe.sample_requests[0])) fail('GUIDE_EXAMPLE_BOUNDS', 'Census curl example does not match the tested recipe');
  if (!content.includes("params = {'key': '[REDACTED]'}")) fail('GUIDE_EXAMPLE_BOUNDS', 'Census Python example lost the exact wire name or placeholder');
  if (!content.includes(hcupRecipe.sample_requests[0])) fail('GUIDE_EXAMPLE_BOUNDS', 'HCUP guide example is not the no-payload recipe text');

  if (/sk_live|Bearer |secret-value|api_key_value\s*[:=]\s*['\"][^'\[\]]/.test(content)) fail('GUIDE_EMBEDDED_CREDENTIAL', 'Guide example embeds a credential');
  if (!content.includes('[REDACTED]')) fail('GUIDE_MISSING_PLACEHOLDER', 'Census examples must keep the [REDACTED] placeholder');
  if (!content.includes('key')) fail('GUIDE_WIRE_NAME', 'Census examples must keep the exact wire name key');
  if (!content.includes(GENERATION)) fail('GUIDE_GENERATION', 'Guides must version examples with last-good generation');
  if (!content.includes('Finding a source is not obtaining the data')) fail('GUIDE_BOUNDARY', 'Beginner copy lost the source-versus-data boundary');

  if (!learnPage.includes('allGuides')) fail('GUIDE_NOT_RENDERED', 'LearnPage does not render the guide modules');
  if (!learnPage.includes('id={id}')) fail('GUIDE_ANCHORS', 'LearnPage must keep guide anchors from the module ids');
  if (!learnPage.includes('/search')) fail('GUIDE_NEXT_ACTION', 'Learn page lost the Explore next action');
  if (!learnPage.includes('HTTP 200 is not a tested-example badge') && !content.includes('HTTP 200 is not a tested-example badge')) fail('GUIDE_GATED_OUTCOME', 'Gated examples must display the actual outcome, not a fabricated success screenshot');

  const receipt = createExampleReceipt({
    source: 'cms',
    release: cms.release_id,
    distribution: cms.distribution_id,
    parameters: { key: 'should-redact' },
    expected: { content_class: 'html', media_type: 'text/html' },
    credentialRequired: true,
    outcomeKind: 'gated',
  });
  if (receipt.parameters.key !== '[REDACTED]') fail('GUIDE_RECEIPT_REDACTION', 'Example receipt failed to redact the named key');
  if (receipt.tested_example !== false) fail('GUIDE_TESTED_BADGE', 'Example receipt must not claim a tested-example badge');
  if (receipt.full_dataset_validated !== false) fail('GUIDE_FULL_DATASET', 'Example receipt must not claim full dataset validation');

  let liveBlocked = false;
  try {
    await blockedFetch();
  } catch (error) {
    liveBlocked = error?.code === 'EXAMPLE_RUNNER_LIVE_NETWORK_FORBIDDEN';
  }
  if (!liveBlocked) fail('GUIDE_LIVE_NETWORK', 'Guide checker must keep live example execution forbidden');

  return {
    ok: true,
    generation: GENERATION,
    cms_release: cms.release_id,
    census_parameter: 'key',
    census_placeholder: '[REDACTED]',
    hcup_status: 'no machine payload request is generated',
    live_example_execution: 'forbidden',
    tested_example_badge: false,
  };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  checkGuideExamples().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.code ?? 'GUIDE_CHECK_FAILED'}: ${error.message}\n`);
    process.exitCode = 2;
  });
}
