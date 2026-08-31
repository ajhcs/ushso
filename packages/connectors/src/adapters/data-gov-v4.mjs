import { CatalogConnectorBase, validOptionalSourceTimestamp } from './base.mjs';

function items(value) {
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.results)) return value.results;
  return null;
}

function sourceAgency(item) {
  const organization = item.organization ?? item.publisher ?? item.agency ?? null;
  if (typeof organization === 'string') return { native_id: null, name: organization };
  if (!organization || typeof organization !== 'object') return { native_id: null, name: null };
  return {
    native_id: organization.id == null ? null : String(organization.id).slice(0, 500),
    name: organization.title ?? organization.name ?? organization.label ?? null,
  };
}

function validItem(item) {
  const id = item?.identifier ?? item?.id ?? item?.['@id'];
  const agency = sourceAgency(item);
  return item && typeof item === 'object' && typeof id === 'string' && id.length > 0 && id.length <= 500 &&
    validOptionalSourceTimestamp(item.modified ?? item.metadata_modified ?? null) &&
    (agency.name === null || (typeof agency.name === 'string' && agency.name.length <= 2000));
}

export class DataGovV4CatalogConnector extends CatalogConnectorBase {
  initialRequest(_plan, resume = null) {
    return resume?.nextRequest ?? {
      endpointId: this.endpointId, templateId: this.templateId, purpose: 'catalog_metadata',
      method: 'GET', targetClass: 'collection', pathParameters: {}, query: { per_page: this.pageSize },
    };
  }

  responseProfile() {
    return {
      metadataCollectionPaths: ['/data'],
      validateJson(value) {
        const records = items(value);
        const valid = records && records.every(validItem) &&
          (value?.meta?.after == null || typeof value.meta.after === 'string') &&
          (value?.pagination?.after == null || typeof value.pagination.after === 'string');
        return valid
          ? { accepted: true, classification: 'catalog_metadata' }
          : { accepted: false, reasonCode: 'DATA_GOV_V4_SCHEMA_DRIFT', classification: 'schema_drift' };
      },
    };
  }

  parsePage({ parsed, capture }) {
    const records = items(parsed);
    const after = parsed?.meta?.after ?? parsed?.pagination?.after ?? null;
    const pointerRoot = Array.isArray(parsed?.data) ? '/data' : '/results';
    return {
      observations: records.map((item, index) => {
        const observation = this.nativeObservation(item, index, capture);
        observation.sourceLocator.nativePointer = `${pointerRoot}/${index}`;
        return observation;
      }),
      nextRequest: after ? {
        endpointId: this.endpointId, templateId: this.templateId, purpose: 'catalog_metadata',
        method: 'GET', targetClass: 'pagination_cursor', pathParameters: {}, query: { per_page: this.pageSize, after },
      } : null,
      cursor: after,
    };
  }

  normalize(observation) {
    const proposal = super.normalize(observation);
    const agency = sourceAgency(observation.metadata);
    return {
      ...proposal,
      aggregation_origin: {
        aggregator: 'Data.gov',
        originating_agency_native_id: agency.native_id,
        originating_agency_name: agency.name,
        preservation_state: agency.name ? 'source_asserted_preserved' : 'unknown_preserved',
      },
    };
  }

  nativeId(item) { return item.identifier ?? item.id ?? item['@id']; }
  publisherModifiedAt(item) { return item.modified ?? item.metadata_modified ?? null; }
  nativePointer(index) { return `/data/${index}`; }
}
