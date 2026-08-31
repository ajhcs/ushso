import { CatalogConnectorBase, validOptionalSourceTimestamp } from './base.mjs';

const ACTIVE_XML = /<!DOCTYPE|<!ENTITY|<script\b|<form\b/i;

function decodeXml(value = '') {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}

function element(value, name) {
  const match = value.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, ' ')) : null;
}

function parseRecords(xml) {
  const records = [];
  for (const match of xml.matchAll(/<record\b[^>]*>([\s\S]*?)<\/record>/gi)) {
    const block = match[1];
    const headerMatch = block.match(/<header\b([^>]*)>([\s\S]*?)<\/header>/i);
    if (!headerMatch) continue;
    const header = headerMatch[2];
    const identifier = element(header, 'identifier');
    const datestamp = element(header, 'datestamp');
    const setSpecs = [...header.matchAll(/<setSpec(?:\s[^>]*)?>([\s\S]*?)<\/setSpec>/gi)].map((entry) => decodeXml(entry[1]));
    const deleted = /\bstatus\s*=\s*["']deleted["']/i.test(headerMatch[1]);
    records.push({
      identifier, datestamp, set_specs: setSpecs, deleted,
      title: element(block, '(?:dc:)?title'),
      publisher: element(block, '(?:dc:)?publisher'),
    });
  }
  return records;
}

function resumptionToken(xml) {
  const match = xml.match(/<resumptionToken\b[^>]*>([\s\S]*?)<\/resumptionToken>/i);
  return match ? decodeXml(match[1]) : null;
}

function validateXml(xml) {
  if (ACTIVE_XML.test(xml) || !/<OAI-PMH\b/i.test(xml) || !/<ListRecords\b/i.test(xml)) return false;
  const records = parseRecords(xml);
  return records.every((item) => typeof item.identifier === 'string' && item.identifier.length > 0 && item.identifier.length <= 500 &&
    validOptionalSourceTimestamp(item.datestamp));
}

export class OaiPmhCatalogConnector extends CatalogConnectorBase {
  constructor(options) {
    super(options);
    this.metadataPrefix = options.metadataPrefix ?? 'oai_dc';
    this.set = options.set ?? null;
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(this.metadataPrefix) || (this.set !== null && !/^[A-Za-z0-9._:-]{1,200}$/.test(this.set))) {
      throw new TypeError('OAI-PMH metadataPrefix or set is invalid.');
    }
  }

  initialRequest(_plan, resume = null) {
    return resume?.nextRequest ?? {
      endpointId: this.endpointId, templateId: this.templateId, purpose: 'catalog_metadata', method: 'GET', targetClass: 'collection',
      pathParameters: {}, query: { verb: 'ListRecords', metadataPrefix: this.metadataPrefix, ...(this.set ? { set: this.set } : {}) },
    };
  }

  responseProfile() {
    return {
      allowXmlCatalogMetadata: true,
      validateText(value) {
        return validateXml(value)
          ? { accepted: true, classification: 'catalog_metadata' }
          : { accepted: false, reasonCode: 'OAI_PMH_SCHEMA_DRIFT', classification: 'schema_drift' };
      },
    };
  }

  parsePage({ bodyBytes, capture }) {
    const xml = new TextDecoder().decode(bodyBytes);
    if (!validateXml(xml)) throw new TypeError('OAI-PMH response failed the adapter schema.');
    const records = parseRecords(xml);
    const token = resumptionToken(xml);
    return {
      observations: records.map((item, index) => this.nativeObservation(item, index, capture)),
      nextRequest: token ? {
        endpointId: this.endpointId, templateId: this.templateId, purpose: 'catalog_metadata', method: 'GET', targetClass: 'pagination_cursor',
        pathParameters: {}, query: { verb: 'ListRecords', resumptionToken: token },
      } : null,
      cursor: token,
    };
  }

  nativeId(item) { return item.identifier; }
  publisherModifiedAt(item) { return item.datestamp; }
  nativePointer(index) { return `/OAI-PMH/ListRecords/record/${index}`; }
}

export { parseRecords as parseOaiPmhRecords };
