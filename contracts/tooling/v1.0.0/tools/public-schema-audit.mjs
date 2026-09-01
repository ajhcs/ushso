function childPointer(pointer, token) {
  const encoded = String(token).replaceAll('~', '~0').replaceAll('/', '~1');
  return `${pointer}/${encoded}`;
}

function inferTypes(schema) {
  if (typeof schema?.type === 'string') return [schema.type];
  if (Array.isArray(schema?.type)) return schema.type;
  return [];
}

function hasFiniteStringDomain(schema) {
  return typeof schema.const === 'string'
    || (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every(value => typeof value === 'string'));
}

function visit(schema, pointer, findings, seen, objectFragment = false) {
  if (typeof schema === 'boolean') {
    if (schema) findings.push({ code: 'PUBLIC_SCHEMA_TRUE_UNBOUNDED', pointer });
    return;
  }
  if (!schema || typeof schema !== 'object' || seen.has(schema)) return;
  seen.add(schema);
  const types = inferTypes(schema);

  if (types.includes('object') && !objectFragment) {
    if (schema.additionalProperties !== false && schema.unevaluatedProperties !== false) {
      findings.push({ code: 'PUBLIC_OBJECT_NOT_CLOSED', pointer });
    }
    if (schema.patternProperties && !Number.isSafeInteger(schema.maxProperties)) {
      findings.push({ code: 'PUBLIC_PATTERN_OBJECT_MAX_PROPERTIES_REQUIRED', pointer });
    }
  }
  if (types.includes('array') && !Number.isSafeInteger(schema.maxItems)) {
    findings.push({ code: 'PUBLIC_ARRAY_MAX_ITEMS_REQUIRED', pointer });
  }
  if (types.includes('string') && !hasFiniteStringDomain(schema) && !Number.isSafeInteger(schema.maxLength)) {
    findings.push({ code: 'PUBLIC_STRING_MAX_LENGTH_REQUIRED', pointer });
  }

  for (const keyword of ['properties', 'patternProperties', '$defs', 'dependentSchemas']) {
    if (!schema[keyword] || typeof schema[keyword] !== 'object') continue;
    for (const [name, child] of Object.entries(schema[keyword])) {
      visit(child, childPointer(childPointer(pointer, keyword), name), findings, seen, false);
    }
  }
  for (const keyword of ['items', 'contains', 'additionalProperties', 'unevaluatedProperties', 'propertyNames', 'not']) {
    if (schema[keyword] && typeof schema[keyword] === 'object') {
      visit(schema[keyword], childPointer(pointer, keyword), findings, seen, false);
    }
  }
  for (const keyword of ['if', 'then', 'else']) {
    if (schema[keyword] && typeof schema[keyword] === 'object') {
      visit(schema[keyword], childPointer(pointer, keyword), findings, seen, true);
    }
  }
  for (const keyword of ['prefixItems', 'anyOf', 'oneOf']) {
    if (!Array.isArray(schema[keyword])) continue;
    schema[keyword].forEach((child, index) => visit(child, childPointer(childPointer(pointer, keyword), index), findings, seen, false));
  }
  if (Array.isArray(schema.allOf)) {
    const overlaysReference = schema.allOf.some(child => child && typeof child === 'object' && typeof child.$ref === 'string');
    schema.allOf.forEach((child, index) => {
      const overlay = overlaysReference && child && typeof child === 'object' && child.properties && !Array.isArray(child.required);
      visit(child, childPointer(childPointer(pointer, 'allOf'), index), findings, seen, Boolean(overlay));
    });
  }
}

/** Audit resource bounds and object closure for schemas exposed at a public boundary. */
export function auditPublicSchemaBounds(schemaRows) {
  const rows = Array.isArray(schemaRows) ? schemaRows : [{ name: 'schema', schema: schemaRows }];
  const findings = [];
  for (const row of rows) {
    const local = [];
    visit(row.schema, '', local, new WeakSet(), false);
    for (const finding of local) findings.push({ schema: row.name ?? row.schema?.$id ?? 'schema', ...finding });
  }
  findings.sort((left, right) => {
    const a = `${left.schema}${left.pointer}${left.code}`;
    const b = `${right.schema}${right.pointer}${right.code}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return { ok: findings.length === 0, schema_count: rows.length, findings };
}

export function assertPublicSchemaBounds(schemaRows) {
  const result = auditPublicSchemaBounds(schemaRows);
  if (!result.ok) {
    const error = new Error('PUBLIC_SCHEMA_BOUNDS_AUDIT_FAILED');
    error.code = 'PUBLIC_SCHEMA_BOUNDS_AUDIT_FAILED';
    error.findings = result.findings;
    throw error;
  }
  return result;
}
