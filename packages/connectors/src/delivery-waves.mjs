import { deepFreeze } from './canonical.mjs';
import { APPROVED_SOURCE_DESCRIPTOR_TEMPLATES } from './descriptors.mjs';
import { routeManifestInventory } from './route-manifest.mjs';

const descriptorsById = new Map(APPROVED_SOURCE_DESCRIPTOR_TEMPLATES.map((descriptor) => [descriptor.descriptor_id, descriptor]));

const instance = (descriptorId, wave, platform, options = {}) => ({
  instance_id: `instance_${descriptorId.slice('descriptor_'.length).replace(/_fixture_v1$/, '')}`,
  descriptor_id: descriptorId,
  delivery_wave: wave,
  platform,
  jurisdiction: options.jurisdiction ?? 'US',
  lifecycle: 'fixture_only',
  source_state: 'paused',
  coverage_cell_state: options.coverageCellState ?? 'candidate',
  activation_authorized: false,
  live_network_permitted: false,
  external_authorization_gate: 'AUTH-04',
  legal_terms_review: 'pending',
  live_route_confirmation: 'pending',
  source_specific_promotion_receipt: null,
  authority_precedence: options.authorityPrecedence ?? 'first_party_government',
  boundary_note: options.boundaryNote ?? 'Metadata discovery only; source-data payload retrieval is outside the connector route manifest.',
});

export const DELIVERY_WAVE_SOURCE_INSTANCES = deepFreeze([
  instance('descriptor_data_gov_v4_fixture_v1', 2, 'data-gov-v4', { boundaryNote: 'Preserve the originating agency on every aggregator record; Data.gov is not substituted as publisher.' }),
  instance('descriptor_data_cms_data_json_fixture_v1', 2, 'dcat-data-json', { boundaryNote: 'CMS latest aliases remain distinct from immutable releases and are never treated as equivalent locators.' }),
  instance('descriptor_cms_provider_data_fixture_v1', 2, 'cms-provider-metastore'),
  instance('descriptor_cdc_socrata_fixture_v1', 2, 'socrata', { boundaryNote: 'Only Socrata metadata and schema routes are manifested; SODA data rows are prohibited.' }),
  instance('descriptor_cdc_non_socrata_fixture_v1', 2, 'dcat-data-json'),
  instance('descriptor_census_metadata_fixture_v1', 2, 'census-metadata', { boundaryNote: 'Dataset discovery and variables metadata are bounded to configured datasets; observation queries are prohibited.' }),

  instance('descriptor_hrsa_inventory_fixture_v1', 3, 'dcat-data-json'),
  instance('descriptor_ahrq_family_inventory_fixture_v1', 3, 'static-inventory'),
  instance('descriptor_irs_teos_eobmf_inventory_fixture_v1', 3, 'static-inventory', { boundaryNote: 'TEOS and EO-BMF public inventory documentation only; search forms and bulk data files are not executed.' }),
  instance('descriptor_irs_form990_manifest_fixture_v1', 3, 'static-inventory', { boundaryNote: 'Form 990 manifest, directory-index, and XSD metadata only; archive members are never retrieved or unpacked.' }),
  instance('descriptor_irs_soi_inventory_fixture_v1', 3, 'static-inventory'),

  instance('descriptor_pa_socrata_fixture_v1', 4, 'socrata', { jurisdiction: 'US-PA' }),
  instance('descriptor_ca_ckan_canary_fixture_v1', 4, 'ckan', { jurisdiction: 'US-CA' }),
  instance('descriptor_pa_arcgis_canary_fixture_v1', 4, 'arcgis', { jurisdiction: 'US-PA', boundaryNote: 'ArcGIS organization filter and operator identity require live route confirmation before any shadow run.' }),
  instance('descriptor_pa_static_canary_fixture_v1', 4, 'static-inventory', { jurisdiction: 'US-PA' }),

  instance('descriptor_harvard_dataverse_fixture_v1', 6, 'dataverse', { jurisdiction: 'US-MA', authorityPrecedence: 'below_first_party_government', boundaryNote: 'Repository metadata is not promoted above first-party government authority because of record volume.' }),
  instance('descriptor_datacite_fixture_v1', 6, 'datacite', { authorityPrecedence: 'below_first_party_government', boundaryNote: 'Registry metadata authority does not establish underlying asset access or first-party government authority.' }),
  instance('descriptor_cdc_stacks_oai_fixture_v1', 6, 'oai-pmh'),
]);

export function deliveryWaveManifest() {
  return DELIVERY_WAVE_SOURCE_INSTANCES.map((source) => {
    const descriptor = descriptorsById.get(source.descriptor_id);
    if (!descriptor) throw new Error(`Delivery-wave instance references an unknown descriptor: ${source.descriptor_id}`);
    return {
      ...structuredClone(source),
      routes: routeManifestInventory(descriptor),
    };
  });
}

export function validateDeliveryWaveRegistry() {
  const ids = new Set();
  const descriptorIds = new Set();
  for (const source of DELIVERY_WAVE_SOURCE_INSTANCES) {
    if (ids.has(source.instance_id) || descriptorIds.has(source.descriptor_id)) throw new Error('Delivery-wave instances must be unique by instance and descriptor.');
    ids.add(source.instance_id);
    descriptorIds.add(source.descriptor_id);
    if (![2, 3, 4, 6].includes(source.delivery_wave)) throw new Error('Only source connector waves 2, 3, 4, and 6 belong in the source-instance registry.');
    if (source.lifecycle !== 'fixture_only' || source.source_state !== 'paused' || source.coverage_cell_state !== 'candidate') throw new Error('Unactivated delivery-wave instances must remain paused candidates.');
    if (source.activation_authorized || source.live_network_permitted || source.external_authorization_gate !== 'AUTH-04') throw new Error('Delivery-wave activation boundary was violated.');
    if (source.legal_terms_review !== 'pending' || source.live_route_confirmation !== 'pending' || source.source_specific_promotion_receipt !== null) throw new Error('An unreviewed source cannot carry promotion evidence.');
    const descriptor = descriptorsById.get(source.descriptor_id);
    if (!descriptor || descriptor.source_state !== 'paused' || descriptor.legal_review.state !== 'pending') throw new Error('Source-instance descriptor is not fixture-only.');
  }
  if (descriptorIds.size !== APPROVED_SOURCE_DESCRIPTOR_TEMPLATES.length) throw new Error('Every disabled source descriptor must have exactly one delivery-wave instance.');
  return { source_instances: ids.size, waves: [...new Set(DELIVERY_WAVE_SOURCE_INSTANCES.map((source) => source.delivery_wave))].sort() };
}
