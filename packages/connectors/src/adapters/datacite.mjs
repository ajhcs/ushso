import { CatalogConnectorBase, validOptionalSourceTimestamp } from './base.mjs';

function validItem(item) {
  const attributes = item?.attributes;
  return item && typeof item === 'object' && item.type === 'dois' && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 500 &&
    attributes && typeof attributes === 'object' && !Array.isArray(attributes) &&
    (attributes.doi == null || typeof attributes.doi === 'string') &&
    Array.isArray(attributes.titles) && attributes.titles.every((title) => title && typeof title.title === 'string') &&
    validOptionalSourceTimestamp(attributes.updated ?? attributes.registered ?? attributes.published ?? null);
}

function nextPage(value, currentPage, endpoint) {
  if (value?.links?.next == null) return null;
  if (typeof value.links.next !== 'string' || value.links.next.length > 2000) throw new TypeError('DataCite next link is invalid.');
  const url = new URL(value.links.next);
  const base = new URL(endpoint.base_url);
  const route = endpoint.routes.find((candidate) => candidate.template_id === this.templateId);
  if (url.protocol !== 'https:' || url.origin !== base.origin || !route || url.pathname !== route.path_template) throw new TypeError('DataCite next link left the declared metadata route.');
  const page = Number(url.searchParams.get('page[number]'));
  if (!Number.isSafeInteger(page) || page <= currentPage || page > 1_000_000) throw new TypeError('DataCite next page is invalid.');
  return page;
}

export class DataCiteCatalogConnector extends CatalogConnectorBase {
  initialRequest(_plan, resume = null) {
    return resume?.nextRequest ?? {
      endpointId: this.endpointId, templateId: this.templateId, purpose: 'catalog_metadata',
      method: 'GET', targetClass: 'collection', pathParameters: {},
      query: { 'page[number]': 1, 'page[size]': this.pageSize },
    };
  }

  responseProfile() {
    const maximumRecords = this.responseLimits().maximum_records;
    return {
      metadataCollectionPaths: ['/data'],
      validateJson(value) {
        if (!(value && typeof value === 'object' && Array.isArray(value.data))) {
          return { accepted: false, reasonCode: 'DATACITE_DOIS_SCHEMA_DRIFT', classification: 'schema_drift' };
        }
        if (value.data.length > maximumRecords) return { accepted: false, reasonCode: 'RECORD_CARDINALITY_EXCEEDED', classification: 'resource_limit' };
        const valid = value.data.every(validItem) &&
          value.links && typeof value.links === 'object' && (value.links.next == null || typeof value.links.next === 'string');
        return valid
          ? { accepted: true, classification: 'catalog_metadata' }
          : { accepted: false, reasonCode: 'DATACITE_DOIS_SCHEMA_DRIFT', classification: 'schema_drift' };
      },
    };
  }

  parsePage({ parsed, capture, request }) {
    const records = this.assertRecordCount(parsed.data);
    const currentPage = Number(request.query?.['page[number]'] ?? 1);
    const endpoint = this._descriptor.endpoints.find((candidate) => candidate.endpoint_id === this.endpointId);
    const next = nextPage.call(this, parsed, currentPage, endpoint);
    return {
      observations: records.map((item, index) => this.nativeObservation(item, index, capture)),
      nextRequest: next ? {
        endpointId: this.endpointId, templateId: this.templateId, purpose: 'catalog_metadata',
        method: 'GET', targetClass: 'pagination_cursor', pathParameters: {},
        query: { 'page[number]': next, 'page[size]': this.pageSize },
      } : null,
      cursor: next ? String(next) : null,
    };
  }

  normalize(observation) {
    return {
      ...super.normalize(observation),
      authority_boundary: {
        record_authority: 'repository_registry_metadata',
        underlying_asset_authority: 'unverified',
        ranking_precedence: 'below_first_party_government',
      },
    };
  }

  nativeId(item) { return item.id; }
  publisherModifiedAt(item) { return item.attributes.updated ?? item.attributes.registered ?? item.attributes.published ?? null; }
  nativePointer(index) { return `/data/${index}`; }
}
