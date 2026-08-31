import { CatalogConnectorBase, validOptionalSourceTimestamp } from './base.mjs';
import { DcatDataJsonConnector } from './dcat-data-json.mjs';

function candidateUrls(item) {
  const distributions = Array.isArray(item?.distribution) ? item.distribution : [];
  return distributions.flatMap((distribution) => [distribution?.accessURL, distribution?.downloadURL, distribution?.url])
    .concat([item?.accessURL, item?.landingPage]).filter((value) => typeof value === 'string');
}

export function classifyCmsReleaseLocators(item) {
  return [...new Set(candidateUrls(item))].map((locator) => {
    const path = new URL(locator).pathname;
    const locatorKind = /(?:^|[/_.-])latest(?:[/_.-]|$)/i.test(path)
      ? 'latest_alias'
      : /(?:^|[/_.-])(?:19|20)\d{2}(?:[-_/](?:0[1-9]|1[0-2]))?(?:[-_/](?:0[1-9]|[12]\d|3[01]))?(?:[/_.-]|$)/.test(path)
        ? 'immutable_release'
        : 'unclassified_public_locator';
    return { locator, locator_kind: locatorKind, retrieval_authorized: false };
  });
}

export class CmsDataCatalogConnector extends DcatDataJsonConnector {
  normalize(observation) {
    return {
      ...super.normalize(observation),
      cms_release_locators: classifyCmsReleaseLocators(observation.metadata),
      latest_is_immutable: false,
    };
  }
}

function providerItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return null;
}

function validProviderItem(item) {
  const id = item?.identifier ?? item?.id ?? item?.uuid;
  return item && typeof item === 'object' && typeof id === 'string' && id.length > 0 && id.length <= 500 &&
    (typeof item.title === 'string' || typeof item.name === 'string') &&
    validOptionalSourceTimestamp(item.modified ?? item.changed ?? item.updated ?? null);
}

export class CmsProviderDataCatalogConnector extends CatalogConnectorBase {
  initialRequest(_plan, resume = null) {
    return resume?.nextRequest ?? {
      endpointId: this.endpointId, templateId: this.templateId, purpose: 'catalog_metadata',
      method: 'GET', targetClass: 'collection', pathParameters: {}, query: {},
    };
  }

  responseProfile() {
    return {
      metadataCollectionPaths: ['/data'],
      validateJson(value) {
        const records = providerItems(value);
        return records && records.every(validProviderItem)
          ? { accepted: true, classification: 'catalog_metadata' }
          : { accepted: false, reasonCode: 'CMS_PROVIDER_METASTORE_SCHEMA_DRIFT', classification: 'schema_drift' };
      },
    };
  }

  parsePage({ parsed, capture }) {
    const records = providerItems(parsed);
    const pointerRoot = Array.isArray(parsed) ? '' : '/data';
    return {
      observations: records.map((item, index) => {
        const observation = this.nativeObservation(item, index, capture);
        observation.sourceLocator.nativePointer = `${pointerRoot}/${index}`;
        return observation;
      }),
      nextRequest: null,
      cursor: null,
    };
  }

  nativeId(item) { return item.identifier ?? item.id ?? item.uuid; }
  publisherModifiedAt(item) { return item.modified ?? item.changed ?? item.updated ?? null; }
  nativePointer(index) { return `/data/${index}`; }
}
