import { CatalogConnectorBase, validOptionalSourceTimestamp } from './base.mjs';

function validItem(item) {
  const id = item?.global_id ?? item?.identifier ?? (item?.entity_id == null ? null : String(item.entity_id));
  return item && typeof item === 'object' && (item.type === 'dataset' || item.type === 'dataverse') &&
    typeof id === 'string' && id.length > 0 && id.length <= 500 && typeof item.name === 'string' && item.name.length > 0 &&
    validOptionalSourceTimestamp(item.updated_at ?? item.published_at ?? item.created_at ?? null);
}

export class DataverseCatalogConnector extends CatalogConnectorBase {
  initialRequest(_plan, resume = null) {
    return resume?.nextRequest ?? {
      endpointId: this.endpointId, templateId: this.templateId, purpose: 'catalog_metadata',
      method: 'GET', targetClass: 'collection', pathParameters: {},
      query: { q: '*', type: 'dataset', per_page: this.pageSize, start: 0 },
    };
  }

  responseProfile() {
    const maximumRecords = this.responseLimits().maximum_records;
    return {
      metadataCollectionPaths: ['/data/items'],
      validateJson(value) {
        const data = value?.data;
        if (!(value?.status === 'OK' && data && typeof data === 'object' &&
          Number.isInteger(data.total_count) && data.total_count >= 0 &&
          Number.isInteger(data.start) && data.start >= 0 && Array.isArray(data.items))) {
          return { accepted: false, reasonCode: 'DATAVERSE_SEARCH_SCHEMA_DRIFT', classification: 'schema_drift' };
        }
        if (data.items.length > maximumRecords) return { accepted: false, reasonCode: 'RECORD_CARDINALITY_EXCEEDED', classification: 'resource_limit' };
        const valid = data.items.every(validItem);
        return valid
          ? { accepted: true, classification: 'catalog_metadata' }
          : { accepted: false, reasonCode: 'DATAVERSE_SEARCH_SCHEMA_DRIFT', classification: 'schema_drift' };
      },
    };
  }

  parsePage({ parsed, capture, request }) {
    const items = this.assertRecordCount(parsed.data.items);
    const start = Number(request.query?.start ?? parsed.data.start);
    const nextStart = start + items.length;
    const hasNext = items.length > 0 && nextStart < parsed.data.total_count;
    return {
      observations: items.map((item, index) => this.nativeObservation(item, index, capture)),
      nextRequest: hasNext ? {
        endpointId: this.endpointId, templateId: this.templateId, purpose: 'catalog_metadata',
        method: 'GET', targetClass: 'pagination_cursor', pathParameters: {},
        query: { q: '*', type: 'dataset', per_page: this.pageSize, start: nextStart },
      } : null,
      cursor: hasNext ? String(nextStart) : null,
    };
  }

  normalize(observation) {
    return {
      ...super.normalize(observation),
      authority_boundary: {
        record_authority: 'repository_metadata',
        installation: new URL(this._descriptor.endpoints.find((entry) => entry.endpoint_id === this.endpointId).base_url).hostname,
        ranking_precedence: 'below_first_party_government',
      },
    };
  }

  nativeId(item) { return item.global_id ?? item.identifier ?? String(item.entity_id); }
  publisherModifiedAt(item) { return item.updated_at ?? item.published_at ?? item.created_at ?? null; }
  nativePointer(index) { return `/data/items/${index}`; }
}
