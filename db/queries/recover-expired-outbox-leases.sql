update ops.outbox
set state = 'published',
    lease_owner = null,
    lease_expires_at = null,
    published_at = clock_timestamp(),
    send_outcome = 'published_outcome_unknown',
    safe_detail_code = 'OUTBOX_SEND_OUTCOME_UNKNOWN_AWAITING_QUEUE_RETENTION'
where state = 'leased'
  and lease_expires_at <= clock_timestamp()
  and transport_retention_expires_at is not null
returning event_id, references_payload, attempt_count,
  maximum_delivery_attempts, transport_retention_expires_at;
