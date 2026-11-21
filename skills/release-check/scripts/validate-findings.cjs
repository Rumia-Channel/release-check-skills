#!/usr/bin/env node
'use strict';

/**
 * Validates findings.json against report-schema.json across all five verdicts.
 * Usage: node validate-findings.cjs <path-to-findings.json>
 */

const path = require('node:path');
const {
  JsonStructureError,
  LIMITS,
  SafeInputError,
  collectSchemaErrors,
  collectSchemaUnchecked,
  createErrorList,
  escapeUnsafeDiagnosticCharacters,
  hasOwn,
  hasVisibleProse,
  isObject,
  isSafeRelativePath,
  loadSchemaFile,
  preflightDocument,
  preflightJsonText,
  readFileWithinLimit,
  safeQuote,
} = require('./lib/validation-utils.cjs');

const SEVERITY_RANK = new Map([
  ['informational', 0],
  ['low', 1],
  ['medium', 2],
  ['high', 3],
  ['critical', 4],
]);

function collectFindingSemanticErrors(findings) {
  const errors = createErrorList();
  if (!Array.isArray(findings)) return errors;

  const fingerprints = new Map();
  let previousFingerprint = null;

  findings.forEach((finding, index) => {
    if (errors.length >= LIMITS.validationErrors) return;
    if (!isObject(finding)) return;
    const base = `$[${index}]`;

    if (hasOwn(finding, 'fingerprint') && typeof finding.fingerprint === 'string') {
      if (fingerprints.has(finding.fingerprint)) {
        errors.push(
          `${base}.fingerprint: duplicate of $[${fingerprints.get(finding.fingerprint)}].fingerprint`,
        );
      } else {
        fingerprints.set(finding.fingerprint, index);
      }
      if (previousFingerprint !== null && previousFingerprint > finding.fingerprint) {
        errors.push(`${base}.fingerprint: findings must be sorted lexicographically`);
      }
      previousFingerprint = finding.fingerprint;
    }

    if (hasOwn(finding, 'feature_id') && typeof finding.feature_id === 'string' && finding.feature_id.includes('::')) {
      errors.push(`${base}.feature_id: must not contain "::"`);
    }

    for (const field of ['trace', 'evidence']) {
      if (!hasOwn(finding, field) || !Array.isArray(finding[field])) continue;
      finding[field].forEach((entry, entryIndex) => {
        if (!isObject(entry)) return;
        if (hasOwn(entry, 'line') && (!Number.isInteger(entry.line) || entry.line < 1)) {
          errors.push(`${base}.${field}[${entryIndex}].line: must be a positive integer`);
        }
        if (hasOwn(entry, 'file') && !isSafeRelativePath(entry.file)) {
          errors.push(`${base}.${field}[${entryIndex}].file: must be a safe repository-relative source path`);
        }
      });
    }

    if (isObject(finding.remediation) && Array.isArray(finding.remediation.code_changes)) {
      finding.remediation.code_changes.forEach((change, changeIndex) => {
        if (isObject(change) && hasOwn(change, 'file_name') && !isSafeRelativePath(change.file_name)) {
          errors.push(
            `${base}.remediation.code_changes[${changeIndex}].file_name: must be a safe repository-relative source path`,
          );
        }
      });
    }

    if (Array.isArray(finding.trace) && finding.trace.length === 1) {
      const kind = finding.trace[0] && finding.trace[0].kind;
      if (kind !== 'entrypoint' && kind !== 'sink') {
        errors.push(`${base}.trace[0].kind: a one-entry trace must be "entrypoint" or "sink"`);
      }
    } else if (Array.isArray(finding.trace) && finding.trace.length > 1) {
      const last = finding.trace.length - 1;
      if (finding.trace[0] && finding.trace[0].kind !== 'entrypoint') {
        errors.push(`${base}.trace[0].kind: must be "entrypoint", got ${safeQuote(finding.trace[0].kind)}`);
      }
      if (finding.trace[last] && finding.trace[last].kind !== 'sink') {
        errors.push(`${base}.trace[${last}].kind: must be "sink", got ${safeQuote(finding.trace[last].kind)}`);
      }
      for (let traceIndex = 1; traceIndex < last; traceIndex++) {
        if (finding.trace[traceIndex] && finding.trace[traceIndex].kind !== 'propagation') {
          errors.push(
            `${base}.trace[${traceIndex}].kind: must be "propagation", got ${safeQuote(finding.trace[traceIndex].kind)}`,
          );
        }
      }
    }

    const verdict = finding.verdict;
    if (verdict === 'confirmed_defect' || verdict === 'confirmed_regression') {
      for (const forbidden of [
        'claimed_root_cause',
        'claimed_verdict',
        'blockers',
        'validation_plan',
        'reason',
        'behavior_before',
        'behavior_after',
        'impact_summary',
        'migration_or_compat_notes',
      ]) {
        if (hasOwn(finding, forbidden)) {
          errors.push(`${base}: ${verdict} must not contain ${safeQuote(forbidden)}`);
        }
      }
      if (verdict === 'confirmed_defect' && hasOwn(finding, 'intent_classification')) {
        errors.push(`${base}: confirmed_defect must not contain "intent_classification"`);
      }
      if (verdict === 'confirmed_regression' && finding.intent_classification !== 'unintended') {
        errors.push(`${base}.intent_classification: confirmed_regression requires "unintended"`);
      }
      const exec = finding.execution;
      if (
        !isObject(exec) ||
        typeof exec.head_observed_result !== 'string' ||
        !hasVisibleProse(exec.head_observed_result)
      ) {
        errors.push(`${base}: ${verdict} requires a visible execution.head_observed_result`);
      }
      if (verdict === 'confirmed_regression') {
        for (const reqField of ['base_observed_result', 'environment_comparability']) {
          if (!isObject(exec) || typeof exec[reqField] !== 'string' || !hasVisibleProse(exec[reqField])) {
            errors.push(`${base}.execution.${reqField}: confirmed_regression requires visible comparability evidence`);
          }
        }
      }
      if (
        !isObject(finding.remediation) ||
        typeof finding.remediation.strategy !== 'string' ||
        !hasVisibleProse(finding.remediation.strategy) ||
        typeof finding.remediation.regression_test !== 'string' ||
        !hasVisibleProse(finding.remediation.regression_test)
      ) {
        errors.push(`${base}: ${verdict} requires visible remediation.strategy and regression_test`);
      }
      const overall = finding.severity && finding.severity.overall_severity;
      const impact = finding.severity && finding.severity.impact && finding.severity.impact.score;
      if (
        SEVERITY_RANK.has(overall) &&
        SEVERITY_RANK.has(impact) &&
        SEVERITY_RANK.get(overall) > SEVERITY_RANK.get(impact)
      ) {
        errors.push(
          `${base}.severity.overall_severity: cannot exceed demonstrated impact ${safeQuote(impact)}`,
        );
      }
    } else if (verdict === 'confirmed_change') {
      for (const forbidden of [
        'severity',
        'remediation',
        'root_cause',
        'intended_behavior',
        'intent_status',
        'defect_category',
        'claimed_root_cause',
        'claimed_verdict',
        'blockers',
        'validation_plan',
        'reason',
      ]) {
        if (hasOwn(finding, forbidden)) {
          errors.push(`${base}: confirmed_change must not contain ${safeQuote(forbidden)}`);
        }
      }
      const exec = finding.execution;
      for (const reqField of ['base_observed_result', 'head_observed_result', 'environment_comparability']) {
        if (!isObject(exec) || typeof exec[reqField] !== 'string' || !hasVisibleProse(exec[reqField])) {
          errors.push(`${base}.execution.${reqField}: confirmed_change requires visible BASE/HEAD comparison evidence`);
        }
      }
    } else if (verdict === 'needs_validation') {
      for (const forbidden of [
        'severity',
        'execution',
        'remediation',
        'reason',
        'root_cause',
        'intended_behavior',
        'intent_status',
        'defect_category',
        'intent_classification',
        'behavior_before',
        'behavior_after',
        'impact_summary',
        'migration_or_compat_notes',
        'conditions',
        'confidence',
      ]) {
        if (hasOwn(finding, forbidden)) {
          errors.push(`${base}: needs_validation must not contain ${safeQuote(forbidden)}`);
        }
      }
      const plan = finding.validation_plan;
      const hasLocal = isObject(plan) && typeof plan.local === 'string' && hasVisibleProse(plan.local);
      const hasEnv = isObject(plan) && typeof plan.environment === 'string' && hasVisibleProse(plan.environment);
      const hasIntent = isObject(plan) && typeof plan.owner_intent === 'string' && hasVisibleProse(plan.owner_intent);
      if (!hasLocal && !hasEnv && !hasIntent) {
        errors.push(`${base}.validation_plan: requires at least one visible local, environment, or owner_intent step`);
      }
    } else if (verdict === 'rejected') {
      for (const forbidden of [
        'severity',
        'execution',
        'remediation',
        'blockers',
        'validation_plan',
        'root_cause',
        'intended_behavior',
        'intent_status',
        'defect_category',
        'intent_classification',
        'behavior_before',
        'behavior_after',
        'impact_summary',
        'migration_or_compat_notes',
        'conditions',
        'confidence',
        'claimed_verdict',
      ]) {
        if (hasOwn(finding, forbidden)) {
          errors.push(`${base}: rejected must not contain ${safeQuote(forbidden)}`);
        }
      }
    }
  });

  return errors;
}

function validateDocument(findings, schema) {
  const schemaErrors = collectSchemaErrors(schema);
  if (schemaErrors.length > 0) return schemaErrors;

  const limitErrors = preflightDocument(findings, { maxTopLevelItems: LIMITS.maxFindings });
  if (limitErrors.length > 0) return limitErrors;

  const errors = collectSchemaUnchecked(findings, schema, '$');
  if (errors.length < LIMITS.validationErrors) {
    errors.push(...collectFindingSemanticErrors(findings));
  }
  return errors;
}

function loadSchema(schemaPath = path.join(__dirname, '..', 'report-schema.json')) {
  return loadSchemaFile(schemaPath);
}

function run(file) {
  if (!file) {
    console.error('Usage: node validate-findings.cjs <path-to-findings.json>');
    return 1;
  }

  let schema;
  try {
    schema = loadSchema();
  } catch (error) {
    console.error('Failed to load report-schema.json:', error.message);
    return 1;
  }

  let contents;
  try {
    contents = readFileWithinLimit(file);
  } catch (error) {
    const reason = error instanceof SafeInputError ? error.message : 'input could not be opened or read safely';
    console.error(`Failed to read findings JSON: ${reason}`);
    return 1;
  }

  try {
    preflightJsonText(contents, { maxTopLevelItems: LIMITS.maxFindings, topLevelLabel: 'finding' });
  } catch (error) {
    const reason = error instanceof JsonStructureError ? error.message : 'invalid JSON structure';
    console.error(`Failed to parse findings JSON: ${reason}`);
    return 1;
  }

  let findings;
  try {
    findings = JSON.parse(contents);
  } catch {
    console.error('Failed to parse findings JSON: invalid JSON syntax');
    return 1;
  }

  let errors;
  try {
    errors = validateDocument(findings, schema);
  } catch {
    console.error('Failed to validate findings JSON: unexpected validation error');
    return 1;
  }

  for (const message of errors) console.error('ERROR:', escapeUnsafeDiagnosticCharacters(message));
  if (errors.length > 0) {
    const cap = errors.length === LIMITS.validationErrors ? `; output capped at ${LIMITS.validationErrors}` : '';
    console.error(`FAIL: ${errors.length} validation error(s)${cap}`);
    return 1;
  }
  console.log(`PASS: ${findings.length} finding(s) valid`);
  return 0;
}

module.exports = {
  LIMITS,
  SEVERITY_RANK,
  collectFindingSemanticErrors,
  loadSchema,
  validateDocument,
};

if (require.main === module) process.exit(run(process.argv[2]));
