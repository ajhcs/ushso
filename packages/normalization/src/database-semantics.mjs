export function databaseImportSemanticErrors(bundle) {
  const errors = [];
  for (const [collection, rows] of Object.entries(bundle ?? {})) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if ((row.history?.supersedes_revision_ids?.length ?? 0) > 1) {
        errors.push({
          code: 'DB_LINEAR_HISTORY_MULTIPLE_PREDECESSORS',
          path: `/${collection}/${row.revision_id}/history/supersedes_revision_ids`,
          message: 'the WP6 selected-head ledger permits at most one immutable predecessor per revision'
        });
      }
    }
  }
  return errors;
}

export function assertDatabaseImportSemantics(bundle) {
  const errors = databaseImportSemanticErrors(bundle);
  if (errors.length > 0) {
    const error = new Error(`${errors[0].code}:${errors[0].path}`);
    error.code = errors[0].code;
    error.errors = errors;
    throw error;
  }
  return true;
}

