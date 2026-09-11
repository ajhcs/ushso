// Prototype: a build-pinned derived index, never an authoritative catalog.
const verified = /* @__PURE__ */ new WeakMap();
const sha = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) => n.toString(16).padStart(2, "0")).join("");
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
async function loadLexicalArtifact(bytes, expected, recordIds) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 8 * 1024 * 1024) fail("LEXICAL_SIZE_INVALID");
  if (!expected || !/^[a-f0-9]{64}$/.test(expected.artifact_sha256 ?? "")) fail("LEXICAL_PIN_REQUIRED");
  if (await sha(bytes) !== expected.artifact_sha256) fail("LEXICAL_HASH_MISMATCH");
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("LEXICAL_JSON_INVALID");
  }
  if (value?.format !== "ushso.lexical-index.v1") fail("LEXICAL_FORMAT_INVALID");
  for (const key of ["generation", "corpus_sha256", "source_sha256", "vocabulary_sha256", "tokenizer_sha256"]) if (typeof expected[key] !== "string" || value[key] !== expected[key]) fail("LEXICAL_IDENTITY_MISMATCH:" + key);
  if (!Array.isArray(recordIds) || new Set(recordIds).size !== recordIds.length || recordIds.length > 1e4 || !Array.isArray(value.entries) || value.entries.length !== recordIds.length) fail("LEXICAL_RECORDS_INVALID");
  const map = /* @__PURE__ */ new Map();
  for (let i = 0; i < recordIds.length; i++) {
    const row = value.entries[i];
    if (!Array.isArray(row) || row.length !== 2 || row[0] !== recordIds[i] || !Array.isArray(row[1]) || row[1].length !== 3) fail("LEXICAL_RECORD_ORDER_INVALID");
    for (let f = 0; f < 3; f++) {
      const item = row[1][f];
      if (!item || Object.keys(item).sort().join(",") !== "kind,text,weight" || item.kind !== ["title", "description", "record"][f] || item.weight !== [10, 4, 2][f] || typeof item.text !== "string" || item.text.length > 512 * 1024 || !/^[a-z0-9 ]*$/.test(item.text)) fail("LEXICAL_FIELD_INVALID");
      Object.freeze(item);
    }
    map.set(row[0], Object.freeze(row[1]));
  }
  const token = Object.freeze({});
  verified.set(token, map);
  return token;
}
function consumeLexicalArtifact(token, recordIds) {
  const map = verified.get(token);
  const ids = map ? [...map.keys()] : [];
  if (!map || map.size !== recordIds.length || recordIds.some((id, i) => ids[i] !== id)) fail("LEXICAL_UNVERIFIED");
  return new Map(map);
}
export {
  consumeLexicalArtifact,
  loadLexicalArtifact
};
