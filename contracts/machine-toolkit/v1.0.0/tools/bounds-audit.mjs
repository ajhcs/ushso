function token(pointer, value) {
  return `${pointer}/${String(value).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

function finiteString(schema) {
  return typeof schema.const === 'string' || (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every(value => typeof value === 'string'));
}

function visit(schema, pointer, findings, seen, composedClosed = false) {
  if (typeof schema === 'boolean') {
    if (schema) findings.push({ code: 'PUBLIC_SCHEMA_TRUE_UNBOUNDED', path: pointer });
    return;
  }
  if (!schema || typeof schema !== 'object' || seen.has(schema)) return;
  seen.add(schema);
  const types = typeof schema.type === 'string' ? [schema.type] : Array.isArray(schema.type) ? schema.type : [];
  const closesObject = schema.additionalProperties === false || schema.unevaluatedProperties === false;
  if (types.includes('object') && !closesObject && !composedClosed) findings.push({ code: 'PUBLIC_OBJECT_NOT_CLOSED', path: pointer });
  if (types.includes('object') && schema.patternProperties && !Number.isSafeInteger(schema.maxProperties)) findings.push({ code: 'PUBLIC_PATTERN_OBJECT_MAX_PROPERTIES_REQUIRED', path: pointer });
  if (types.includes('array') && !Number.isSafeInteger(schema.maxItems)) findings.push({ code: 'PUBLIC_ARRAY_MAX_ITEMS_REQUIRED', path: pointer });
  if (types.includes('string') && !finiteString(schema) && !Number.isSafeInteger(schema.maxLength)) findings.push({ code: 'PUBLIC_STRING_MAX_LENGTH_REQUIRED', path: pointer });
  for (const keyword of ['properties', 'patternProperties', '$defs', 'dependentSchemas']) {
    for (const [name, child] of Object.entries(schema[keyword] ?? {})) visit(child, token(token(pointer, keyword), name), findings, seen, false);
  }
  for (const keyword of ['items', 'contains', 'additionalProperties', 'unevaluatedProperties', 'propertyNames', 'not']) if (schema[keyword] && typeof schema[keyword] === 'object') visit(schema[keyword], token(pointer, keyword), findings, seen, false);
  for (const keyword of ['prefixItems', 'allOf', 'anyOf', 'oneOf']) (schema[keyword] ?? []).forEach((child, index) => visit(child, token(token(pointer, keyword), index), findings, seen, closesObject || composedClosed));
}

export function auditPublicSchemaBounds(rows) {
  const findings = [];
  for (const row of rows) {
    const local = [];
    visit(row.schema, '', local, new WeakSet(), false);
    for (const finding of local) findings.push({ schema: row.name, ...finding });
  }
  return { ok: findings.length === 0, findings };
}
