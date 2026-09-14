import { LAST_GOOD_GENERATION } from './qualify-deterministic.mjs';
import { publishMrfCoverage } from '../../../../registry/mrf-repository.mjs';

export { LAST_GOOD_GENERATION, publishMrfCoverage };

export function refuseSampleAsCompletePublication(record = {}) {
  const error = new Error(record.reason ?? 'MRF_SAMPLE_IS_NOT_COMPLETE_PUBLICATION');
  if (record.complete_hospital_publication === true || record.complete_payer_publication === true) {
    error.code = 'MRF_SAMPLE_IS_NOT_COMPLETE_PUBLICATION';
    throw error;
  }
  return Object.freeze({
    complete_hospital_publication: false,
    complete_payer_publication: false,
  });
}
