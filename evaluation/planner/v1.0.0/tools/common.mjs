import { createHash } from 'node:crypto';

export const canonicalize = value => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
};

export const canonicalJson = value => JSON.stringify(canonicalize(value));
export const prettyJson = value => `${JSON.stringify(value, null, 2)}\n`;
export const jsonl = values => `${values.map(value => canonicalJson(value)).join('\n')}\n`;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const sha256Id = bytes => `sha256:${sha256(bytes)}`;

export const parseJsonl = bytes => bytes.trim().split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));

export const uniqueSorted = values => [...new Set(values)].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));

export const deepEqual = (left, right) => canonicalJson(left) === canonicalJson(right);
