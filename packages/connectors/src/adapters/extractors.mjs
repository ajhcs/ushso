import { canonicalJson, sha256 } from '../canonical.mjs';

const FORM_OR_SCRIPT = /<(?:form|input|button|script|iframe|object|embed)\b/i;

export function extractDocumentation(html, { locator, observedAt, maximumSections = 100 } = {}) {
  if (typeof html !== 'string' || FORM_OR_SCRIPT.test(html)) throw new Error('Documentation extractor rejects forms, scripts, and embedded active content.');
  const sections = [];
  const expression = /<(h[1-4]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(expression)) {
    if (sections.length >= maximumSections) break;
    const text = match[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (text) sections.push({ kind: match[1].toLowerCase(), text: text.slice(0, 2000) });
  }
  const value = { locator, observed_at: observedAt, sections, truncated: [...html.matchAll(expression)].length > sections.length };
  return { ...value, semantic_sha256: sha256(canonicalJson(value)) };
}

export function extractSchemaMetadata(value, { locator, observedAt, maximumFields = 5000 } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Schema metadata must be an object.');
  if (Array.isArray(value.rows) || Array.isArray(value.data) || Array.isArray(value.observations)) throw new Error('Schema extractor rejects source data rows.');
  let fields;
  if (Array.isArray(value.fields)) fields = value.fields;
  else if (Array.isArray(value.columns)) fields = value.columns;
  else if (value.properties && typeof value.properties === 'object') fields = Object.entries(value.properties).map(([name, definition]) => ({ name, ...definition }));
  else throw new Error('Recognized fields, columns, or JSON Schema properties are required.');
  const bounded = fields.slice(0, maximumFields).map((field) => ({
    name: String(field.name ?? field.fieldName ?? field.id ?? '').slice(0, 256),
    label: field.label == null ? null : String(field.label).slice(0, 512),
    type: field.type == null && field.dataTypeName == null ? null : String(field.type ?? field.dataTypeName).slice(0, 128),
    description: field.description == null ? null : String(field.description).slice(0, 2000),
  }));
  if (bounded.some((field) => !field.name)) throw new Error('Every schema field requires a source-native name.');
  const result = { locator, observed_at: observedAt, fields: bounded, truncated: fields.length > bounded.length };
  return { ...result, semantic_sha256: sha256(canonicalJson(result)) };
}
