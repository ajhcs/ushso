export class ConnectorFailure extends Error {
  constructor(message, {
    failureType,
    safeDetailCode,
    targetClass,
    retryClass = 'quarantine',
    httpStatus = null,
    beforeEgress = false,
    quarantine = false,
    cause,
  }) {
    super(message, { cause });
    this.name = 'ConnectorFailure';
    this.failureType = failureType;
    this.safeDetailCode = safeDetailCode;
    this.targetClass = targetClass;
    this.retryClass = retryClass;
    this.httpStatus = httpStatus;
    this.beforeEgress = beforeEgress;
    this.quarantine = quarantine;
  }
}

export function failureRecord(error, observedAt) {
  if (!(error instanceof ConnectorFailure)) {
    return {
      failure_type: 'internal_failure',
      retry_class: 'transient',
      target_class: 'collection',
      safe_detail_code: 'UNCLASSIFIED_INTERNAL_FAILURE',
      http_status: null,
      observed_at: observedAt,
    };
  }
  return {
    failure_type: error.failureType,
    retry_class: error.retryClass,
    target_class: error.targetClass,
    safe_detail_code: error.safeDetailCode,
    http_status: error.httpStatus,
    observed_at: observedAt,
  };
}

export function policyFailure(safeDetailCode, targetClass, message = safeDetailCode) {
  return new ConnectorFailure(message, {
    failureType: 'policy_blocked',
    safeDetailCode,
    targetClass,
    retryClass: 'pause_source',
    beforeEgress: true,
  });
}
