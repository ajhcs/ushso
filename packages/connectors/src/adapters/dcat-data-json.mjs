import { CatalogConnectorBase, validOptionalSourceTimestamp } from './base.mjs';

function datasets(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.dataset)) return value.dataset;
  return null;
}

export class DcatDataJsonConnector extends CatalogConnectorBase {
  initialRequest(_plan, resume = null) {
    return resume?.nextRequest ?? {
      endpointId: this.endpointId,
      templateId: this.templateId,
      purpose: 'catalog_metadata',
      method: 'GET',
      targetClass: 'collection',
      pathParameters: {},
      query: {},
    };
  }

  responseProfile() {
    const maximumRecords = this.responseLimits().maximum_records;
    return {
      metadataCollectionPaths: ['', '/dataset'],
      validateJson(value) {
        const items = datasets(value);
        if (!items) return { accepted: false, reasonCode: 'DCAT_COLLECTION_SCHEMA_DRIFT', classification: 'schema_drift' };
        if (items.length > maximumRecords) return { accepted: false, reasonCode: 'RECORD_CARDINALITY_EXCEEDED', classification: 'resource_limit' };
        if (!items.every((item) => item && typeof item === 'object' &&
          ((typeof item.identifier === 'string' && item.identifier.length > 0 && item.identifier.length <= 500) || (typeof item['@id'] === 'string' && item['@id'].length > 0 && item['@id'].length <= 500)) &&
          validOptionalSourceTimestamp(item.modified ?? item.metadata?.updatedAt ?? null))) return { accepted: false, reasonCode: 'DCAT_COLLECTION_SCHEMA_DRIFT', classification: 'schema_drift' };
        return { accepted: true, classification: 'catalog_metadata' };
      },
    };
  }

  parsePage({ parsed, capture }) {
    const items = this.assertRecordCount(datasets(parsed));
    const pointerRoot = Array.isArray(parsed) ? '' : '/dataset';
    const observations = items.map((item, index) => {
      const observation = this.nativeObservation(item, index, capture);
      observation.sourceLocator.nativePointer = `${pointerRoot}/${index}`;
      return observation;
    });
    const nextCursor = typeof parsed?.next_cursor === 'string' && parsed.next_cursor ? parsed.next_cursor : null;
    return {
      observations,
      nextRequest: nextCursor ? {
        endpointId: this.endpointId, templateId: this.templateId, purpose: 'catalog_metadata',
        method: 'GET', targetClass: 'pagination_cursor', pathParameters: {}, query: { cursor: nextCursor },
      } : null,
      cursor: nextCursor,
    };
  }

  nativeId(item) {
    return item.identifier ?? item['@id'];
  }

  nativePointer(index) {
    return `/dataset/${index}`;
  }
}
