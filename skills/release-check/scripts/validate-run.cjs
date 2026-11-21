#!/usr/bin/env node
'use strict';

/**
 * Cross-artifact integrity validator for an entire release-check audit output directory.
 * Validates run-metadata.json, feature-catalog.json, coverage-ledger.json, findings.json,
 * and every cross-file invariant between them.
 * Usage: node validate-run.cjs <output-dir>
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  AXES,
  JsonStructureError,
  LIMITS,
  SafeInputError,
  createErrorList,
  escapeUnsafeDiagnosticCharacters,
  hasOwn,
  isObject,
  isSafeRelativePath,
  isVisibleText,
  preflightDocument,
  preflightJsonText,
  readFileWithinLimit,
  safeQuote,
} = require('./lib/validation-utils.cjs');
const featureCatalogValidator = require('./validate-feature-catalog.cjs');
const coverageLedgerValidator = require('./validate-coverage-ledger.cjs');
const findingsValidator = require('./validate-findings.cjs');

const REQUIRED_METADATA_FIELDS = [
  'run_id',
  'repo',
  'target',
  'base_ref',
  'head_ref',
  'worktree_dirty',
  'profile',
  'scope_paths',
  'budget',
  'execution_policy',
  'selected_companions',
  'prior_runs',
  'shared_file_owners',
  'run_status',
];
const ALLOWED_METADATA_FIELDS = new Set([...REQUIRED_METADATA_FIELDS, 'incomplete_reason']);
const PROFILES = new Set(['quick', 'standard', 'deep']);
const RUN_STATUSES = new Set(['in_progress', 'complete', 'incomplete']);
const ACTIVE_UNIT_STATUSES = new Set(['planned', 'in_progress', 'covered', 'candidate', 'blocked']);
const COMPANION_FILENAME = /^[A-Z0-9][A-Z0-9-]*\.md$/;

function validateRunMetadata(metadata) {
  const errors = createErrorList();
  if (!isObject(metadata)) {
    errors.push('run-metadata: expected top-level object');
    return errors;
  }

  errors.push(...preflightDocument(metadata));
  if (errors.length > 0) return errors;

  for (const field of REQUIRED_METADATA_FIELDS) {
    if (!hasOwn(metadata, field)) {
      errors.push(`run-metadata: missing required field ${safeQuote(field)}`);
    }
  }
  for (const key of Object.keys(metadata)) {
    if (!ALLOWED_METADATA_FIELDS.has(key)) {
      errors.push(`run-metadata: unexpected field ${safeQuote(key)}`);
    }
  }

  for (const field of ['run_id', 'repo', 'target', 'head_ref']) {
    if (hasOwn(metadata, field) && !isVisibleText(metadata[field], 1024)) {
      errors.push(`run-metadata.${field}: expected visible non-empty text`);
    }
  }

  if (hasOwn(metadata, 'base_ref') && metadata.base_ref !== null) {
    if (!isVisibleText(metadata.base_ref, 1024)) {
      errors.push('run-metadata.base_ref: expected null or visible non-empty revision string');
    } else if (metadata.base_ref === metadata.head_ref) {
      errors.push('run-metadata.base_ref: must differ from head_ref');
    }
  }

  if (hasOwn(metadata, 'worktree_dirty') && typeof metadata.worktree_dirty !== 'boolean') {
    errors.push('run-metadata.worktree_dirty: expected boolean');
  }

  if (hasOwn(metadata, 'profile') && (typeof metadata.profile !== 'string' || !PROFILES.has(metadata.profile))) {
    errors.push('run-metadata.profile: expected quick, standard, or deep');
  }

  if (hasOwn(metadata, 'scope_paths')) {
    if (!Array.isArray(metadata.scope_paths) || metadata.scope_paths.length === 0) {
      errors.push('run-metadata.scope_paths: expected non-empty array');
    } else {
      const seen = new Set();
      metadata.scope_paths.forEach((p, idx) => {
        if (p !== '.' && !isSafeRelativePath(p)) {
          errors.push(`run-metadata.scope_paths[${idx}]: expected "." or safe relative path`);
        }
        if (typeof p === 'string' && seen.has(p)) {
          errors.push(`run-metadata.scope_paths[${idx}]: duplicate scope path`);
        }
        if (typeof p === 'string') seen.add(p);
      });
    }
  }

  if (hasOwn(metadata, 'budget') && metadata.budget !== null) {
    if (!Number.isInteger(metadata.budget) || metadata.budget < 1) {
      errors.push('run-metadata.budget: expected null or positive integer');
    }
  }

  if (
    hasOwn(metadata, 'execution_policy') &&
    metadata.execution_policy !== 'sandboxed-source-and-local-only'
  ) {
    errors.push('run-metadata.execution_policy: must be "sandboxed-source-and-local-only"');
  }

  if (hasOwn(metadata, 'selected_companions')) {
    if (!Array.isArray(metadata.selected_companions)) {
      errors.push('run-metadata.selected_companions: expected array');
    } else {
      const seen = new Set();
      metadata.selected_companions.forEach((name, idx) => {
        if (typeof name !== 'string' || !COMPANION_FILENAME.test(name)) {
          errors.push(`run-metadata.selected_companions[${idx}]: invalid companion filename`);
        }
        if (typeof name === 'string' && seen.has(name)) {
          errors.push(`run-metadata.selected_companions[${idx}]: duplicate entry`);
        }
        if (typeof name === 'string') seen.add(name);
      });
    }
  }

  if (hasOwn(metadata, 'prior_runs')) {
    if (!Array.isArray(metadata.prior_runs)) {
      errors.push('run-metadata.prior_runs: expected array');
    } else {
      const seen = new Set();
      metadata.prior_runs.forEach((entry, idx) => {
        if (!isVisibleText(entry, 1024)) {
          errors.push(`run-metadata.prior_runs[${idx}]: expected visible text`);
        }
        if (typeof entry === 'string' && seen.has(entry)) {
          errors.push(`run-metadata.prior_runs[${idx}]: duplicate entry`);
        }
        if (typeof entry === 'string') seen.add(entry);
      });
    }
  }

  if (hasOwn(metadata, 'shared_file_owners') && !isObject(metadata.shared_file_owners)) {
    errors.push('run-metadata.shared_file_owners: expected object');
  }

  if (
    hasOwn(metadata, 'run_status') &&
    (typeof metadata.run_status !== 'string' || !RUN_STATUSES.has(metadata.run_status))
  ) {
    errors.push('run-metadata.run_status: expected in_progress, complete, or incomplete');
  }

  if (metadata.run_status === 'incomplete') {
    if (!isVisibleText(metadata.incomplete_reason)) {
      errors.push('run-metadata.incomplete_reason: incomplete run requires visible incomplete_reason');
    }
  } else if (
    hasOwn(metadata, 'incomplete_reason') &&
    metadata.incomplete_reason !== null
  ) {
    errors.push('run-metadata.incomplete_reason: must be null or absent when run_status is not incomplete');
  }

  return errors;
}

function validateRunObjects({ metadata, catalog, ledger, findings, schemas = {} }) {
  const errors = createErrorList();
  const featureSchema = schemas.featureSchema || featureCatalogValidator.loadSchema();
  const reportSchema = schemas.reportSchema || findingsValidator.loadSchema();

  for (const err of validateRunMetadata(metadata)) errors.push(err);
  for (const err of featureCatalogValidator.validateDocument(catalog, featureSchema)) {
    errors.push(`feature-catalog ${err}`);
  }
  for (const err of coverageLedgerValidator.validateDocument(ledger)) {
    errors.push(`coverage-ledger ${err}`);
  }
  for (const err of findingsValidator.validateDocument(findings, reportSchema)) {
    errors.push(`findings ${err}`);
  }

  if (errors.length >= LIMITS.validationErrors) return errors;
  if (!isObject(metadata) || !Array.isArray(catalog) || !Array.isArray(ledger) || !Array.isArray(findings)) {
    return errors;
  }

  const featureMap = new Map();
  for (const feat of catalog) {
    if (isObject(feat) && typeof feat.feature_id === 'string') {
      featureMap.set(feat.feature_id, feat);
    }
  }

  const unitMap = new Map();
  const unitsByFeature = new Map();
  for (const unit of ledger) {
    if (!isObject(unit) || typeof unit.coverage_id !== 'string') continue;
    unitMap.set(unit.coverage_id, unit);
    const featId = isObject(unit.canonical_refs) ? unit.canonical_refs.feature : null;
    if (typeof featId === 'string') {
      if (!unitsByFeature.has(featId)) unitsByFeature.set(featId, []);
      unitsByFeature.get(featId).push(unit);
    }
  }

  const baseAvailable = typeof metadata.base_ref === 'string' &&
    metadata.base_ref.length > 0 &&
    metadata.base_ref !== metadata.head_ref;

  // 1. Baseline constraints when base_ref is null
  if (!baseAvailable) {
    findings.forEach((finding, idx) => {
      if (!isObject(finding)) return;
      if (finding.verdict === 'confirmed_regression' || finding.verdict === 'confirmed_change') {
        errors.push(`findings[${idx}]: ${finding.verdict} requires a non-null base_ref`);
      }
      if (
        finding.verdict === 'confirmed_defect' &&
        isObject(finding.execution)
      ) {
        if (finding.execution.base_observed_result != null) {
          errors.push(`findings[${idx}].execution.base_observed_result: cannot report BASE observation without base_ref`);
        }
        if (finding.execution.test_kind === 'base_head_differential') {
          errors.push(`findings[${idx}].execution.test_kind: base_head_differential is forbidden without base_ref`);
        }
      }
    });
    ledger.forEach((unit, idx) => {
      if (!isObject(unit)) return;
      const checkLists = [
        { checks: unit.checks, prefix: `coverage-ledger[${idx}].checks` },
        ...(Array.isArray(unit.attempts)
          ? unit.attempts.map((a, aIdx) => ({
            checks: isObject(a) ? a.checks : null,
            prefix: `coverage-ledger[${idx}].attempts[${aIdx}].checks`,
          }))
          : []),
      ];
      for (const { checks, prefix } of checkLists) {
        if (!Array.isArray(checks)) continue;
        checks.forEach((check, cIdx) => {
          if (!isObject(check)) return;
          if (check.revision === 'base' || check.revision === 'base_and_head') {
            errors.push(`${prefix}[${cIdx}].revision: ${safeQuote(check.revision)} is forbidden without base_ref`);
          }
          if (check.test_kind === 'base_head_differential') {
            errors.push(`${prefix}[${cIdx}].test_kind: base_head_differential is forbidden without base_ref`);
          }
        });
      }
    });
  }

  // 2. Feature <-> Ledger invariants
  ledger.forEach((unit, idx) => {
    if (!isObject(unit) || !isObject(unit.canonical_refs)) return;
    const featId = unit.canonical_refs.feature;
    if (typeof featId !== 'string' || !featureMap.has(featId)) {
      errors.push(`coverage-ledger[${idx}].canonical_refs.feature: unknown feature ${safeQuote(featId)}`);
    } else {
      const feat = featureMap.get(featId);
      if (feat.status === 'out_of_scope' && ACTIVE_UNIT_STATUSES.has(unit.status)) {
        errors.push(
          `coverage-ledger[${idx}]: out_of_scope feature ${safeQuote(featId)} cannot have active status ${safeQuote(unit.status)}`,
        );
      }
    }
  });

  for (const [featId, feat] of featureMap) {
    if (feat.status !== 'in_scope') continue;
    const linkedUnits = unitsByFeature.get(featId) || [];
    if (feat.kind === 'cross_cutting') {
      if (linkedUnits.length === 0) {
        errors.push(`feature-catalog: in_scope cross_cutting feature ${safeQuote(featId)} has no coverage unit`);
      }
    } else if (feat.kind === 'user_feature') {
      const coveredAxes = new Set();
      for (const unit of linkedUnits) {
        if (Array.isArray(unit.axes)) {
          for (const axis of unit.axes) coveredAxes.add(axis);
        }
      }
      for (const axis of AXES) {
        if (!coveredAxes.has(axis)) {
          errors.push(`coverage-ledger: in_scope user_feature ${safeQuote(featId)} is missing axis ${safeQuote(axis)}`);
        }
      }
    }
  }

  // 3. Ledger <-> Findings invariants
  const findingFingerprints = new Set();
  findings.forEach((finding, idx) => {
    if (!isObject(finding)) return;
    if (typeof finding.fingerprint === 'string') {
      findingFingerprints.add(finding.fingerprint);
    }
    if (!featureMap.has(finding.feature_id)) {
      errors.push(`findings[${idx}].feature_id: unknown feature ${safeQuote(finding.feature_id)}`);
    }
    if (!Array.isArray(finding.coverage_ids)) return;

    let fingerprintLinked = false;
    finding.coverage_ids.forEach((covId, covIdx) => {
      const unit = unitMap.get(covId);
      if (!unit) {
        errors.push(`findings[${idx}].coverage_ids[${covIdx}]: unknown coverage_id ${safeQuote(covId)}`);
        return;
      }
      const unitFeature = isObject(unit.canonical_refs) ? unit.canonical_refs.feature : null;
      if (unitFeature !== finding.feature_id) {
        errors.push(
          `findings[${idx}].coverage_ids[${covIdx}]: links to feature ${safeQuote(unitFeature)} instead of ${safeQuote(finding.feature_id)}`,
        );
      }
      const liveFps = Array.isArray(unit.result_fingerprints) ? unit.result_fingerprints : [];
      const archivedFps = Array.isArray(unit.attempts)
        ? unit.attempts.flatMap((a) => (isObject(a) && Array.isArray(a.result_fingerprints) ? a.result_fingerprints : []))
        : [];
      if (
        typeof finding.fingerprint === 'string' &&
        (liveFps.includes(finding.fingerprint) || archivedFps.includes(finding.fingerprint))
      ) {
        fingerprintLinked = true;
      }
    });

    if (finding.coverage_ids.length > 0 && typeof finding.fingerprint === 'string' && !fingerprintLinked) {
      errors.push(
        `findings[${idx}].fingerprint: ${safeQuote(finding.fingerprint)} is absent from result_fingerprints of its linked coverage units`,
      );
    }
  });

  // 4. Completion gate
  if (metadata.run_status === 'complete') {
    const hasInScopeFeature = [...featureMap.values()].some((f) => f.status === 'in_scope');
    if (!hasInScopeFeature) {
      errors.push('run-metadata.run_status: complete run requires at least one in_scope feature');
    }
    ledger.forEach((unit, idx) => {
      if (!isObject(unit)) return;
      if (unit.status === 'planned' || unit.status === 'in_progress') {
        errors.push(`run-metadata.run_status: complete run forbids ${safeQuote(unit.status)} unit at coverage-ledger[${idx}]`);
      }
      const fps = [
        ...(Array.isArray(unit.result_fingerprints) ? unit.result_fingerprints : []),
        ...(Array.isArray(unit.attempts)
          ? unit.attempts.flatMap((a) => (isObject(a) && Array.isArray(a.result_fingerprints) ? a.result_fingerprints : []))
          : []),
      ];
      for (const fp of fps) {
        if (!findingFingerprints.has(fp)) {
          errors.push(
            `run-metadata.run_status: complete run requires final disposition in findings.json for ledger fingerprint ${safeQuote(fp)}`,
          );
        }
      }
    });
  }

  return errors;
}

function readJsonChecked(filePath, options) {
  const contents = readFileWithinLimit(filePath);
  preflightJsonText(contents, options);
  return JSON.parse(contents);
}

function validateOutputDirectory(outputDir) {
  const errors = createErrorList();
  let stat;
  try {
    stat = fs.lstatSync(outputDir);
  } catch (error) {
    errors.push(`output-dir: ${error.message}`);
    return errors;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    errors.push('output-dir: expected a real directory (not a symlink)');
    return errors;
  }

  let metadata;
  let catalog;
  let ledger;
  let findings;
  const targets = [
    { name: 'run-metadata.json', opts: {}, assign: (v) => { metadata = v; } },
    {
      name: 'feature-catalog.json',
      opts: { maxTopLevelItems: LIMITS.maxFeatures, topLevelLabel: 'feature' },
      assign: (v) => { catalog = v; },
    },
    {
      name: 'coverage-ledger.json',
      opts: { maxTopLevelItems: LIMITS.maxUnits, topLevelLabel: 'unit' },
      assign: (v) => { ledger = v; },
    },
    {
      name: 'findings.json',
      opts: { maxTopLevelItems: LIMITS.maxFindings, topLevelLabel: 'finding' },
      assign: (v) => { findings = v; },
    },
  ];

  for (const item of targets) {
    const filePath = path.join(outputDir, item.name);
    try {
      item.assign(readJsonChecked(filePath, item.opts));
    } catch (error) {
      if (error instanceof SafeInputError || error instanceof JsonStructureError) {
        errors.push(`${item.name}: ${error.message}`);
      } else {
        errors.push(`${item.name}: ${error.message}`);
      }
    }
  }

  if (errors.length > 0) return errors;
  return validateRunObjects({ metadata, catalog, ledger, findings });
}

function run(outputDir) {
  if (!outputDir) {
    console.error('Usage: node validate-run.cjs <output-dir>');
    return 1;
  }

  let errors;
  try {
    errors = validateOutputDirectory(outputDir);
  } catch (error) {
    console.error('Failed to validate run:', error.message);
    return 1;
  }

  for (const message of errors) console.error('ERROR:', escapeUnsafeDiagnosticCharacters(message));
  if (errors.length > 0) {
    const cap = errors.length === LIMITS.validationErrors ? `; output capped at ${LIMITS.validationErrors}` : '';
    console.error(`FAIL: ${errors.length} validation error(s)${cap}`);
    return 1;
  }
  console.log('PASS: run metadata, feature catalog, coverage ledger, and findings cross-validated');
  return 0;
}

module.exports = {
  validateOutputDirectory,
  validateRunMetadata,
  validateRunObjects,
};

if (require.main === module) process.exit(run(process.argv[2]));
