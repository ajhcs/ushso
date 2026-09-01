import { CatalogConnectorBase, validOptionalSourceTimestamp } from './base.mjs';

function isArcGisItem(item) {
  return item && typeof item === 'object' &&
    typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 500 &&
    typeof item.title === 'string' && item.title.length > 0 && item.title.length <= 2000 &&
    validOptionalSourceTimestamp(item.modified ?? item.created ?? null);
}

export class ArcGisCatalogConnector extends CatalogConnectorBase {
  constructor(options) {
    super(options);
    const fixedQuery = options.fixedQuery;
    if (typeof fixedQuery !== 'string' || fixedQuery.length < 1 || fixedQuery.length > 500 || /[\u0000-\u001f]/.test(fixedQuery)) {
      throw new TypeError('ArcGIS catalog enumeration requires one bounded declarative organization query.');
    }
    this.fixedQuery = fixedQuery;
  }

  initialRequest(_plan, resume = null) {
    return resume?.nextRequest ?? {
      endpointId: this.endpointId, templateId: this.templateId, purpose: 'catalog_metadata',
      method: 'GET', targetClass: 'collection', pathParameters: {},
      query: { f: 'json', q: this.fixedQuery, num: this.pageSize, start: 1 },
    };
  }

  responseProfile() {
    const maximumRecords = this.responseLimits().maximum_records;
    return {
      metadataCollectionPaths: ['/results'],
      validateJson(value) {
        if (!(value && typeof value === 'object' && Number.isInteger(value.total) && value.total >= 0 &&
          Number.isInteger(value.start) && value.start >= 1 && Number.isInteger(value.num) && value.num >= 0 &&
          Number.isInteger(value.nextStart) && Array.isArray(value.results))) {
          return { accepted: false, reasonCode: 'ARCGIS_SEARCH_SCHEMA_DRIFT', classification: 'schema_drift' };
        }
        if (value.results.length > maximumRecords) return { accepted: false, reasonCode: 'RECORD_CARDINALITY_EXCEEDED', classification: 'resource_limit' };
        const valid = value.results.every(isArcGisItem);
        return valid
          ? { accepted: true, classification: 'catalog_metadata' }
          : { accepted: false, reasonCode: 'ARCGIS_SEARCH_SCHEMA_DRIFT', classification: 'schema_drift' };
      },
    };
  }

  parsePage({ parsed, capture }) {
    const records = this.assertRecordCount(parsed.results);
    const nextStart = parsed.nextStart;
    const hasNext = nextStart > 0 && nextStart <= parsed.total && records.length > 0;
    return {
      observations: records.map((item, index) => this.nativeObservation(item, index, capture)),
      nextRequest: hasNext ? {
        endpointId: this.endpointId, templateId: this.templateId, purpose: 'catalog_metadata',
        method: 'GET', targetClass: 'pagination_cursor', pathParameters: {},
        query: { f: 'json', q: this.fixedQuery, num: this.pageSize, start: nextStart },
      } : null,
      cursor: hasNext ? String(nextStart) : null,
    };
  }

  nativeId(item) { return item.id; }
  publisherModifiedAt(item) { return item.modified ?? item.created ?? null; }
  nativePointer(index) { return `/results/${index}`; }
}
