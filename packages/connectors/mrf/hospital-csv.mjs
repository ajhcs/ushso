import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAST_GOOD_GENERATION } from '../../coverage/research-program/v1.0.0/src/qualify-deterministic.mjs';
import { extractHospitalJson, loadOfficialExample } from './hospital-json.mjs';

export const HOSPITAL_CSV_FORMAT = 'ushso.hospital-csv-mrf.v1';
export const PINNED_CMS_VERSION = '3.0.0';
export const PINNED_WIDE_BLOB_SHA = '3e180f9dab0f70ec04f0289bc3273734ca48e736';
export const PINNED_TALL_BLOB_SHA = '0db1f00764dc60379f42819c0a8cdc9562f38fbc';
export { LAST_GOOD_GENERATION };

function freeze(value) {
  return Object.freeze(value);
}

function fail(code, detail) {
  const error = new Error(detail ?? code);
  error.code = code;
  throw error;
}

function defaultFixtureDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../evaluation/research-program/mrf-fixtures/hospital-csv');
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = String(text ?? '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (char !== '\r') field += char;
  }
  if (quoted) fail('UNTERMINATED_QUOTED_FIELD');
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((cell) => String(cell).trim() !== ''));
}

export function classifyCsvLayout(rows) {
  if (!rows.length) fail('CSV_EMPTY');
  const first = rows[0].map((cell) => String(cell).trim());
  if (first[0] === 'description') fail('METADATA_ROW_REQUIRED');
  if (first[0] !== 'hospital_name') fail('UNSUPPORTED_CSV_LAYOUT', first[0]);
  const itemHeaderIndex = rows.findIndex((entry, index) => index > 0 && String(entry[0]).trim() === 'description');
  if (itemHeaderIndex < 0) fail('ITEM_HEADER_NOT_FOUND');
  const itemHeader = rows[itemHeaderIndex].map((cell) => String(cell).trim());
  const wide = itemHeader.some((header) => header.includes('|negotiated_dollar') || /standard_charge\|.+\|.+\|negotiated_dollar/.test(header));
  const tall = itemHeader.includes('payer_name') || itemHeader.includes('plan_name');
  if (wide === tall) fail('UNSUPPORTED_CSV_LAYOUT', 'ambiguous_wide_tall');
  return freeze({
    metadata_header: freeze(first),
    metadata_row: freeze(rows[1] ?? []),
    item_header_index: itemHeaderIndex,
    item_header: freeze(itemHeader),
    layout: wide ? 'wide' : 'tall',
    metadata_is_not_variable_schema: true,
  });
}

export function refuseGenericHeaderAsSchema(rows) {
  const first = (rows[0] ?? []).map((cell) => String(cell).trim());
  if (first[0] === 'hospital_name' && first.includes('version')) {
    fail('GENERIC_HEADER_CANNOT_BE_VARIABLE_SCHEMA');
  }
  return false;
}

function emptyToNull(value) {
  const raw = String(value ?? '').trim();
  return raw === '' ? null : raw;
}

function numberOrNull(value) {
  const raw = emptyToNull(value);
  if (raw == null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return freeze({ kind: 'malformed', raw, fabricated_zero: false });
  return parsed;
}

function chargeFromParts({ dollar, percentage, algorithm, methodology }) {
  if (algorithm != null && algorithm !== '') {
    return freeze({ kind: 'algorithm', comparable_dollar_price: false, value: algorithm });
  }
  if (percentage != null && percentage !== '') {
    const numeric = numberOrNull(percentage);
    return freeze({ kind: 'percentage', comparable_dollar_price: false, value: numeric });
  }
  const method = String(methodology ?? '').toLowerCase();
  if (method === 'per diem' || method === 'per-diem') {
    const numeric = numberOrNull(dollar);
    return freeze({ kind: 'per_diem', comparable_dollar_price: false, value: numeric, fabricated_zero: false });
  }
  if (dollar != null && dollar !== '') {
    const numeric = numberOrNull(dollar);
    if (numeric && typeof numeric === 'object' && numeric.kind === 'malformed') {
      return freeze({ kind: 'malformed', comparable_dollar_price: false, value: numeric.raw, fabricated_zero: false });
    }
    return freeze({ kind: 'dollar', comparable_dollar_price: true, value: numeric });
  }
  return freeze({ kind: 'unknown', comparable_dollar_price: false, value: null, fabricated_zero: false });
}

function splitCodes(header, row) {
  const codes = [];
  for (const [index, name] of header.entries()) {
    const normalized = name.replace(/\s+/g, '');
    const match = normalized.match(/^code\|?(\d+)$/) || normalized.match(/^code\|(\d+)$/);
    if (match) {
      const typeHeader = header.find((item) => item.replace(/\s+/g, '') === `code|${match[1]}|type` || item.replace(/\s+/g, '') === `code|${match[1]}|type`);
      const typeIndex = header.findIndex((item) => item.replace(/\s+/g, '') === `code|${match[1]}|type`);
      codes.push(freeze({
        code: emptyToNull(row[index]),
        system: typeIndex >= 0 ? emptyToNull(row[typeIndex]) : null,
        source_column: name,
      }));
    }
  }
  return freeze(codes.filter((code) => code.code));
}

export function extractWideCsv(text, { maxRows = 50 } = {}) {
  const rows = parseCsv(text);
  const layout = classifyCsvLayout(rows);
  if (layout.layout !== 'wide') fail('EXPECTED_WIDE_LAYOUT', layout.layout);
  const header = layout.item_header;
  const itemRows = rows.slice(layout.item_header_index + 1);
  const limited = itemRows.slice(0, maxRows);
  const items = limited.map((row, rowIndex) => {
    const payers = [];
    const seen = new Map();
    for (const [index, name] of header.entries()) {
      const match = name.match(/^standard_charge\|(.+)\|(.+)\|negotiated_(dollar|percentage|algorithm)$/);
      if (!match) continue;
      const key = `${match[1]}|${match[2]}`;
      if (!seen.has(key)) {
        seen.set(key, { payer_name: match[1], plan_name: match[2], dollar: null, percentage: null, algorithm: null, methodology: null });
      }
      const bucket = seen.get(key);
      if (match[3] === 'dollar') bucket.dollar = row[index];
      if (match[3] === 'percentage') bucket.percentage = row[index];
      if (match[3] === 'algorithm') bucket.algorithm = row[index];
    }
    for (const [index, name] of header.entries()) {
      const match = name.match(/^standard_charge\|(.+)\|(.+)\|methodology$/);
      if (match && seen.has(`${match[1]}|${match[2]}`)) seen.get(`${match[1]}|${match[2]}`).methodology = row[index];
    }
    for (const bucket of seen.values()) {
      payers.push(freeze({
        payer_name: bucket.payer_name,
        plan_name: bucket.plan_name,
        methodology: emptyToNull(bucket.methodology),
        charge: chargeFromParts(bucket),
        source_row: layout.item_header_index + 1 + rowIndex,
      }));
    }
    return freeze({
      description: emptyToNull(row[header.indexOf('description')]),
      codes: splitCodes(header, row),
      setting: emptyToNull(row[header.indexOf('setting')]),
      gross_charge: numberOrNull(row[header.indexOf('standard_charge|gross')]),
      discounted_cash: numberOrNull(row[header.indexOf('standard_charge|discounted_cash')]),
      payers: freeze(payers),
      source_row: layout.item_header_index + 1 + rowIndex,
      source_columns: freeze([...header]),
    });
  });
  return freeze({
    format: HOSPITAL_CSV_FORMAT,
    layout: 'wide',
    generation: LAST_GOOD_GENERATION,
    version: emptyToNull(layout.metadata_row[layout.metadata_header.indexOf('version')]),
    hospital_name: emptyToNull(layout.metadata_row[0]),
    synthetic: true,
    official_fictional_example: true,
    items: freeze(items),
    partial_sample: itemRows.length > maxRows,
    malformed_rows_visible: items.some((item) => item.payers.some((payer) => payer.charge.kind === 'malformed')),
    fabricated_zero_prices: false,
    metadata_is_not_variable_schema: true,
  });
}

export function extractTallCsv(text, { maxRows = 80 } = {}) {
  const rows = parseCsv(text);
  const layout = classifyCsvLayout(rows);
  if (layout.layout !== 'tall') fail('EXPECTED_TALL_LAYOUT', layout.layout);
  const header = layout.item_header;
  const itemRows = rows.slice(layout.item_header_index + 1);
  const limited = itemRows.slice(0, maxRows);
  const grouped = new Map();
  for (const [offset, row] of limited.entries()) {
    const description = emptyToNull(row[header.indexOf('description')]);
    const setting = emptyToNull(row[header.indexOf('setting')]);
    const key = `${description}|${setting}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        description,
        setting,
        codes: splitCodes(header, row),
        gross_charge: numberOrNull(row[header.findIndex((name) => name.replace(/\s+/g, '') === 'standard_charge|gross')]),
        discounted_cash: numberOrNull(row[header.findIndex((name) => name.replace(/\s+/g, '') === 'standard_charge|discounted_cash')]),
        payers: [],
      });
    }
    const dollarIndex = header.findIndex((name) => name.replace(/\s+/g, '') === 'standard_charge|negotiated_dollar');
    const percentIndex = header.findIndex((name) => name.replace(/\s+/g, '') === 'standard_charge|negotiated_percentage');
    const algoIndex = header.findIndex((name) => name.replace(/\s+/g, '') === 'standard_charge|negotiated_algorithm');
    const methodIndex = header.findIndex((name) => name.replace(/\s+/g, '') === 'standard_charge|methodology');
    grouped.get(key).payers.push(freeze({
      payer_name: emptyToNull(row[header.indexOf('payer_name')]),
      plan_name: emptyToNull(row[header.indexOf('plan_name')]),
      methodology: emptyToNull(row[methodIndex]),
      charge: chargeFromParts({
        dollar: row[dollarIndex],
        percentage: row[percentIndex],
        algorithm: row[algoIndex],
        methodology: row[methodIndex],
      }),
      source_row: layout.item_header_index + 1 + offset,
    }));
  }
  const items = [...grouped.values()].map((item) => freeze({ ...item, payers: freeze(item.payers), codes: freeze(item.codes) }));
  return freeze({
    format: HOSPITAL_CSV_FORMAT,
    layout: 'tall',
    generation: LAST_GOOD_GENERATION,
    version: emptyToNull(layout.metadata_row[layout.metadata_header.indexOf('version')]),
    hospital_name: emptyToNull(layout.metadata_row[0]),
    synthetic: true,
    official_fictional_example: true,
    items: freeze(items),
    partial_sample: itemRows.length > maxRows,
    malformed_rows_visible: items.some((item) => item.payers.some((payer) => payer.charge.kind === 'malformed')),
    fabricated_zero_prices: false,
    metadata_is_not_variable_schema: true,
  });
}

export function selectedCharges(extracted, { descriptions = null } = {}) {
  const wanted = descriptions ? new Set(descriptions) : null;
  const rows = [];
  for (const item of extracted.items ?? []) {
    if (wanted && !wanted.has(item.description)) continue;
    for (const payer of item.payers ?? item.charges?.flatMap((charge) => charge.payers) ?? []) {
      rows.push(freeze({
        description: item.description,
        setting: item.setting ?? payer.setting ?? null,
        payer_name: payer.payer_name,
        plan_name: payer.plan_name,
        kind: payer.charge.kind,
        value: payer.charge.value,
      }));
    }
  }
  return freeze(rows);
}

export function compareFixtureFormats({ json, wide, tall, descriptions = [
  'MRI of brain (no contrast)',
  'Inguinal hernia repair',
  'Major hip and knee joint replacement or reattachment of lower extremity without mcc',
  'Basic metabolic panel',
  'Aspirin 81 milligram chewable tablet',
] } = {}) {
  const pick = (rows) => rows
    .filter((row) => row.kind === 'dollar' && row.payer_name && row.plan_name)
    .map((row) => `${row.description}|${row.setting}|${row.payer_name}|${row.plan_name}|${row.value}`)
    .sort();
  const jsonSelected = selectedCharges({
    items: (json.items ?? []).map((item) => freeze({
      description: item.description,
      setting: item.charges?.[0]?.setting ?? null,
      payers: (item.charges ?? []).flatMap((charge) => (charge.payers ?? []).map((payer) => freeze({ ...payer, setting: charge.setting }))),
    })),
  }, { descriptions });
  const wideSelected = selectedCharges(wide, { descriptions });
  const tallSelected = selectedCharges(tall, { descriptions });
  const equal = JSON.stringify(pick(jsonSelected)) === JSON.stringify(pick(wideSelected))
    && JSON.stringify(pick(wideSelected)) === JSON.stringify(pick(tallSelected));
  return freeze({
    fixture_values_equivalent: equal,
    real_hospital_files_not_thereby_identical: true,
    json_count: pick(jsonSelected).length,
    wide_count: pick(wideSelected).length,
    tall_count: pick(tallSelected).length,
  });
}

export function loadOfficialWideCsv(dir = defaultFixtureDir()) {
  return readFileSync(path.join(dir, 'V3.0.0_Wide_CSV_Format_Example.csv'), 'utf8');
}

export function loadOfficialTallCsv(dir = defaultFixtureDir()) {
  return readFileSync(path.join(dir, 'V3.0.0_Tall_CSV_Format_Example.csv'), 'utf8');
}

export { extractHospitalJson, loadOfficialExample };
