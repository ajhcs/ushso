import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getVerifiedAnalysisRequirement,
  getVerifiedAnalysisRequirementsDigest,
  getVerifiedAnalysisRequirementsMetadata,
  loadVerifiedAnalysisRequirements,
} from '../tools/verified-analysis-requirements.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractRoot = path.join(packageRoot, 'analysis-use', 'v1.0.0');
const catalogPath = path.join('upstream', 'analysis-requirements.v1.0.0.json');
const pinPath = path.join('upstream', 'analysis-requirements.pin.json');
const schemaPath = path.join('upstream', 'analysis-requirements.v1.0.0.schema.json');
const sha256 = bytes => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;

async function temporaryContract(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ushso-analysis-requirements-'));
  const root = path.join(parent, 'v1.0.0');
  await fs.cp(contractRoot, root, { recursive: true });
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  return root;
}

async function rewriteCatalog(root, mutate) {
  const absoluteCatalogPath = path.join(root, catalogPath);
  const catalog = JSON.parse(await fs.readFile(absoluteCatalogPath, 'utf8'));
  mutate(catalog);
  const catalogBytes = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`);
  await fs.writeFile(absoluteCatalogPath, catalogBytes);

  const absolutePinPath = path.join(root, pinPath);
  const pin = JSON.parse(await fs.readFile(absolutePinPath, 'utf8'));
  pin.catalog.bytes = catalogBytes.length;
  pin.catalog.sha256 = sha256(catalogBytes);
  await fs.writeFile(absolutePinPath, `${JSON.stringify(pin, null, 2)}\n`);
}

test('loader verifies the pinned bundle and exposes only cloned selections and metadata', async () => {
  const verified = await loadVerifiedAnalysisRequirements();
  assert.equal(Object.isFrozen(verified), true);
  assert.deepEqual(Object.keys(verified), ['schema_version']);

  const digest = getVerifiedAnalysisRequirementsDigest(verified);
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  const metadata = getVerifiedAnalysisRequirementsMetadata(verified);
  assert.equal(metadata.analysis_count, 15);
  assert.equal(metadata.catalog_id, 'hc-metrics:analysis-requirements');
  assert.equal(metadata.authority.calculation_authorized, false);

  const requirement = getVerifiedAnalysisRequirement(verified, 'market_concentration_hhi');
  assert.equal(requirement.methodology, 'hc-metrics:hhi:1.0.0');
  requirement.label = 'caller mutation';
  metadata.analysis_ids.length = 0;
  assert.notEqual(
    getVerifiedAnalysisRequirement(verified, 'market_concentration_hhi').label,
    'caller mutation',
  );
  assert.equal(getVerifiedAnalysisRequirementsMetadata(verified).analysis_count, 15);
});

test('all accessors reject a frozen object fabricated with the public handle shape', () => {
  const fabricated = Object.freeze({
    schema_version: 'observatory-verified-analysis-requirements.v1.0.0',
  });
  assert.throws(() => getVerifiedAnalysisRequirement(fabricated, 'market_share'), /must be returned by/);
  assert.throws(() => getVerifiedAnalysisRequirementsDigest(fabricated), /must be returned by/);
  assert.throws(() => getVerifiedAnalysisRequirementsMetadata(fabricated), /must be returned by/);
});

test('loader rejects catalog byte-length and SHA-256 mismatches before parsing', async t => {
  await t.test('byte length', async t2 => {
    const root = await temporaryContract(t2);
    await fs.appendFile(path.join(root, catalogPath), ' ');
    await assert.rejects(
      loadVerifiedAnalysisRequirements({ contractRoot: root }),
      /BYTE_LENGTH_MISMATCH: catalog/,
    );
  });

  await t.test('digest at the same byte length', async t2 => {
    const root = await temporaryContract(t2);
    const absolute = path.join(root, catalogPath);
    const bytes = await fs.readFile(absolute);
    const index = bytes.indexOf(Buffer.from('Market share'));
    assert.notEqual(index, -1);
    bytes[index] = bytes[index] === 77 ? 78 : 77;
    await fs.writeFile(absolute, bytes);
    await assert.rejects(
      loadVerifiedAnalysisRequirements({ contractRoot: root }),
      /SHA256_MISMATCH: catalog/,
    );
  });
});

test('loader verifies the exact pinned catalog-schema bytes', async t => {
  const root = await temporaryContract(t);
  await fs.appendFile(path.join(root, schemaPath), ' ');
  await assert.rejects(
    loadVerifiedAnalysisRequirements({ contractRoot: root }),
    /BYTE_LENGTH_MISMATCH: schema/,
  );
});

test('pin and catalog authorities remain fail-closed', async t => {
  await t.test('pin authority', async t2 => {
    const root = await temporaryContract(t2);
    const absolute = path.join(root, pinPath);
    const pin = JSON.parse(await fs.readFile(absolute, 'utf8'));
    pin.authority.calculation_authorized = true;
    await fs.writeFile(absolute, `${JSON.stringify(pin, null, 2)}\n`);
    await assert.rejects(
      loadVerifiedAnalysisRequirements({ contractRoot: root }),
      /INVALID_ANALYSIS_REQUIREMENTS_PIN/,
    );
  });

  await t.test('catalog authority', async t2 => {
    const root = await temporaryContract(t2);
    await rewriteCatalog(root, catalog => {
      catalog.authority.data_access_authorized = true;
    });
    await assert.rejects(
      loadVerifiedAnalysisRequirements({ contractRoot: root }),
      /INVALID_ANALYSIS_REQUIREMENTS_CATALOG/,
    );
  });
});

test('loader rejects duplicate analysis and nested requirement identifiers', async t => {
  const cases = [
    {
      name: 'analysis',
      mutate(catalog) {
        const duplicate = structuredClone(catalog.requirements[0]);
        duplicate.label = 'Duplicate analysis identifier';
        catalog.requirements.push(duplicate);
      },
      error: /DUPLICATE_ANALYSIS_REQUIREMENTS_ID: analysis_id/,
    },
    {
      name: 'input',
      mutate(catalog) {
        const duplicate = structuredClone(catalog.requirements[0].required_inputs[0]);
        duplicate.label = 'Duplicate input identifier';
        catalog.requirements[0].required_inputs.push(duplicate);
      },
      error: /DUPLICATE_ANALYSIS_REQUIREMENTS_ID: market_share\.input_id/,
    },
    {
      name: 'property',
      mutate(catalog) {
        const duplicate = structuredClone(catalog.requirements[0].required_properties[0]);
        duplicate.description = 'Duplicate property identifier.';
        catalog.requirements[0].required_properties.push(duplicate);
      },
      error: /DUPLICATE_ANALYSIS_REQUIREMENTS_ID: market_share\.property_id/,
    },
    {
      name: 'join',
      mutate(catalog) {
        const duplicate = structuredClone(catalog.requirements[0].join_requirements[0]);
        duplicate.description = 'Duplicate join identifier.';
        catalog.requirements[0].join_requirements.push(duplicate);
      },
      error: /DUPLICATE_ANALYSIS_REQUIREMENTS_ID: market_share\.join_id/,
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async t2 => {
      const root = await temporaryContract(t2);
      await rewriteCatalog(root, item.mutate);
      await assert.rejects(loadVerifiedAnalysisRequirements({ contractRoot: root }), item.error);
    });
  }
});

test('loader rejects invalid join, upstream-analysis, and methodology references', async t => {
  const cases = [
    {
      name: 'join input',
      mutate(catalog) {
        catalog.requirements[0].join_requirements[0].input_ids[0] = 'unknown_input';
      },
      error: /UNKNOWN_ANALYSIS_REQUIREMENTS_JOIN_INPUT/,
    },
    {
      name: 'incomplete join input set',
      mutate(catalog) {
        catalog.requirements[0].join_requirements[0].input_ids.pop();
      },
      error: /INCOMPLETE_ANALYSIS_REQUIREMENTS_JOIN_INPUTS/,
    },
    {
      name: 'unknown join entity',
      mutate(catalog) {
        catalog.requirements[0].join_requirements[0].alternatives[0].entity = 'unknown';
      },
      error: /INVALID_ANALYSIS_REQUIREMENTS_(?:CATALOG|JOIN_ENTITY)/,
    },
    {
      name: 'unknown join key',
      mutate(catalog) {
        catalog.requirements[0].join_requirements[0].alternatives[0].key_input_set = ['unknown_input'];
      },
      error: /INVALID_ANALYSIS_REQUIREMENTS_JOIN_KEY_SET/,
    },
    {
      name: 'unsafe measure join key',
      mutate(catalog) {
        catalog.requirements[0].join_requirements[0].alternatives[0].key_input_set = ['utilization_volume'];
      },
      error: /UNSAFE_ANALYSIS_REQUIREMENTS_JOIN_KEY_ROLE/,
    },
    {
      name: 'overlapping key and endpoint discriminator',
      mutate(catalog) {
        catalog.requirements[0].join_requirements[0].alternatives[0]
          .left_discriminator_input_ids = ['facility_id'];
      },
      error: /OVERLAPPING_ANALYSIS_REQUIREMENTS_JOIN_ENDPOINT_INPUTS/,
    },
    {
      name: 'period endpoint discriminator',
      mutate(catalog) {
        catalog.requirements[0].join_requirements[0].alternatives[0]
          .left_discriminator_input_ids = ['period'];
      },
      error: /UNSAFE_ANALYSIS_REQUIREMENTS_JOIN_ENDPOINT_ROLE/,
    },
    {
      name: 'inverse semantic alternative duplicate',
      mutate(catalog) {
        const alternatives = catalog.requirements[0].join_requirements[0].alternatives;
        const original = structuredClone(alternatives.find(item => item.cardinality === 'many_to_one'));
        alternatives.push({
          ...original,
          alternative_id: `${original.alternative_id}_inverse_duplicate`,
          cardinality: 'one_to_many',
          left_discriminator_input_ids: original.right_discriminator_input_ids,
          right_discriminator_input_ids: original.left_discriminator_input_ids,
        });
      },
      error: /DUPLICATE_ANALYSIS_REQUIREMENTS_ID: .*semantic_alternative/,
    },
    {
      name: 'upstream analysis',
      mutate(catalog) {
        catalog.requirements[1].upstream_analysis_ids[0] = 'unknown_analysis';
      },
      error: /UNKNOWN_ANALYSIS_REQUIREMENTS_UPSTREAM/,
    },
    {
      name: 'methodology identifier',
      mutate(catalog) {
        catalog.requirements[1].methodology = 'hc-metrics:hhi:1.0.1';
      },
      error: /INCONSISTENT_ANALYSIS_REQUIREMENTS_METHODOLOGY/,
    },
    {
      name: 'shared implementation methodology',
      mutate(catalog) {
        catalog.requirements.find(item => item.analysis_id === 'financial_days_cash_on_hand')
          .implementation_methodology = 'different_financial_runtime';
      },
      error: /INCONSISTENT_ANALYSIS_REQUIREMENTS_METHODOLOGY_KEY/,
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async t2 => {
      const root = await temporaryContract(t2);
      await rewriteCatalog(root, item.mutate);
      await assert.rejects(loadVerifiedAnalysisRequirements({ contractRoot: root }), item.error);
    });
  }
});

test('loader rejects invalid conditional-domain references', async t => {
  const cases = [
    {
      name: 'unknown selector',
      mutate(catalog) {
        const score = catalog.requirements
          .find(item => item.analysis_id === 'quality_reliability')
          .required_inputs.find(item => item.input_id === 'quality_score');
        score.conditional_ranges[0].when_input_id = 'unknown_measure';
      },
      error: /UNKNOWN_ANALYSIS_REQUIREMENTS_RANGE_SELECTOR/,
    },
    {
      name: 'selector value outside domain',
      mutate(catalog) {
        const score = catalog.requirements
          .find(item => item.analysis_id === 'quality_reliability')
          .required_inputs.find(item => item.input_id === 'quality_score');
        score.conditional_ranges[0].equals = 'unsupported_measure';
      },
      error: /INVALID_ANALYSIS_REQUIREMENTS_RANGE_SELECTOR_VALUE/,
    },
    {
      name: 'reversed range',
      mutate(catalog) {
        const score = catalog.requirements
          .find(item => item.analysis_id === 'quality_reliability')
          .required_inputs.find(item => item.input_id === 'quality_score');
        score.conditional_ranges[0].minimum = 6;
      },
      error: /INVALID_ANALYSIS_REQUIREMENTS_RANGE_BOUNDS/,
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async t2 => {
      const root = await temporaryContract(t2);
      await rewriteCatalog(root, item.mutate);
      await assert.rejects(loadVerifiedAnalysisRequirements({ contractRoot: root }), item.error);
    });
  }
});

test('selector rejects malformed and unknown analysis identifiers', async () => {
  const verified = await loadVerifiedAnalysisRequirements();
  assert.throws(() => getVerifiedAnalysisRequirement(verified, '../hhi'), /canonical analysis identifier/);
  assert.throws(() => getVerifiedAnalysisRequirement(verified, 'not_in_catalog'), /unknown analysis_id/);
});
