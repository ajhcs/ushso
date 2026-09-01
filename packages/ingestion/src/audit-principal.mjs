import { invariant } from './common.mjs';

export const SYSTEM_AUDIT_ACTOR_ID = 'ushso-ingestion-control-store';
export const SYSTEM_AUDIT_ACTOR_TYPE = 'system_reconciler';

export function resolveAuditActor(event, trustedPrincipalSource = null) {
  invariant(event && typeof event === 'object' && !Array.isArray(event), 'AUDIT_EVENT_INVALID');
  const claimedOperator = event.operatorId ?? event.actorId ?? null;
  if (claimedOperator == null) {
    return Object.freeze({
      actorId: SYSTEM_AUDIT_ACTOR_ID,
      actorType: SYSTEM_AUDIT_ACTOR_TYPE,
    });
  }
  invariant(typeof claimedOperator === 'string' && claimedOperator.length > 0, 'AUDIT_EVENT_INVALID');
  invariant(typeof trustedPrincipalSource === 'function', 'PRIVILEGED_PRINCIPAL_BINDING_REQUIRED');
  const trusted = trustedPrincipalSource({
    action: event.action,
    auditEventId: event.auditEventId,
    claimedOperatorId: claimedOperator,
  });
  invariant(
    trusted
      && typeof trusted.actorId === 'string'
      && trusted.actorId.length > 0
      && typeof trusted.actorType === 'string'
      && trusted.actorType.length > 0,
    'PRIVILEGED_PRINCIPAL_BINDING_REQUIRED',
  );
  invariant(trusted.actorId === claimedOperator, 'PRIVILEGED_PRINCIPAL_BINDING_MISMATCH', claimedOperator);
  return Object.freeze({ actorId: trusted.actorId, actorType: trusted.actorType });
}
