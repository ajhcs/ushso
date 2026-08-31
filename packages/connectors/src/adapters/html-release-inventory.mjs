import { CatalogConnectorBase, validOptionalSourceTimestamp } from './base.mjs';
import { ConnectorResponseLimitError, DEFAULT_RESPONSE_LIMITS } from '../route-manifest.mjs';

function decodeEntities(value) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function stripTags(value) {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function extractLinks(html, maximumLinks = DEFAULT_RESPONSE_LIMITS.maximum_links) {
  const links = [];
  const expression = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(expression)) {
    const attributes = match[1];
    const href = attributes.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    const releaseId = attributes.match(/\bdata-release-id\s*=\s*["']([^"']+)["']/i)?.[1];
    const modified = attributes.match(/\bdata-modified\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
    if (href && releaseId) {
      if (links.length >= maximumLinks) throw new ConnectorResponseLimitError('LINK_CARDINALITY_EXCEEDED', 'HTML release links exceed their permitted cardinality.');
      links.push({ id: releaseId, title: stripTags(match[2]), href: decodeEntities(href), modified });
    }
  }
  return links;
}

export class HtmlReleaseInventoryConnector extends CatalogConnectorBase {
  initialRequest(_plan, resume = null) {
    return resume?.nextRequest ?? {
      endpointId: this.endpointId, templateId: this.templateId, purpose: 'documentation',
      method: 'GET', targetClass: 'collection', pathParameters: {}, query: {},
    };
  }

  responseProfile() {
    const maximumLinks = this.responseLimits().maximum_links;
    return {
      validateText(value) {
        let links;
        try {
          links = extractLinks(value, maximumLinks);
        } catch (error) {
          return { accepted: false, reasonCode: error.reasonCode ?? 'HTML_RELEASE_INVENTORY_SCHEMA_DRIFT', classification: 'schema_drift' };
        }
        const valid = links.length > 0 && links.every((item) => item.id.length <= 500 && validOptionalSourceTimestamp(item.modified));
        return valid
          ? { accepted: true, classification: 'documentation' }
          : { accepted: false, reasonCode: 'HTML_RELEASE_INVENTORY_SCHEMA_DRIFT', classification: 'schema_drift' };
      },
    };
  }

  parsePage({ bodyBytes, capture }) {
    const html = new TextDecoder().decode(bodyBytes);
    const items = this.assertLinkCount(extractLinks(html, this.responseLimits().maximum_links));
    if (items.length === 0) throw new Error('HTML inventory contains no explicitly labeled release links.');
    return {
      observations: items.map((item, index) => this.nativeObservation(item, index, capture)),
      nextRequest: null,
      cursor: null,
    };
  }

  nativeId(item) {
    return item.id;
  }

  publisherModifiedAt(item) {
    return item.modified;
  }

  nativePointer(index) {
    return `/release-link/${index}`;
  }
}

export { extractLinks as extractReleaseLinks };
