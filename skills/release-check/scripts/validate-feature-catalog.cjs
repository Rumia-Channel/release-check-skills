#!/usr/bin/env node
'use strict';

/**
 * Validates feature-catalog.json against feature-catalog-schema.json and semantic intent rules.
 * Usage: node validate-feature-catalog.cjs <path-to-feature-catalog.json>
 */

const path = require('node:path');
const {
  JsonStructureError,
  LIMITS,
  PATH_FORBIDDEN_CHARACTER,
  SafeInputError,
  collectSchemaErrors,
  collectSchemaUnchecked,
  createErrorList,
  escapeUnsafeDiagnosticCharacters,
  hasOwn,
  isObject,
  isSafeEntrypointRef,
  isSafeRelativePath,
  isVisibleText,
  loadSchemaFile,
  preflightDocument,
  preflightJsonText,
  readFileWithinLimit,
  safeQuote,
} = require('./lib/validation-utils.cjs');

const INTENT_PREFIX_REF = /^(?:git|tag|pr|issue|doc):(.+)$/;

function isSafeIntentRef(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  const match = INTENT_PREFIX_REF.exec(value);
  if (!match) return isSafeRelativePath(value);
  const suffix = match[1];
  if (
    !isVisibleText(suffix, 1024) ||
    PATH_FORBIDDEN_CHARACTER.test(suffix) ||
    suffix.includes('\\')
  ) {
    return false;
  }
  return suffix.split('/').every((segment) => segment !== '..');
}

function collectFeatureSemanticErrors(catalog) {
  const errors = createErrorList();
  if (!Array.isArray(catalog)) return errors;

  const ids = new Map();
  let previousId = null;

  catalog.forEach((feature, index) => {
    if (errors.length >= LIMITS.validationErrors) return;
    if (!isObject(feature)) return;
    const base = `$[${index}]`;

    if (hasOwn(feature, 'feature_id') && typeof feature.feature_id === 'string') {
      if (feature.feature_id.includes('::')) {
        errors.push(`${base}.feature_id: must not contain "::"`);
      }
      if (ids.has(feature.feature_id)) {
        errors.push(`${base}.feature_id: duplicate of $[${ids.get(feature.feature_id)}].feature_id`);
      } else {
        ids.set(feature.feature_id, index);
      }
      if (previousId !== null && previousId > feature.feature_id) {
        errors.push(`${base}.feature_id: features must be sorted lexicographically`);
      }
      previousId = feature.feature_id;
    }

    if (typeof feature.name === 'string' && !isVisibleText(feature.name)) {
      errors.push(`${base}.name: must not have surrounding whitespace or exceed ${LIMITS.maxTextLength} characters`);
    }

    if (feature.intent_status === 'unknown') {
      if (feature.purpose !== null) {
        errors.push(`${base}.purpose: unknown intent_status requires purpose to be null`);
      }
    } else if (feature.intent_status === 'documented' || feature.intent_status === 'inferred') {
      if (!isVisibleText(feature.purpose)) {
        errors.push(`${base}.purpose: ${safeQuote(feature.intent_status)} intent_status requires a visible purpose`);
      }
      if (!Array.isArray(feature.intent_evidence) || feature.intent_evidence.length === 0) {
        errors.push(`${base}.intent_evidence: ${safeQuote(feature.intent_status)} intent_status requires at least one evidence item`);
      }
    }

    if (Array.isArray(feature.intent_evidence)) {
      feature.intent_evidence.forEach((entry, evIndex) => {
        if (!isObject(entry)) return;
        if (hasOwn(entry, 'ref') && !isSafeIntentRef(entry.ref)) {
          errors.push(`${base}.intent_evidence[${evIndex}].ref: expected safe relative path or git:/tag:/pr:/issue:/doc: reference`);
        }
        if (hasOwn(entry, 'detail') && !isVisibleText(entry.detail)) {
          errors.push(`${base}.intent_evidence[${evIndex}].detail: invalid text`);
        }
      });
    }

    if (Array.isArray(feature.entrypoints)) {
      feature.entrypoints.forEach((entry, epIndex) => {
        if (!isSafeEntrypointRef(entry)) {
          errors.push(`${base}.entrypoints[${epIndex}]: expected safe repository-relative path or path#symbol`);
        }
      });
    }

    if (Array.isArray(feature.contracts)) {
      feature.contracts.forEach((contract, cIndex) => {
        if (!isVisibleText(contract)) {
          errors.push(`${base}.contracts[${cIndex}]: invalid text`);
        }
      });
    }

    if (Array.isArray(feature.dependencies)) {
      feature.dependencies.forEach((dep, dIndex) => {
        if (!isVisibleText(dep, 1024)) {
          errors.push(`${base}.dependencies[${dIndex}]: invalid text`);
        }
      });
    }

    if (feature.status === 'in_scope') {
      if (!Array.isArray(feature.entrypoints) || feature.entrypoints.length === 0) {
        errors.push(`${base}.entrypoints: in_scope feature requires at least one entrypoint`);
      }
      if (!Array.isArray(feature.contracts) || feature.contracts.length === 0) {
        errors.push(`${base}.contracts: in_scope feature requires at least one contract`);
      }
      if (feature.exclusion_reason !== null) {
        errors.push(`${base}.exclusion_reason: in_scope feature must set exclusion_reason to null`);
      }
    } else if (feature.status === 'out_of_scope') {
      if (!isVisibleText(feature.exclusion_reason)) {
        errors.push(`${base}.exclusion_reason: out_of_scope feature requires a visible exclusion_reason`);
      }
    }
  });

  return errors;
}

function validateDocument(catalog, schema) {
  const schemaErrors = collectSchemaErrors(schema);
  if (schemaErrors.length > 0) return schemaErrors;

  const limitErrors = preflightDocument(catalog, { maxTopLevelItems: LIMITS.maxFeatures });
  if (limitErrors.length > 0) return limitErrors;

  const errors = collectSchemaUnchecked(catalog, schema, '$');
  if (errors.length < LIMITS.validationErrors) {
    errors.push(...collectFeatureSemanticErrors(catalog));
  }
  return errors;
}

function loadSchema(schemaPath = path.join(__dirname, '..', 'feature-catalog-schema.json')) {
  return loadSchemaFile(schemaPath);
}

function run(file) {
  if (!file) {
    console.error('Usage: node validate-feature-catalog.cjs <path-to-feature-catalog.json>');
    return 1;
  }

  let schema;
  try {
    schema = loadSchema();
  } catch (error) {
    console.error('Failed to load feature-catalog-schema.json:', error.message);
    return 1;
  }

  let contents;
  try {
    contents = readFileWithinLimit(file);
  } catch (error) {
    const reason = error instanceof SafeInputError ? error.message : 'input could not be opened or read safely';
    console.error(`Failed to read feature catalog: ${reason}`);
    return 1;
  }

  try {
    preflightJsonText(contents, { maxTopLevelItems: LIMITS.maxFeatures, topLevelLabel: 'feature' });
  } catch (error) {
    const reason = error instanceof JsonStructureError ? error.message : 'invalid JSON structure';
    console.error(`Failed to parse feature catalog: ${reason}`);
    return 1;
  }

  let catalog;
  try {
    catalog = JSON.parse(contents);
  } catch {
    console.error('Failed to parse feature catalog: invalid JSON syntax');
    return 1;
  }

  let errors;
  try {
    errors = validateDocument(catalog, schema);
  } catch {
    console.error('Failed to validate feature catalog: unexpected validation error');
    return 1;
  }

  for (const message of errors) console.error('ERROR:', escapeUnsafeDiagnosticCharacters(message));
  if (errors.length > 0) {
    const cap = errors.length === LIMITS.validationErrors ? `; output capped at ${LIMITS.validationErrors}` : '';
    console.error(`FAIL: ${errors.length} validation error(s)${cap}`);
    return 1;
  }
  console.log(`PASS: ${catalog.length} feature(s) valid`);
  return 0;
}

module.exports = {
  collectFeatureSemanticErrors,
  isSafeIntentRef,
  loadSchema,
  validateDocument,
};

if (require.main === module) process.exit(run(process.argv[2]));
