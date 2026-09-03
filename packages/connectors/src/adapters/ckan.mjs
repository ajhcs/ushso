import { CatalogConnectorBase, validOptionalSourceTimestamp } from './base.mjs';

export class CkanCatalogConnector extends CatalogConnectorBase {
  initialRequest(_plan, resume = null) {
    return resume?.nextRequest ?? {
      endpointId: this.endpointId, templateId: this.templateId, purpose: 'catalog_metadata',
      method: 'GET', targetClass: 'collection', pathParameters: {}, query: { start: 0, rows: this.pageSize },
    };
  }

  responseProfile() {
    const maximumRecords = this.responseLimits().maximum_records;
    return {
      metadataCollectionPaths: ['/result/results'],
      validateJson(value) {
        if (value?.success !== true || !Number.isInteger(value?.result?.count) || !Array.isArray(value?.result?.results)) {
          return { accepted: false, reasonCode: 'CKAN_PACKAGE_SEARCH_SCHEMA_DRIFT', classification: 'schema_drift' };
        }
        if (value.result.results.length > maximumRecords) return { accepted: false, reasonCode: 'RECORD_CARDINALITY_EXCEEDED', classification: 'resource_limit' };
        const valid = value.result.count >= 0 && value.result.results.every((item) => item && typeof item === 'object' &&
            typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 500 &&
            typeof item.name === 'string' && item.name.length > 0 &&
            validOptionalSourceTimestamp(item.metadata_modified ?? item.metadata_created ?? null));
        return valid
          ? { accepted: true, classification: 'catalog_metadata' }
          : { accepted: false, reasonCode: 'CKAN_PACKAGE_SEARCH_SCHEMA_DRIFT', classification: 'schema_drift' };
      },
    };
  }

  parsePage({ parsed, capture, request }) {
    const items = this.assertRecordCount(parsed.result.results);
    const start = Number(request.query?.start ?? 0);
    const rows = Number(request.query?.rows ?? this.pageSize);
    const nextStart = start + items.length;
    return {
      observations: items.map((item, index) => this.nativeObservation(item, index, capture)),
      nextRequest: nextStart < parsed.result.count ? {
        endpointId: this.endpointId, templateId: this.templateId, purpose: 'catalog_metadata',
        method: 'GET', targetClass: 'pagination_cursor', pathParameters: {}, query: { start: nextStart, rows },
      } : null,
      cursor: nextStart < parsed.result.count ? String(nextStart) : null,
    };
  }

  nativeId(item) {
    return item.id;
  }

  publisherModifiedAt(item) {
    return item.metadata_modified ?? item.metadata_created ?? null;
  }

  nativePointer(index) {
    return `/result/results/${index}`;
  }
}
