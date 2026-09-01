import { runPsql } from '../../../db/tools/common.mjs';
import { reconcileNormalizationDatabaseWorkset } from './ingestion-boundary.mjs';

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u;

export function readNormalizationDatabaseWorkset({
  runId,
  container = null,
  database = 'ushso',
  user = 'ushso_normalize'
}) {
  if (!RUN_ID.test(runId ?? '')) throw new TypeError('runId is invalid');
  const output = runPsql({
    container,
    database,
    user,
    tuplesOnly: true,
    sql: `select jsonb_build_object(
      'manifest', (select to_jsonb(manifest) from ingest.normalization_manifests manifest where manifest.run_id='${runId}'),
      'manifestItems', coalesce((
        select jsonb_agg(to_jsonb(item) order by item.ordinal)
        from ingest.normalization_manifest_items item where item.run_id='${runId}'
      ), '[]'::jsonb),
      'requirements', coalesce((
        select jsonb_agg(to_jsonb(requirement) order by requirement.capture_reference_id)
        from ingest.normalization_job_requirements requirement where requirement.run_id='${runId}'
      ), '[]'::jsonb),
      'jobs', coalesce((
        select jsonb_agg(to_jsonb(job) order by job.job_id)
        from ingest.jobs job
        where job.job_type='normalize_record'
          and exists (
            select 1
            from ingest.normalization_job_requirements requirement
            where requirement.run_id='${runId}'
              and requirement.job_id=job.job_id
          )
      ), '[]'::jsonb),
      'outbox', coalesce((
        select jsonb_agg(to_jsonb(event) order by event.event_id)
        from ops.outbox event
        where event.event_type='normalize_requested'
          and exists (
            select 1
            from ingest.normalization_job_requirements requirement
            where requirement.run_id='${runId}'
              and requirement.outbox_event_id=event.event_id
          )
      ), '[]'::jsonb),
      'manifestDigestVerified', coalesce((
        select manifest.manifest_sha256 = encode(sha256(convert_to(coalesce((
          select jsonb_agg(jsonb_build_object(
            'capture_reference_id', item.capture_reference_id,
            'capture_sha256', item.capture_sha256,
            'normalizer_version', item.normalizer_version
          ) order by item.capture_sha256, item.capture_reference_id)
          from ingest.normalization_manifest_items item where item.run_id=manifest.run_id
        ), '[]'::jsonb)::text, 'UTF8')), 'hex')
        from ingest.normalization_manifests manifest where manifest.run_id='${runId}'
      ), false)
    )::text;`
  }).stdout.trim();
  if (!output) throw new Error('NORMALIZATION_DATABASE_WORKSET_NOT_FOUND');
  return JSON.parse(output);
}

export function reconcileNormalizationRun(options) {
  return reconcileNormalizationDatabaseWorkset(readNormalizationDatabaseWorkset(options));
}
