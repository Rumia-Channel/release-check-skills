'use strict';

/**
 * Shared zero-dependency safety, JSON preflight, path/ID, and JSON Schema helpers
 * for release-check audit validators across POSIX and Windows hosts.
 */

const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const AXES = Object.freeze([
  'primary',
  'boundary',
  'error',
  'integration',
  'compatibility',
  'lifecycle',
]);

const LIMITS = Object.freeze({
  inputBytes: 5 * 1024 * 1024,
  maxUnits: 10000,
  maxFeatures: 5000,
  maxFindings: 1000,
  collectionItems: 1000,
  objectFields: 1000,
  nestingDepth: 64,
  preflightValues: 500000,
  canonicalKeyBytes: 1024 * 1024,
  uniqueSetBytes: 5 * 1024 * 1024,
  validationErrors: 100,
  maxTextLength: 4096,
});

const SUPPORTED_TYPES = new Set([
  'object',
  'array',
  'string',
  'integer',
  'number',
  'boolean',
  'null',
]);

const SUPPORTED_KEYWORDS = new Set([
  '$comment',
  'additionalProperties',
  'const',
  'description',
  'enum',
  'items',
  'minimum',
  'minItems',
  'minLength',
  'oneOf',
  'pattern',
  'properties',
  'required',
  'type',
  'uniqueItems',
  'visibleContent',
]);

const FINGERPRINT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
const FEATURE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;
const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const WINDOWS_RESERVED_AGENT_ID = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const VISIBLE_CONTENT = /[^\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const PATH_FORBIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const WINDOWS_RESERVED_COMPONENT = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/iu;
const UNSAFE_DIAGNOSTIC_CHARACTER = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const MAX_DIAGNOSTIC_STRING_LENGTH = 256;

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

class JsonStructureError extends Error {}
class SafeInputError extends Error {}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function escapeUnsafeDiagnosticCharacters(value) {
  return String(value).replace(UNSAFE_DIAGNOSTIC_CHARACTER, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0xffff
      ? `\\u${codePoint.toString(16).padStart(4, '0')}`
      : `\\u{${codePoint.toString(16)}}`;
  });
}

function safeQuote(value) {
  let serialized;
  if (typeof value === 'string') {
    const clipped = value.length > MAX_DIAGNOSTIC_STRING_LENGTH
      ? `${value.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)}...`
      : value;
    serialized = JSON.stringify(clipped);
  } else if (value === null || typeof value === 'boolean') {
    serialized = String(value);
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    serialized = String(value);
  } else {
    serialized = `"<${Array.isArray(value) ? 'array' : typeof value}>"`;
  }
  return escapeUnsafeDiagnosticCharacters(serialized);
}

function propertyPath(base, key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    ? `${base}.${key}`
    : `${base}[${safeQuote(key)}]`;
}

function createErrorList(limit = LIMITS.validationErrors) {
  const errors = [];
  Object.defineProperty(errors, 'push', {
    value(...messages) {
      const remaining = limit - this.length;
      if (remaining > 0) {
        Array.prototype.push.apply(
          this,
          messages.slice(0, remaining).map(escapeUnsafeDiagnosticCharacters),
        );
      }
      return this.length;
    },
  });
  return errors;
}

function deepEqual(left, right) {
  if (left === right) return true;
  if (typeOf(left) !== typeOf(right)) return false;
  if (Array.isArray(left)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (isObject(left)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => hasOwn(right, key) && deepEqual(left[key], right[key]));
  }
  return false;
}

function codePointLength(value) {
  let length = 0;
  let index = 0;
  while (index < value.length) {
    const first = value.charCodeAt(index++);
    if (first >= 0xd800 && first <= 0xdbff && index < value.length) {
      const second = value.charCodeAt(index);
      if (second >= 0xdc00 && second <= 0xdfff) index++;
    }
    length++;
  }
  return length;
}

function hasValidUnicodeScalarValues(value) {
  let index = 0;
  while (index < value.length) {
    const first = value.charCodeAt(index++);
    if (first >= 0xd800 && first <= 0xdbff) {
      if (index >= value.length) return false;
      const second = value.charCodeAt(index++);
      if (second < 0xdc00 || second > 0xdfff) return false;
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function hasVisibleProse(value) {
  return hasValidUnicodeScalarValues(value) && VISIBLE_CONTENT.test(value);
}

function isVisibleText(value, maxLength = LIMITS.maxTextLength) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    hasVisibleProse(value);
}

function isCanonicalRef(value) {
  return isVisibleText(value, 1024) &&
    !PATH_FORBIDDEN_CHARACTER.test(value) &&
    value.normalize('NFC') === value;
}

function encodeCanonicalRef(value) {
  if (!isCanonicalRef(value)) throw new TypeError('invalid canonical reference');
  let encoded = '';
  for (const byte of Buffer.from(value, 'utf8')) {
    const unreserved =
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      (byte >= 0x30 && byte <= 0x39) ||
      byte === 0x2d || byte === 0x2e || byte === 0x5f || byte === 0x7e;
    encoded += unreserved
      ? String.fromCharCode(byte)
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return encoded;
}

function isSafeRelativePath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    !hasValidUnicodeScalarValues(value) ||
    value.trim() !== value ||
    PATH_FORBIDDEN_CHARACTER.test(value) ||
    value.includes('\\') ||
    value.includes(':')
  ) {
    return false;
  }
  if (
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[A-Za-z]:/.test(value) ||
    value.startsWith('~')
  ) {
    return false;
  }
  return value.split('/').every((segment) =>
    segment !== '' &&
    segment !== '.' &&
    segment !== '..' &&
    !/[ .]$/u.test(segment) &&
    !WINDOWS_RESERVED_COMPONENT.test(segment),
  );
}

function isSafeEntrypointRef(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  const hashIndex = value.indexOf('#');
  if (hashIndex === -1) return isSafeRelativePath(value);
  const filePart = value.slice(0, hashIndex);
  const symbolPart = value.slice(hashIndex + 1);
  return isSafeRelativePath(filePart) &&
    isVisibleText(symbolPart, 1024) &&
    !PATH_FORBIDDEN_CHARACTER.test(symbolPart);
}

function isSafeAgentId(value) {
  return typeof value === 'string' &&
    AGENT_ID_PATTERN.test(value) &&
    !WINDOWS_RESERVED_AGENT_ID.test(value);
}

function isOwnedArtifactPath(value, agentId) {
  if (!isSafeAgentId(agentId) || !isSafeRelativePath(value)) return false;
  const prefix = `agents/${agentId}/artifacts/`;
  return value.startsWith(prefix) && value.length > prefix.length;
}

function readDescriptorWithinLimit(descriptor, maxBytes, expectedStat = null) {
  const stat = fs.fstatSync(descriptor);
  if (!stat.isFile()) throw new SafeInputError('input must be a regular file');
  if (expectedStat && (stat.dev !== expectedStat.dev || stat.ino !== expectedStat.ino)) {
    throw new SafeInputError('input file identity changed during open');
  }
  if (stat.size > maxBytes) throw new SafeInputError(`input exceeds ${maxBytes} byte limit`);

  const chunks = [];
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let bytesRead = 0;
  while (true) {
    const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
    if (count === 0) break;
    bytesRead += count;
    if (bytesRead > maxBytes) throw new SafeInputError(`input exceeds ${maxBytes} byte limit`);
    chunks.push(Buffer.from(buffer.subarray(0, count)));
  }

  const afterStat = fs.fstatSync(descriptor);
  if (
    !afterStat.isFile() ||
    afterStat.dev !== stat.dev ||
    afterStat.ino !== stat.ino ||
    afterStat.size !== bytesRead
  ) {
    throw new SafeInputError('input changed while reading');
  }

  try {
    return UTF8_DECODER.decode(Buffer.concat(chunks, bytesRead));
  } catch {
    throw new SafeInputError('input is not valid UTF-8');
  }
}

/**
 * Safely read a regular UTF-8 file within maxBytes, rejecting symlinks and special files
 * on both POSIX (O_NOFOLLOW | O_NONBLOCK) and Windows (lstatSync + descriptor identity verify).
 */
function readFileWithinLimit(file, maxBytes = LIMITS.inputBytes) {
  const noFollow = fs.constants.O_NOFOLLOW;
  const nonBlock = fs.constants.O_NONBLOCK;
  const hasPosixFlags =
    Number.isInteger(noFollow) && noFollow !== 0 &&
    Number.isInteger(nonBlock) && nonBlock !== 0;

  if (hasPosixFlags) {
    let descriptor;
    try {
      descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow | nonBlock);
    } catch (error) {
      if (error && (error.code === 'ELOOP' || error.code === 'EMLINK')) {
        throw new SafeInputError('input must not be a symlink');
      }
      throw error;
    }
    try {
      return readDescriptorWithinLimit(descriptor, maxBytes);
    } finally {
      fs.closeSync(descriptor);
    }
  }

  if (process.platform === 'win32') {
    const preStat = fs.lstatSync(file);
    if (preStat.isSymbolicLink()) throw new SafeInputError('input must not be a symlink');
    if (!preStat.isFile()) throw new SafeInputError('input must be a regular file');
    if (preStat.size > maxBytes) throw new SafeInputError(`input exceeds ${maxBytes} byte limit`);

    const descriptor = fs.openSync(file, fs.constants.O_RDONLY);
    try {
      return readDescriptorWithinLimit(descriptor, maxBytes, preStat);
    } finally {
      fs.closeSync(descriptor);
    }
  }

  throw new SafeInputError('OS no-follow and nonblocking input protection is unavailable');
}

function preflightJsonText(contents, options = {}) {
  const {
    maxTopLevelItems = LIMITS.collectionItems,
    topLevelLabel = 'item',
  } = options;
  const containers = [];
  let rootState = 'value';
  let inString = false;
  let escaped = false;
  let totalValues = 0;

  function fail(message) {
    throw new JsonStructureError(`input ${message}`);
  }

  function currentContainer() {
    return containers[containers.length - 1];
  }

  function countValue() {
    totalValues++;
    if (totalValues > LIMITS.preflightValues) {
      fail(`exceeds ${LIMITS.preflightValues} total value limit`);
    }
  }

  function beginValue() {
    const container = currentContainer();
    if (!container) {
      if (rootState !== 'value') fail('has malformed JSON structure');
      rootState = 'end';
    } else if (container.type === 'array') {
      if (container.state !== 'firstValueOrEnd' && container.state !== 'value') {
        fail('has malformed JSON array structure');
      }
      container.items++;
      const limit = container.topLevel ? maxTopLevelItems : LIMITS.collectionItems;
      if (container.items > limit) {
        fail(
          container.topLevel
            ? `exceeds ${limit} top-level ${topLevelLabel} limit`
            : `exceeds ${limit} item array limit`,
        );
      }
      container.state = 'commaOrEnd';
    } else {
      if (container.state !== 'value') fail('has malformed JSON object structure');
      container.state = 'commaOrEnd';
    }
    countValue();
  }

  function beginString() {
    const container = currentContainer();
    if (
      container &&
      container.type === 'object' &&
      (container.state === 'firstKeyOrEnd' || container.state === 'key')
    ) {
      container.fields++;
      if (container.fields > LIMITS.objectFields) {
        fail(`exceeds ${LIMITS.objectFields} field object limit`);
      }
      container.state = 'colon';
    } else {
      beginValue();
    }
    inString = true;
  }

  function beginContainer(type) {
    beginValue();
    if (containers.length >= LIMITS.nestingDepth) {
      fail(`exceeds nesting depth limit ${LIMITS.nestingDepth}`);
    }
    containers.push(
      type === 'array'
        ? { type, state: 'firstValueOrEnd', items: 0, topLevel: containers.length === 0 }
        : { type, state: 'firstKeyOrEnd', fields: 0 },
    );
  }

  function closeContainer(type) {
    const container = currentContainer();
    if (!container || container.type !== type) fail('has mismatched JSON containers');
    const canClose = container.state === 'firstValueOrEnd' ||
      container.state === 'firstKeyOrEnd' ||
      container.state === 'commaOrEnd';
    const valid = type === 'array'
      ? container.state === 'firstValueOrEnd' || container.state === 'commaOrEnd'
      : container.state === 'firstKeyOrEnd' || container.state === 'commaOrEnd';
    if (!canClose || !valid) fail(`has malformed JSON ${type} structure`);
    containers.pop();
  }

  function isWhitespace(ch) {
    return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
  }

  function isTokenDelimiter(ch) {
    return isWhitespace(ch) || ch === ',' || ch === ':' ||
      ch === '[' || ch === ']' || ch === '{' || ch === '}' || ch === '"';
  }

  for (let index = 0; index < contents.length; index++) {
    const ch = contents[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (isWhitespace(ch)) continue;

    if (ch === '"') {
      beginString();
    } else if (ch === '[') {
      beginContainer('array');
    } else if (ch === '{') {
      beginContainer('object');
    } else if (ch === ']') {
      closeContainer('array');
    } else if (ch === '}') {
      closeContainer('object');
    } else if (ch === ':') {
      const container = currentContainer();
      if (!container || container.type !== 'object' || container.state !== 'colon') {
        fail('has malformed JSON object structure');
      }
      container.state = 'value';
    } else if (ch === ',') {
      const container = currentContainer();
      if (!container || container.state !== 'commaOrEnd') {
        fail('has malformed JSON collection structure');
      }
      container.state = container.type === 'array' ? 'value' : 'key';
    } else {
      beginValue();
      while (index + 1 < contents.length && !isTokenDelimiter(contents[index + 1])) index++;
    }
  }

  if (inString) fail('has an unterminated JSON string');
  if (containers.length > 0) fail('has truncated JSON structure');
  if (rootState !== 'end') fail('has no JSON value');
}

function preflightDocument(root, options = {}) {
  const { maxTopLevelItems = LIMITS.collectionItems } = options;
  const errors = createErrorList();
  const stack = [{ value: root, depth: 0, location: '$' }];
  const seen = new WeakSet();
  let visited = 0;

  while (stack.length > 0) {
    const { value, depth, location } = stack.pop();
    visited++;
    if (visited > LIMITS.preflightValues) {
      errors.push(`$: exceeds ${LIMITS.preflightValues} total values`);
      return errors;
    }
    if (value === null || typeof value !== 'object') continue;
    if (depth >= LIMITS.nestingDepth) {
      errors.push(`${location}: exceeds nesting depth limit ${LIMITS.nestingDepth}`);
      return errors;
    }
    if (seen.has(value)) {
      errors.push(`${location}: input must not contain repeated or cyclic object references`);
      return errors;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      const limit = location === '$' ? maxTopLevelItems : LIMITS.collectionItems;
      if (value.length > limit) {
        errors.push(`${location}: exceeds ${limit} entries`);
        return errors;
      }
      for (let index = value.length - 1; index >= 0; index--) {
        stack.push({ value: value[index], depth: depth + 1, location: `${location}[${index}]` });
      }
      continue;
    }

    const keys = Object.keys(value);
    if (keys.length > LIMITS.objectFields) {
      errors.push(`${location}: exceeds ${LIMITS.objectFields} object fields`);
      return errors;
    }
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      stack.push({
        value: value[key],
        depth: depth + 1,
        location: propertyPath(location, key),
      });
    }
  }

  return errors;
}

function canonicalKey(value) {
  const chunks = [];
  let bytes = 0;

  function append(chunk) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > LIMITS.canonicalKeyBytes) {
      throw new Error(`canonical key exceeds ${LIMITS.canonicalKeyBytes} byte limit`);
    }
    chunks.push(chunk);
  }

  function encode(item) {
    const t = typeOf(item);
    if (t === 'null') {
      append('null');
    } else if (t === 'string') {
      append(`string:${JSON.stringify(item)}`);
    } else if (t === 'number') {
      append(`number:${Object.is(item, -0) ? '0' : String(item)}`);
    } else if (t === 'boolean') {
      append(`boolean:${item ? 'true' : 'false'}`);
    } else if (t === 'array') {
      append('array:[');
      item.forEach((entry, index) => {
        if (index > 0) append(',');
        encode(entry);
      });
      append(']');
    } else if (t === 'object') {
      append('object:{');
      Object.keys(item).sort().forEach((key, index) => {
        if (index > 0) append(',');
        append(JSON.stringify(key));
        append(':');
        encode(item[key]);
      });
      append('}');
    } else {
      append(`${t}:${String(item)}`);
    }
  }

  encode(value);
  return { key: chunks.join(''), bytes };
}

function collectSchemaErrors(schema, location = 'schema') {
  const errors = createErrorList();

  function check(node, p) {
    if (!isObject(node)) {
      errors.push(`${p}: schema must be an object`);
      return;
    }

    for (const key of Object.keys(node)) {
      if (!SUPPORTED_KEYWORDS.has(key)) {
        errors.push(`${p}: unsupported schema keyword ${safeQuote(key)}`);
      }
    }

    if (hasOwn(node, '$comment') && typeof node.$comment !== 'string') {
      errors.push(`${p}.$comment: expected string`);
    }
    if (hasOwn(node, 'description') && typeof node.description !== 'string') {
      errors.push(`${p}.description: expected string`);
    }
    if (hasOwn(node, 'type')) {
      if (typeof node.type === 'string') {
        if (!SUPPORTED_TYPES.has(node.type)) {
          errors.push(`${p}.type: unsupported type ${safeQuote(node.type)}`);
        }
      } else if (Array.isArray(node.type)) {
        if (node.type.length === 0 || node.type.some((t) => typeof t !== 'string' || !SUPPORTED_TYPES.has(t))) {
          errors.push(`${p}.type: expected non-empty array of supported types`);
        } else if (new Set(node.type).size !== node.type.length) {
          errors.push(`${p}.type: entries must be unique`);
        }
      } else {
        errors.push(`${p}.type: expected string or array of types`);
      }
    }
    if (hasOwn(node, 'properties')) {
      if (!isObject(node.properties)) {
        errors.push(`${p}.properties: expected object`);
      } else {
        for (const key of Object.keys(node.properties)) {
          check(node.properties[key], propertyPath(`${p}.properties`, key));
        }
      }
    }
    if (hasOwn(node, 'required')) {
      if (!Array.isArray(node.required) || node.required.some((key) => typeof key !== 'string')) {
        errors.push(`${p}.required: expected an array of strings`);
      } else if (new Set(node.required).size !== node.required.length) {
        errors.push(`${p}.required: entries must be unique`);
      }
    }
    if (hasOwn(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') {
      errors.push(`${p}.additionalProperties: only boolean values are supported`);
    }
    if (hasOwn(node, 'enum')) {
      if (!Array.isArray(node.enum) || node.enum.length === 0) {
        errors.push(`${p}.enum: expected a non-empty array`);
      } else {
        const seen = new Set();
        for (const value of node.enum) {
          let key;
          try {
            key = canonicalKey(value).key;
          } catch (error) {
            errors.push(`${p}.enum: ${error.message}`);
            break;
          }
          if (seen.has(key)) {
            errors.push(`${p}.enum: entries must be unique`);
            break;
          }
          seen.add(key);
        }
      }
    }
    if (hasOwn(node, 'items')) check(node.items, `${p}.items`);
    for (const keyword of ['minItems', 'minLength']) {
      if (hasOwn(node, keyword) && (!Number.isInteger(node[keyword]) || node[keyword] < 0)) {
        errors.push(`${p}.${keyword}: expected a non-negative integer`);
      }
    }
    if (hasOwn(node, 'minimum') && (typeof node.minimum !== 'number' || !Number.isFinite(node.minimum))) {
      errors.push(`${p}.minimum: expected a finite number`);
    }
    if (hasOwn(node, 'pattern')) {
      if (typeof node.pattern !== 'string') {
        errors.push(`${p}.pattern: expected string`);
      } else {
        try {
          new RegExp(node.pattern);
        } catch {
          errors.push(`${p}.pattern: invalid regular expression`);
        }
      }
    }
    if (hasOwn(node, 'uniqueItems') && typeof node.uniqueItems !== 'boolean') {
      errors.push(`${p}.uniqueItems: expected boolean`);
    }
    if (hasOwn(node, 'visibleContent')) {
      if (typeof node.visibleContent !== 'boolean') {
        errors.push(`${p}.visibleContent: expected boolean`);
      } else if (node.visibleContent === true) {
        const allowsString = node.type === 'string' ||
          (Array.isArray(node.type) && node.type.includes('string'));
        if (!allowsString) {
          errors.push(`${p}.visibleContent: requires type including "string"`);
        }
      }
    }
    if (hasOwn(node, 'oneOf')) {
      if (!Array.isArray(node.oneOf) || node.oneOf.length === 0) {
        errors.push(`${p}.oneOf: expected a non-empty array`);
      } else {
        node.oneOf.forEach((branch, index) => check(branch, `${p}.oneOf[${index}]`));
      }
    }
  }

  check(schema, location);
  return errors;
}

function findDiscriminator(schema) {
  if (!hasOwn(schema, 'properties') || !isObject(schema.properties)) return null;
  for (const key of Object.keys(schema.properties)) {
    const subSchema = schema.properties[key];
    if (isObject(subSchema) && hasOwn(subSchema, 'const')) {
      return { key, value: subSchema.const };
    }
  }
  return null;
}

function matchesExpectedType(value, expectedType) {
  if (expectedType === 'integer') {
    return typeof value === 'number' && Number.isInteger(value);
  }
  return typeOf(value) === expectedType;
}

function validateSchemaNode(value, schema, p, errors) {
  if (errors.length >= LIMITS.validationErrors) return;

  if (hasOwn(schema, 'oneOf')) {
    const results = schema.oneOf.map((branch) => collectSchemaUnchecked(value, branch, p));
    const passingIndexes = results
      .map((branchErrors, index) => (branchErrors.length === 0 ? index : -1))
      .filter((index) => index !== -1);

    if (passingIndexes.length !== 1) {
      errors.push(`${p}: must match exactly one schema in oneOf; matched ${passingIndexes.length}`);
      if (passingIndexes.length === 0 && isObject(value)) {
        const matchingDiscriminators = schema.oneOf
          .map((branch, index) => ({ discriminator: findDiscriminator(branch), index }))
          .filter(
            ({ discriminator }) =>
              discriminator &&
              hasOwn(value, discriminator.key) &&
              deepEqual(value[discriminator.key], discriminator.value),
          );
        if (matchingDiscriminators.length === 1) {
          errors.push(...results[matchingDiscriminators[0].index]);
        }
      }
    }
  }

  if (hasOwn(schema, 'const') && !deepEqual(value, schema.const)) {
    errors.push(`${p}: must equal ${safeQuote(schema.const)}, got ${safeQuote(value)}`);
  }
  if (hasOwn(schema, 'enum') && !schema.enum.some((allowed) => deepEqual(value, allowed))) {
    const allowed = schema.enum.map(safeQuote).join(', ');
    errors.push(`${p}: invalid value ${safeQuote(value)} (expected one of ${allowed})`);
  }

  if (hasOwn(schema, 'type')) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowedTypes.some((expectedType) => matchesExpectedType(value, expectedType))) {
      errors.push(`${p}: expected ${allowedTypes.join('|')}, got ${typeOf(value)}`);
      return;
    }
  }

  if (isObject(value)) {
    for (const req of hasOwn(schema, 'required') ? schema.required : []) {
      if (!hasOwn(value, req)) errors.push(`${p}: missing required field ${safeQuote(req)}`);
    }
    for (const key of Object.keys(value)) {
      if (hasOwn(schema, 'properties') && hasOwn(schema.properties, key)) {
        validateSchemaNode(value[key], schema.properties[key], propertyPath(p, key), errors);
      } else if (hasOwn(schema, 'additionalProperties') && schema.additionalProperties === false) {
        errors.push(`${p}: unexpected field ${safeQuote(key)}`);
      }
    }
  }

  if (Array.isArray(value)) {
    if (hasOwn(schema, 'minItems') && value.length < schema.minItems) {
      errors.push(`${p}: must have at least ${schema.minItems} item(s), got ${value.length}`);
    }
    if (hasOwn(schema, 'uniqueItems') && schema.uniqueItems === true) {
      const seen = new Set();
      let setBytes = 0;
      for (let i = 0; i < value.length; i++) {
        let canonical;
        try {
          canonical = canonicalKey(value[i]);
        } catch (error) {
          errors.push(`${p}[${i}]: ${error.message}`);
          break;
        }
        if (seen.has(canonical.key)) {
          errors.push(`${p}: items must be unique; duplicate at index ${i}`);
          continue;
        }
        setBytes += canonical.bytes;
        if (setBytes > LIMITS.uniqueSetBytes) {
          errors.push(`${p}: canonical uniqueness set exceeds ${LIMITS.uniqueSetBytes} byte limit`);
          break;
        }
        seen.add(canonical.key);
      }
    }
    if (hasOwn(schema, 'items')) {
      value.forEach((item, index) => validateSchemaNode(item, schema.items, `${p}[${index}]`, errors));
    }
  }

  if (typeof value === 'string') {
    if (hasOwn(schema, 'minLength') && codePointLength(value) < schema.minLength) {
      errors.push(`${p}: must have at least ${schema.minLength} character(s)`);
    }
    if (schema.visibleContent === true) {
      if (!hasValidUnicodeScalarValues(value)) {
        errors.push(`${p}: must contain only valid Unicode scalar values`);
      } else if (!VISIBLE_CONTENT.test(value)) {
        errors.push(`${p}: must contain a visible character`);
      }
    }
    if (hasOwn(schema, 'pattern') && !(new RegExp(schema.pattern).test(value))) {
      errors.push(`${p}: must match pattern ${JSON.stringify(schema.pattern)}`);
    }
  }

  if (typeof value === 'number' && hasOwn(schema, 'minimum') && value < schema.minimum) {
    errors.push(`${p}: must be at least ${schema.minimum}, got ${value}`);
  }
}

function collectSchemaUnchecked(value, schema, p) {
  const errors = createErrorList();
  validateSchemaNode(value, schema, p, errors);
  return errors;
}

function loadSchemaFile(schemaPath) {
  const schema = JSON.parse(readFileWithinLimit(schemaPath));
  const errors = collectSchemaErrors(schema);
  if (errors.length > 0) {
    throw new Error(`unsupported or invalid schema:\n${errors.join('\n')}`);
  }
  return schema;
}

module.exports = {
  AGENT_ID_PATTERN,
  AXES,
  FEATURE_ID_PATTERN,
  FINGERPRINT_PATTERN,
  JsonStructureError,
  LIMITS,
  PATH_FORBIDDEN_CHARACTER,
  SafeInputError,
  UNSAFE_DIAGNOSTIC_CHARACTER,
  VISIBLE_CONTENT,
  WINDOWS_RESERVED_AGENT_ID,
  WINDOWS_RESERVED_COMPONENT,
  collectSchemaErrors,
  collectSchemaUnchecked,
  createErrorList,
  deepEqual,
  encodeCanonicalRef,
  escapeUnsafeDiagnosticCharacters,
  hasOwn,
  hasValidUnicodeScalarValues,
  hasVisibleProse,
  isCanonicalRef,
  isObject,
  isOwnedArtifactPath,
  isSafeAgentId,
  isSafeEntrypointRef,
  isSafeRelativePath,
  isVisibleText,
  loadSchemaFile,
  preflightDocument,
  preflightJsonText,
  propertyPath,
  readFileWithinLimit,
  safeQuote,
};
