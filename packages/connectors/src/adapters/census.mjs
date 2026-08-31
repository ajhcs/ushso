import { DcatDataJsonConnector } from './dcat-data-json.mjs';

function datasetKey(value) {
  return `${value.year}/${value.datasetFamily}/${value.dataset}`;
}

export class CensusMetadataConnector extends DcatDataJsonConnector {
  constructor(options) {
    super(options);
    if (!Array.isArray(options.configuredDatasets) || options.configuredDatasets.length < 1 || options.configuredDatasets.length > 100) {
      throw new TypeError('Census variables discovery requires 1..100 configured datasets.');
    }
    this.configuredDatasets = new Set(options.configuredDatasets.map((value) => {
      const key = datasetKey(value);
      if (!/^\d{4}\/[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/.test(key)) throw new TypeError('Configured Census dataset is invalid.');
      return key;
    }));
    this.variablesEndpointId = options.variablesEndpointId;
    this.variablesTemplateId = options.variablesTemplateId;
  }

  variablesRequest(value) {
    const key = datasetKey(value);
    if (!this.configuredDatasets.has(key)) throw new Error('Census dataset is outside the configured metadata scope.');
    return {
      endpointId: this.variablesEndpointId, templateId: this.variablesTemplateId,
      purpose: 'schema', method: 'GET', targetClass: 'exact_item',
      pathParameters: { year: value.year, dataset_family: value.datasetFamily, dataset: value.dataset }, query: {},
    };
  }
}
