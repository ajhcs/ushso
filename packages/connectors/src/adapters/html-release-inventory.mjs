import { CatalogConnectorBase, validOptionalSourceTimestamp } from './base.mjs';

function decodeEntities(value) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function stripTags(value) {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function extractLinks(html) {
  const links = [];
  const expression = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(expression)) {
    const attributes = match[1];
    const href = attributes.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    const releaseId = attributes.match(/\bdata-release-id\s*=\s*["']([^"']+)["']/i)?.[1];
    const modified = attributes.match(/\bdata-modified\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
    if (href && releaseId) links.push({ id: releaseId, title: stripTags(match[2]), href: decodeEntities(href), modified });
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
    return {
      validateText(value) {
        const links = extractLinks(value);
        const valid = links.length > 0 && links.every((item) => item.id.length <= 500 && validOptionalSourceTimestamp(item.modified));
        return valid
          ? { accepted: true, classification: 'documentation' }
          : { accepted: false, reasonCode: 'HTML_RELEASE_INVENTORY_SCHEMA_DRIFT', classification: 'schema_drift' };
      },
    };
  }

  parsePage({ bodyBytes, capture }) {
    const html = new TextDecoder().decode(bodyBytes);
    const items = extractLinks(html);
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
