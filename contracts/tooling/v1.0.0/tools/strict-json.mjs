import fs from 'node:fs/promises';

const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxDepth: 128,
  maxNodes: 100_000,
  maxStringCodeUnits: 2 * 1024 * 1024
});

export class StrictJsonParseError extends SyntaxError {
  constructor(code, offset, message = code) {
    super(`${code} at UTF-16 offset ${offset}: ${message}`);
    this.name = 'StrictJsonParseError';
    this.code = code;
    this.offset = offset;
  }
}

function isWhitespace(character) {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r';
}

function isHex(character) {
  return character !== undefined && /^[0-9a-f]$/iu.test(character);
}

class Parser {
  constructor(text, limits) {
    this.text = text;
    this.index = 0;
    this.nodes = 0;
    this.limits = limits;
  }

  fail(code, message, offset = this.index) {
    throw new StrictJsonParseError(code, offset, message);
  }

  whitespace() {
    while (isWhitespace(this.text[this.index])) this.index += 1;
  }

  node(depth) {
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes) this.fail('JSON_NODE_LIMIT_EXCEEDED');
    if (depth > this.limits.maxDepth) this.fail('JSON_DEPTH_LIMIT_EXCEEDED');
  }

  parse(depth = 0) {
    this.whitespace();
    const value = this.value(depth);
    this.whitespace();
    if (this.index !== this.text.length) this.fail('JSON_TRAILING_CONTENT');
    return value;
  }

  value(depth) {
    this.node(depth);
    const character = this.text[this.index];
    if (character === '{') return this.object(depth);
    if (character === '[') return this.array(depth);
    if (character === '"') return this.string();
    if (character === 't') return this.literal('true', true);
    if (character === 'f') return this.literal('false', false);
    if (character === 'n') return this.literal('null', null);
    if (character === '-' || (character >= '0' && character <= '9')) return this.number();
    this.fail('JSON_EXPECTED_VALUE');
  }

  literal(token, value) {
    if (this.text.slice(this.index, this.index + token.length) !== token) {
      this.fail('JSON_INVALID_LITERAL');
    }
    this.index += token.length;
    return value;
  }

  number() {
    const start = this.index;
    const matcher = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy;
    matcher.lastIndex = this.index;
    const match = matcher.exec(this.text);
    if (!match) this.fail('JSON_INVALID_NUMBER', undefined, start);
    this.index = matcher.lastIndex;
    const next = this.text[this.index];
    if (next !== undefined && !isWhitespace(next) && next !== ',' && next !== ']' && next !== '}') {
      this.fail('JSON_INVALID_NUMBER', undefined, this.index);
    }
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.fail('JSON_NON_FINITE_NUMBER', undefined, start);
    return value;
  }

  string() {
    const start = this.index;
    this.index += 1;
    let result = '';
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      this.index += 1;
      if (character === '"') {
        this.assertUnicode(result, start);
        if (result.length > this.limits.maxStringCodeUnits) {
          this.fail('JSON_STRING_LIMIT_EXCEEDED', undefined, start);
        }
        return result;
      }
      if (character.charCodeAt(0) <= 0x1f) this.fail('JSON_UNESCAPED_CONTROL', undefined, this.index - 1);
      if (character !== '\\') {
        result += character;
        continue;
      }
      const escape = this.text[this.index];
      this.index += 1;
      const escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      if (Object.hasOwn(escapes, escape)) {
        result += escapes[escape];
      } else if (escape === 'u') {
        const hex = this.text.slice(this.index, this.index + 4);
        if (hex.length !== 4 || [...hex].some(character => !isHex(character))) {
          this.fail('JSON_INVALID_UNICODE_ESCAPE', undefined, this.index - 2);
        }
        result += String.fromCharCode(Number.parseInt(hex, 16));
        this.index += 4;
      } else {
        this.fail('JSON_INVALID_ESCAPE', undefined, this.index - 2);
      }
    }
    this.fail('JSON_UNTERMINATED_STRING', undefined, start);
  }

  assertUnicode(value, start) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) {
          this.fail('JSON_LONE_SURROGATE', undefined, start);
        }
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        this.fail('JSON_LONE_SURROGATE', undefined, start);
      }
    }
  }

  object(depth) {
    const result = {};
    const seen = new Set();
    this.index += 1;
    this.whitespace();
    if (this.text[this.index] === '}') {
      this.index += 1;
      return result;
    }
    while (this.index < this.text.length) {
      if (this.text[this.index] !== '"') this.fail('JSON_EXPECTED_OBJECT_KEY');
      const keyOffset = this.index;
      const key = this.string();
      if (seen.has(key)) this.fail('JSON_DUPLICATE_KEY', `duplicate decoded key ${JSON.stringify(key)}`, keyOffset);
      seen.add(key);
      this.whitespace();
      if (this.text[this.index] !== ':') this.fail('JSON_EXPECTED_COLON');
      this.index += 1;
      this.whitespace();
      const value = this.value(depth + 1);
      Object.defineProperty(result, key, { configurable: true, enumerable: true, value, writable: true });
      this.whitespace();
      if (this.text[this.index] === '}') {
        this.index += 1;
        return result;
      }
      if (this.text[this.index] !== ',') this.fail('JSON_EXPECTED_COMMA_OR_END');
      this.index += 1;
      this.whitespace();
    }
    this.fail('JSON_UNTERMINATED_OBJECT');
  }

  array(depth) {
    const result = [];
    this.index += 1;
    this.whitespace();
    if (this.text[this.index] === ']') {
      this.index += 1;
      return result;
    }
    while (this.index < this.text.length) {
      result.push(this.value(depth + 1));
      this.whitespace();
      if (this.text[this.index] === ']') {
        this.index += 1;
        return result;
      }
      if (this.text[this.index] !== ',') this.fail('JSON_EXPECTED_COMMA_OR_END');
      this.index += 1;
      this.whitespace();
    }
    this.fail('JSON_UNTERMINATED_ARRAY');
  }
}

/** Parse I-JSON while rejecting duplicate decoded object keys. */
export function parseStrictJson(text, options = {}) {
  if (typeof text !== 'string') throw new TypeError('STRICT_JSON_TEXT_REQUIRED');
  const limits = { ...DEFAULT_LIMITS, ...options };
  if (Buffer.byteLength(text, 'utf8') > limits.maxBytes) {
    throw new StrictJsonParseError('JSON_BYTE_LIMIT_EXCEEDED', 0);
  }
  if (text.charCodeAt(0) === 0xfeff) throw new StrictJsonParseError('JSON_BOM_NOT_ALLOWED', 0);
  return new Parser(text, limits).parse();
}

export async function readStrictJson(file, options = {}) {
  return parseStrictJson(await fs.readFile(file, 'utf8'), options);
}
