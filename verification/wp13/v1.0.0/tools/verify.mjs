import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIMITS,
  WEB_DISCOVERABILITY_SERVICE_VERSION,
  WebDiscoverabilityService,
  createStaticSeoProjectionRepository,
  renderDatasetHtml
} from '../../../../packages/web-discoverability/src/index.mjs';
import { SITE_ORIGIN, artifact, publication, record } from '../../../../packages/web-discoverability/tests/fixtures.mjs';
import {
  WP13_WEB_DISCOVERABILITY_CANDIDATE,
  createWp13WebDiscoverabilityCandidateHandler
} from '../../../../worker/wp13-web-discoverability-candidate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = relative => fs.readFile(path.join(root, relative), 'utf8');
const readJson = async relative => JSON.parse(await read(relative));
const RECEIPT_PATH = 'verification/wp13/v1.0.0/receipts/candidate-validation.json';

async function walk(relative) {
  const absolute = path.join(root, relative);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`WP13_SEAL_SYMLINK_FORBIDDEN:${child}`);
    if (entry.isDirectory()) files.push(...await walk(child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

export async function artifactSeal() {
  const paths = [
    ...await walk('packages/web-discoverability'),
    ...await walk('verification/wp13/v1.0.0'),
    'worker/wp13-web-discoverability-candidate.mjs'
  ].filter(file => file !== RECEIPT_PATH).sort();
  const files = [];
  for (const file of paths) {
    const bytes = await fs.readFile(path.join(root, file));
    files.push({ path: file, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  return {
    algorithm: 'sha256_of_ordered_path_and_file_sha256_rows',
    excluded: [RECEIPT_PATH],
    file_count: files.length,
    digest: `sha256:${crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex')}`
  };
}

const pin = publication();
const projection = await artifact({
  publication: pin,
  records: [record({ id: 'obs:asset:a' }), record({ id: 'obs:asset:b' })],
  sitemapShardMaxUrls: 1
});
let pointerResolutions = 0;
const service = new WebDiscoverabilityService({
  canonicalSiteOrigin: SITE_ORIGIN,
  publicationResolver: {
    async resolve() {
      pointerResolutions += 1;
      return pin;
    }
  },
  projectionRepository: createStaticSeoProjectionRepository({ artifacts: [projection], canonicalSiteOrigin: SITE_ORIGIN })
});
assert.equal(service.service_version, WEB_DISCOVERABILITY_SERVICE_VERSION);
const handler = createWp13WebDiscoverabilityCandidateHandler({ service });
assert.equal(handler.public_enabled, false);
assert.equal(WP13_WEB_DISCOVERABILITY_CANDIDATE.wired_to_worker_entry, false);
assert.equal(WP13_WEB_DISCOVERABILITY_CANDIDATE.public_enabled, false);
assert.equal(WP13_WEB_DISCOVERABILITY_CANDIDATE.deployment_authorized, false);

const page = await handler.handle(new Request('https://ushso.example/datasets/obs%3Aasset%3Aa', { headers: { accept: 'text/html' } }));
assert.equal(page.status, 200);
assert.equal(pointerResolutions, 1);
assert.equal(page.headers.get('x-ushso-search-generation'), pin.index_generation);
assert.equal(page.headers.get('x-ushso-seo-generation'), pin.component_generations.seo);
const pageHtml = await page.text();
assert.equal(pageHtml, renderDatasetHtml(projection.records[0]));
assert.match(pageHtml, /data-crawler-content="dataset"/u);
assert.match(pageHtml, /data-profile="schema-org-dataset"/u);
assert.match(pageHtml, /data-profile="dcat-us-1\.1"/u);

const dcat3Fixture = await readJson('packages/web-discoverability/conformance/dcat3-dataset.v1.0.0.json');
assert.equal(dcat3Fixture.fixture_origin, 'hand-authored normative expectations; not generated from USHSO implementation output');
assert.equal(dcat3Fixture.specification.immutable_url, 'https://www.w3.org/TR/2024/REC-vocab-dcat-3-20240822/');
const dcat3Projection = await artifact({
  publication: pin,
  records: [record({
    id: dcat3Fixture.input.public_id,
    title: dcat3Fixture.input.title,
    description: dcat3Fixture.input.description,
    dcatProfile: dcat3Fixture.input.profile
  })]
});
const dcat3Html = renderDatasetHtml(dcat3Projection.records[0]);
const dcat3Match = /<script type="application\/ld\+json" data-profile="dcat-3">([\s\S]*?)<\/script>/u.exec(dcat3Html);
assert.ok(dcat3Match, 'DCAT 3 JSON-LD script missing');
const dcat3Actual = JSON.parse(dcat3Match[1]);
assert.deepEqual(dcat3Actual, dcat3Fixture.expected_jsonld);
assert.equal(dcat3Actual['@context'].dcat, dcat3Fixture.specification.dcat_namespace);
assert.equal(dcat3Actual['@type'], 'dcat:Dataset');
assert.equal(dcat3Actual['dct:conformsTo']['@id'], dcat3Fixture.specification.immutable_url);
assert.equal(dcat3Actual['dcat:distribution'][0]['@type'], 'dcat:Distribution');
assert.equal(dcat3Actual['dcat:distribution'][0]['dcat:accessURL']['@id'], 'https://data.cms.gov/provider-data/dataset/example');
assert.equal(dcat3Actual['dcat:distribution'][0]['dcat:downloadURL']['@id'], 'https://data.cms.gov/files/example.csv');

const sitemap = await handler.handle(new Request('https://ushso.example/sitemap.xml'));
assert.equal(sitemap.status, 200);
const sitemapXml = await sitemap.text();
assert.equal((sitemapXml.match(/<sitemap>/gu) ?? []).length, 2);
assert.equal(projection.sitemap.url_count, projection.records.length);
assert.ok(projection.sitemap.shards.every(shard => shard.url_count <= 1 && Buffer.byteLength(shard.xml) <= LIMITS.sitemapShardMaxBytes));

const runtimeFiles = [
  'packages/web-discoverability/src/safety.mjs',
  'packages/web-discoverability/src/projection.mjs',
  'packages/web-discoverability/src/render.mjs',
  'packages/web-discoverability/src/service.mjs',
  'worker/wp13-web-discoverability-candidate.mjs'
];
const runtimeFileSha256 = {};
for (const file of runtimeFiles) {
  const source = await read(file);
  runtimeFileSha256[file] = crypto.createHash('sha256').update(source).digest('hex');
  assert.doesNotMatch(source, /(?:from|import\s*)\s*['"]node:/u, `${file} must be Worker portable`);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/u, `${file} must contain no source-network client`);
}

const workerEntry = await read('worker/index.mjs');
assert.doesNotMatch(workerEntry, /wp13-web-discoverability-candidate|web-discoverability/u, 'WP13 candidate must remain unwired');

const ledger = await readJson('verification/wp13/v1.0.0/evidence-ledger.json');
const authorizationRegister = await readJson('verification/external-authorization/v1.0.0/register.json');
const authorizationById = new Map(authorizationRegister.entries.map(entry => [entry.id, entry]));
assert.equal(ledger.scope, 'protected_local_candidate');
assert.equal(ledger.evidence_class, 'fixture_only_local_integration');
assert.deepEqual(ledger.external_authorizations.map(entry => entry.id).sort(), ['AUTH-06', 'AUTH-07']);
assert.ok(ledger.external_authorizations.every(entry => entry.status === 'not_requested' && entry.authorized === false));
for (const reference of ledger.external_authorizations) {
  const registered = authorizationById.get(reference.id);
  assert.ok(registered, `authorization ${reference.id} missing`);
  assert.equal(reference.status, registered.status);
  assert.equal(reference.authorized, registered.authorized);
  assert.equal(reference.environment, registered.environment);
}
for (const id of ['WP13-SEO-PROJECTION', 'WP13-NO-JS-HTML', 'WP13-STRUCTURED-DATA', 'WP13-ARTIFACT-READ-INTEGRITY', 'WP13-CONTENT-NEGOTIATION', 'WP13-CANONICAL-ORIGIN', 'WP13-PUBLIC-LOCATOR-PROVENANCE', 'WP13-SITEMAP', 'WP13-ALIAS-LIFECYCLE', 'WP13-GENERATION-PARITY', 'WP13-UNTRUSTED-OUTPUT-SECURITY', 'TST-SEO-01', 'G23.6', 'DOD-15', 'WP13-PUBLIC-ACTIVATION']) {
  assert.ok(ledger.requirements.some(entry => entry.id === id), `missing requirement ${id}`);
}
assert.match(ledger.requirements.find(entry => entry.id === 'DOD-15').status, /^not_satisfied_/u);

const receipt = await readJson(RECEIPT_PATH);
assert.equal(receipt.scope, 'protected_local_candidate');
assert.equal(receipt.evidence_class, 'fixture_only_local_integration');
assert.equal(receipt.work_package_acceptance, 'NOT_ACCEPTED_PUBLIC_ACTIVATION_AND_PRODUCTION_CORPUS_GATES_PENDING');
assert.equal(receipt.public_activation.enabled_route_count, 0);
assert.equal(receipt.public_activation.worker_entry_wired, false);
assert.equal(receipt.public_activation.deployment_performed, false);
assert.deepEqual(receipt.public_activation.authorization_dependencies.map(entry => entry.id).sort(), ['AUTH-06', 'AUTH-07']);
assert.ok(receipt.public_activation.authorization_dependencies.every(entry => entry.status === 'not_requested' && entry.authorized === false));
assert.ok(receipt.verification.every(entry => entry.status === 'PASS'));
const liveProvisionalSeal = await artifactSeal();
assert.equal(receipt.artifact_seal.status, 'PENDING_FINAL_RESEAL_TREE_NOT_CONFIRMED_FROZEN');
assert.equal(receipt.artifact_seal.live_provisional, 'computed_and_reported_by_validator_not_persisted_as_final');
assert.equal(receipt.artifact_seal.previous_seal.digest, 'sha256:c823baab000811e3b7ba39d3f110b9be25203fb017d30266ca9a84ddb0d1dcd9');
assert.notEqual(liveProvisionalSeal.digest, receipt.artifact_seal.previous_seal.digest);

process.stdout.write(`${JSON.stringify({
  ok: true,
  scope: 'protected_local_candidate',
  evidence_class: 'fixture_only_local_integration',
  public_enabled_routes: 0,
  projected_public_fixture_records: projection.records.length,
  sitemap_shards: projection.sitemap.shards.length,
  dcat3_offline_conformance: 'PASS',
  artifact_seal_status: receipt.artifact_seal.status,
  live_provisional_artifact_seal: liveProvisionalSeal,
  runtime_file_sha256: runtimeFileSha256
}, null, 2)}\n`);
