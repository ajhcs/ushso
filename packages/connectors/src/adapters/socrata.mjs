import { CatalogConnectorBase, validOptionalSourceTimestamp } from './base.mjs';

export class SocrataCatalogConnector extends CatalogConnectorBase {
  initialRequest(_plan, resume = null) {
    return resume?.nextRequest ?? {
      endpointId: this.endpointId, templateId: this.templateId, purpose: 'catalog_metadata',
      method: 'GET', targetClass: 'collection', pathParameters: {}, query: { limit: this.pageSize, offset: 0 },
    };
  }

  responseProfile() {
    const maximumRecords = this.responseLimits().maximum_records;
    return {
      metadataCollectionPaths: [''],
      validateJson(value) {
        if (!Array.isArray(value)) return { accepted: false, reasonCode: 'SOCRATA_METADATA_SCHEMA_DRIFT', classification: 'schema_drift' };
        if (value.length > maximumRecords) return { accepted: false, reasonCode: 'RECORD_CARDINALITY_EXCEEDED', classification: 'resource_limit' };
        const valid = value.every((item) => item && typeof item === 'object' &&
          typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 500 &&
          (typeof item.name === 'string' || typeof item.title === 'string') &&
          validOptionalSourceTimestamp(item.rowsUpdatedAt ?? item.metadata?.custom_fields?.updated_at ?? item.updatedAt ?? null) &&
          !('row' in item) && !('rows' in item));
        return valid
          ? { accepted: true, classification: 'catalog_metadata' }
          : { accepted: false, reasonCode: 'SOCRATA_METADATA_SCHEMA_DRIFT', classification: 'schema_drift' };
      },
    };
  }

  parsePage({ parsed, capture, request }) {
    const records = this.assertRecordCount(parsed);
    const limit = Number(request.query?.limit ?? this.pageSize);
    const offset = Number(request.query?.offset ?? 0);
    const nextOffset = offset + records.length;
    return {
      observations: records.map((item, index) => this.nativeObservation(item, index, capture)),
      nextRequest: records.length === limit ? {
        endpointId: this.endpointId, templateId: this.templateId, purpose: 'catalog_metadata',
        method: 'GET', targetClass: 'pagination_cursor', pathParameters: {}, query: { limit, offset: nextOffset },
      } : null,
      cursor: records.length === limit ? String(nextOffset) : null,
    };
  }

  nativeId(item) {
    return item.id;
  }

  publisherModifiedAt(item) {
    return item.rowsUpdatedAt ?? item.metadata?.custom_fields?.updated_at ?? item.updatedAt ?? null;
  }

  nativePointer(index) {
    return `/${index}`;
  }
}
