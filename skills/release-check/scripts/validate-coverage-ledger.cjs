#!/usr/bin/env node
'use strict';

/**
 * Validates coverage-ledger.json, RFC 3986 canonical coverage IDs, state invariants,
 * check ownership, promoted artifact ownership, and append-only reassignment attempts.
 * Usage: node validate-coverage-ledger.cjs <path-to-coverage-ledger.json>
 */

const {
  AXES,
  FINGERPRINT_PATTERN,
  JsonStructureError,
  LIMITS,
  SafeInputError,
  createErrorList,
  encodeCanonicalRef,
  escapeUnsafeDiagnosticCharacters,
  hasOwn,
  isCanonicalRef,
  isObject,
  isOwnedArtifactPath,
  isSafeAgentId,
  isSafeRelativePath,
  isVisibleText,
  preflightDocument,
  preflightJsonText,
  readFileWithinLimit,
  safeQuote,
} = require('./lib/validation-utils.cjs');

const REQUIRED_FIELDS = [
  'coverage_id',
  'canonical_refs',
  'feature',
  'surface',
  'subsystem',
  'defect_class',
  'axes',
  'starting_paths',
  'ordinary_defect_class_block',
  'selected_companion_blocks',
  'excluded_blocks',
  'prior_status',
  'attempts',
  'wave',
  'status',
  'agent_id',
  'reviewed_paths',
  'checks',
  'result_fingerprints',
  'unresolved',
];
const REF_FIELDS = ['feature', 'surface', 'subsystem', 'defect_class'];
const AXES_SET = new Set(AXES);
const STATUSES = new Set([
  'planned',
  'not_applicable',
  'out_of_scope',
  'in_progress',
  'covered',
  'candidate',
  'blocked',
  'deferred',
]);
const ATTEMPT_STATUSES = new Set(['covered', 'candidate', 'blocked']);
const ATTEMPT_FIELDS = [
  'wave',
  'status',
  'agent_id',
  'reviewed_paths',
  'checks',
  'result_fingerprints',
  'unresolved',
  'reassignment_reason',
];
const CHECK_FIELDS = [
  'agent_id',
  'reviewed_paths',
  'invariant',
  'revision',
  'method',
  'test_kind',
  'virtualized_boundaries',
  'outcome',
  'result',
  'artifact',
];
const CHECK_REVISIONS = new Set(['head', 'base', 'base_and_head', 'context']);
const CHECK_METHODS = new Set(['source', 'local']);
const LOCAL_TEST_KINDS = new Set([
  'existing_test',
  'real_env_test',
  'virtual_test',
  'base_head_differential',
]);
const CHECK_OUTCOMES = new Set(['pass', 'fail', 'inconclusive', 'blocked']);
const PRIOR_STATUSES = new Set([
  'new',
  'prior_confirmed_same_source',
  'prior_confirmed_changed_source',
  'prior_needs_validation',
  'prior_deferred',
  'prior_blocked',
  'prior_out_of_scope',
  'prior_covered_same_source',
  'prior_covered_changed_source',
  'prior_rejected_claim_changed',
  'none',
]);

function canonicalCoverageId(refs) {
  if (!isObject(refs)) throw new TypeError('canonical_refs must be an object');
  const fields = hasOwn(refs, 'lifecycle') ? [...REF_FIELDS, 'lifecycle'] : REF_FIELDS;
  if (
    Object.keys(refs).length !== fields.length ||
    fields.some((field) => !hasOwn(refs, field))
  ) {
    throw new TypeError('canonical_refs has missing or unexpected fields');
  }
  return fields.map((field) => encodeCanonicalRef(refs[field])).join('::');
}

function validateStringArray(value, location, errors, options = {}) {
  const { allowEmpty = true, fingerprint = false, pathValue = false, maxLength = LIMITS.maxTextLength } = options;
  if (!Array.isArray(value)) {
    errors.push(`${location}: expected array`);
    return;
  }
  if (!allowEmpty && value.length === 0) errors.push(`${location}: must not be empty`);
  if (value.length > LIMITS.collectionItems) {
    errors.push(`${location}: exceeds ${LIMITS.collectionItems} entries`);
  }
  const seen = new Set();
  value.slice(0, LIMITS.collectionItems).forEach((entry, index) => {
    const entryLocation = `${location}[${index}]`;
    const valid = pathValue ? isSafeRelativePath(entry) : isVisibleText(entry, maxLength);
    if (!valid) {
      errors.push(`${entryLocation}: invalid ${pathValue ? 'repository-relative path' : 'text'}`);
    }
    if (fingerprint && typeof entry === 'string' && !FINGERPRINT_PATTERN.test(entry)) {
      errors.push(`${entryLocation}: invalid fingerprint`);
    }
    if (typeof entry === 'string' && seen.has(entry)) {
      errors.push(`${entryLocation}: duplicate entry`);
    }
    if (typeof entry === 'string') seen.add(entry);
  });
}

function validateAxes(value, location, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${location}: expected array`);
    return;
  }
  if (value.length === 0) errors.push(`${location}: must not be empty`);
  if (value.length > AXES.length) {
    errors.push(`${location}: exceeds ${AXES.length} canonical axes`);
  }
  const seen = new Set();
  value.slice(0, LIMITS.collectionItems).forEach((axis, index) => {
    const loc = `${location}[${index}]`;
    if (typeof axis !== 'string' || !AXES_SET.has(axis)) {
      errors.push(`${loc}: invalid release axis ${safeQuote(axis)}`);
      return;
    }
    if (seen.has(axis)) errors.push(`${loc}: duplicate axis ${safeQuote(axis)}`);
    seen.add(axis);
  });
}

function validateChecks(value, location, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${location}: expected array`);
    return;
  }
  if (value.length > LIMITS.collectionItems) {
    errors.push(`${location}: exceeds ${LIMITS.collectionItems} entries`);
  }
  value.slice(0, LIMITS.collectionItems).forEach((check, index) => {
    const base = `${location}[${index}]`;
    if (!isObject(check)) {
      errors.push(`${base}: expected object`);
      return;
    }
    for (const field of CHECK_FIELDS) {
      if (!hasOwn(check, field)) {
        errors.push(`${base}: missing required field ${safeQuote(field)}`);
      }
    }
    for (const key of Object.keys(check)) {
      if (!CHECK_FIELDS.includes(key)) {
        errors.push(`${base}: unexpected field ${safeQuote(key)}`);
      }
    }
    if (!isSafeAgentId(check.agent_id)) {
      errors.push(`${base}.agent_id: expected a canonical lowercase agent ID`);
    }
    validateStringArray(check.reviewed_paths, `${base}.reviewed_paths`, errors, {
      allowEmpty: false,
      pathValue: true,
    });
    if (!isVisibleText(check.invariant)) errors.push(`${base}.invariant: invalid text`);
    if (typeof check.revision !== 'string' || !CHECK_REVISIONS.has(check.revision)) {
      errors.push(`${base}.revision: expected head, base, base_and_head, or context`);
    }
    if (typeof check.method !== 'string' || !CHECK_METHODS.has(check.method)) {
      errors.push(`${base}.method: expected "source" or "local"`);
    }
    if (check.method === 'source') {
      if (check.test_kind !== 'source_trace') {
        errors.push(`${base}.test_kind: source-only check must use "source_trace"`);
      }
      if (!Array.isArray(check.virtualized_boundaries) || check.virtualized_boundaries.length !== 0) {
        errors.push(`${base}.virtualized_boundaries: source-only check must use an empty array []`);
      }
    } else if (check.method === 'local') {
      if (typeof check.test_kind !== 'string' || !LOCAL_TEST_KINDS.has(check.test_kind)) {
        errors.push(
          `${base}.test_kind: local check requires existing_test, real_env_test, virtual_test, or base_head_differential`,
        );
      }
      validateStringArray(check.virtualized_boundaries, `${base}.virtualized_boundaries`, errors, {
        allowEmpty: true,
        maxLength: 512,
      });
    } else {
      if (typeof check.test_kind !== 'string') {
        errors.push(`${base}.test_kind: expected string`);
      }
      validateStringArray(check.virtualized_boundaries, `${base}.virtualized_boundaries`, errors, {
        allowEmpty: true,
        maxLength: 512,
      });
    }
    if (typeof check.outcome !== 'string' || !CHECK_OUTCOMES.has(check.outcome)) {
      errors.push(`${base}.outcome: expected pass, fail, inconclusive, or blocked`);
    }
    if (!isVisibleText(check.result)) errors.push(`${base}.result: invalid text`);

    if (check.method === 'source' && check.artifact !== null) {
      errors.push(`${base}.artifact: source-only check must use null`);
    } else if (check.method === 'local') {
      if (!isOwnedArtifactPath(check.artifact, check.agent_id)) {
        errors.push(
          `${base}.artifact: local check requires an artifact owned by agent ${safeQuote(isSafeAgentId(check.agent_id) ? check.agent_id : '<agent-id>')}`,
        );
      }
    } else if (
      check.method !== 'source' &&
      check.method !== 'local' &&
      check.artifact !== null &&
      !isSafeRelativePath(check.artifact)
    ) {
      errors.push(`${base}.artifact: expected null or a safe output-relative path`);
    }
  });
}

function validateReviewedPathOwnership(unit, base, errors) {
  if (!Array.isArray(unit.reviewed_paths) || !Array.isArray(unit.checks)) return;
  const aggregatePaths = new Set(unit.reviewed_paths.filter((v) => typeof v === 'string'));
  const ownedPaths = new Set();
  for (const check of unit.checks) {
    if (!isObject(check) || !Array.isArray(check.reviewed_paths)) continue;
    for (const p of check.reviewed_paths) {
      if (typeof p === 'string') ownedPaths.add(p);
    }
  }
  for (const p of aggregatePaths) {
    if (!ownedPaths.has(p)) {
      errors.push(`${base}.reviewed_paths: ${safeQuote(p)} has no check owner`);
    }
  }
  for (const p of ownedPaths) {
    if (!aggregatePaths.has(p)) {
      errors.push(`${base}.checks: owned path ${safeQuote(p)} is absent from aggregate reviewed_paths`);
    }
  }
}

function validateExcludedBlocks(value, location, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${location}: expected array`);
    return;
  }
  if (value.length > LIMITS.collectionItems) {
    errors.push(`${location}: exceeds ${LIMITS.collectionItems} entries`);
  }
  const seen = new Set();
  value.slice(0, LIMITS.collectionItems).forEach((entry, index) => {
    const base = `${location}[${index}]`;
    if (!isObject(entry)) {
      errors.push(`${base}: expected object`);
      return;
    }
    for (const field of ['block', 'reason']) {
      if (!hasOwn(entry, field)) errors.push(`${base}: missing required field ${safeQuote(field)}`);
    }
    for (const key of Object.keys(entry)) {
      if (key !== 'block' && key !== 'reason') {
        errors.push(`${base}: unexpected field ${safeQuote(key)}`);
      }
    }
    if (!isVisibleText(entry.block)) errors.push(`${base}.block: invalid text`);
    if (!isVisibleText(entry.reason)) errors.push(`${base}.reason: invalid text`);
    if (typeof entry.block === 'string' && seen.has(entry.block)) {
      errors.push(`${base}.block: duplicate entry`);
    }
    if (typeof entry.block === 'string') seen.add(entry.block);
  });
}

function semanticKey(unit) {
  return JSON.stringify([
    unit.feature,
    unit.surface,
    unit.subsystem,
    unit.defect_class,
    hasOwn(unit, 'lifecycle') ? unit.lifecycle : null,
  ]);
}

function hasValidSemanticFields(unit) {
  return ['feature', 'surface', 'subsystem', 'defect_class'].every((f) => isVisibleText(unit[f])) &&
    (!hasOwn(unit, 'lifecycle') || isVisibleText(unit.lifecycle));
}

function requireEmptyArray(unit, field, base, errors) {
  if (Array.isArray(unit[field]) && unit[field].length > 0) {
    errors.push(`${base}.${field}: unit with status ${safeQuote(unit.status)} must keep this array empty`);
  }
}

function requireNonemptyArray(unit, field, base, errors) {
  if (!Array.isArray(unit[field]) || unit[field].length === 0) {
    errors.push(`${base}.${field}: unit with status ${safeQuote(unit.status)} requires entries`);
  }
}

function validateStateInvariants(unit, base, errors) {
  const emptyEvidence = () => {
    requireEmptyArray(unit, 'reviewed_paths', base, errors);
    requireEmptyArray(unit, 'checks', base, errors);
  };
  const requireOwner = () => {
    if (!isSafeAgentId(unit.agent_id)) {
      errors.push(`${base}.agent_id: unit with status ${safeQuote(unit.status)} requires a canonical lowercase agent ID`);
    }
  };

  if (unit.status !== 'candidate') requireEmptyArray(unit, 'result_fingerprints', base, errors);

  switch (unit.status) {
    case 'planned':
      if (unit.agent_id !== null) errors.push(`${base}.agent_id: planned unit must be unassigned`);
      emptyEvidence();
      requireEmptyArray(unit, 'unresolved', base, errors);
      break;
    case 'not_applicable':
    case 'out_of_scope':
    case 'deferred':
      if (unit.agent_id !== null) {
        errors.push(`${base}.agent_id: unit with status ${safeQuote(unit.status)} must be unassigned`);
      }
      emptyEvidence();
      requireNonemptyArray(unit, 'unresolved', base, errors);
      break;
    case 'in_progress':
      requireOwner();
      emptyEvidence();
      requireEmptyArray(unit, 'unresolved', base, errors);
      break;
    case 'blocked':
      requireOwner();
      requireNonemptyArray(unit, 'reviewed_paths', base, errors);
      requireNonemptyArray(unit, 'checks', base, errors);
      requireNonemptyArray(unit, 'unresolved', base, errors);
      break;
    case 'covered':
      requireOwner();
      requireNonemptyArray(unit, 'reviewed_paths', base, errors);
      requireNonemptyArray(unit, 'checks', base, errors);
      requireEmptyArray(unit, 'unresolved', base, errors);
      if (Array.isArray(unit.checks) && unit.checks.some((c) => isObject(c) && c.outcome === 'fail')) {
        errors.push(`${base}.checks: covered unit cannot contain a check with outcome "fail"`);
      }
      break;
    case 'candidate':
      requireOwner();
      requireNonemptyArray(unit, 'reviewed_paths', base, errors);
      requireNonemptyArray(unit, 'checks', base, errors);
      requireNonemptyArray(unit, 'result_fingerprints', base, errors);
      break;
  }
}

function validateAttempts(value, unit, base, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${base}.attempts: expected array`);
    return;
  }
  if (value.length > LIMITS.collectionItems) {
    errors.push(`${base}.attempts: exceeds ${LIMITS.collectionItems} entries`);
  }

  const priorOwners = new Set();
  const priorArtifacts = new Set();
  let previousWave = 0;

  value.slice(0, LIMITS.collectionItems).forEach((attempt, index) => {
    const attemptBase = `${base}.attempts[${index}]`;
    if (!isObject(attempt)) {
      errors.push(`${attemptBase}: expected object`);
      return;
    }
    for (const field of ATTEMPT_FIELDS) {
      if (!hasOwn(attempt, field)) errors.push(`${attemptBase}: missing required field ${safeQuote(field)}`);
    }
    for (const key of Object.keys(attempt)) {
      if (!ATTEMPT_FIELDS.includes(key)) {
        errors.push(`${attemptBase}: unexpected field ${safeQuote(key)}`);
      }
    }
    if (!Number.isInteger(attempt.wave) || attempt.wave < 1) {
      errors.push(`${attemptBase}.wave: expected a positive integer`);
    } else {
      if (attempt.wave <= previousWave) {
        errors.push(`${attemptBase}.wave: archived attempt waves must be strictly increasing`);
      }
      if (Number.isInteger(unit.wave) && attempt.wave >= unit.wave) {
        errors.push(`${attemptBase}.wave: archived attempt wave must precede current wave ${safeQuote(unit.wave)}`);
      }
      previousWave = attempt.wave;
    }
    if (!ATTEMPT_STATUSES.has(attempt.status)) {
      errors.push(`${attemptBase}.status: expected "covered", "candidate", or "blocked"`);
    }
    let hasFreshOwner = false;
    if (!isSafeAgentId(attempt.agent_id)) {
      errors.push(`${attemptBase}.agent_id: archived attempt requires a canonical lowercase agent ID`);
    } else if (priorOwners.has(attempt.agent_id)) {
      errors.push(`${attemptBase}.agent_id: assignment owner must be fresh for each attempt`);
    } else {
      hasFreshOwner = true;
    }

    validateStringArray(attempt.reviewed_paths, `${attemptBase}.reviewed_paths`, errors, { pathValue: true });
    validateChecks(attempt.checks, `${attemptBase}.checks`, errors);
    validateReviewedPathOwnership(attempt, attemptBase, errors);
    validateStringArray(attempt.result_fingerprints, `${attemptBase}.result_fingerprints`, errors, {
      fingerprint: true,
    });
    validateStringArray(attempt.unresolved, `${attemptBase}.unresolved`, errors);
    if (!isVisibleText(attempt.reassignment_reason)) {
      errors.push(`${attemptBase}.reassignment_reason: invalid text`);
    }
    validateStateInvariants(attempt, attemptBase, errors);

    if (Array.isArray(attempt.checks)) {
      attempt.checks.forEach((check, checkIndex) => {
        if (!isObject(check)) return;
        if (priorOwners.has(check.agent_id)) {
          errors.push(
            `${attemptBase}.checks[${checkIndex}].agent_id: prior assignment owner evidence must remain in its earlier attempt`,
          );
        }
        if (typeof check.artifact === 'string' && priorArtifacts.has(check.artifact)) {
          errors.push(
            `${attemptBase}.checks[${checkIndex}].artifact: artifact from an earlier attempt cannot be reused`,
          );
        }
        if (check.method === 'local' && typeof check.artifact === 'string') {
          priorArtifacts.add(check.artifact);
        }
      });
    }
    if (hasFreshOwner) priorOwners.add(attempt.agent_id);
  });

  if (isSafeAgentId(unit.agent_id) && priorOwners.has(unit.agent_id)) {
    errors.push(`${base}.agent_id: current assignment owner must be fresh after reassignment`);
  }
  if (Array.isArray(unit.checks)) {
    unit.checks.forEach((check, index) => {
      if (!isObject(check)) return;
      if (priorOwners.has(check.agent_id)) {
        errors.push(
          `${base}.checks[${index}].agent_id: prior assignment owner evidence must remain in its archived attempt`,
        );
      }
      if (typeof check.artifact === 'string' && priorArtifacts.has(check.artifact)) {
        errors.push(
          `${base}.checks[${index}].artifact: artifact from an archived attempt cannot be reused`,
        );
      }
    });
  }
}

function collectUnitErrors(unit, index) {
  const errors = createErrorList();
  const base = `$[${index}]`;
  if (!isObject(unit)) return [`${base}: expected object`];

  for (const field of REQUIRED_FIELDS) {
    if (!hasOwn(unit, field)) errors.push(`${base}: missing required field ${safeQuote(field)}`);
  }
  for (const field of ['feature', 'surface', 'subsystem', 'defect_class']) {
    if (!isVisibleText(unit[field])) errors.push(`${base}.${field}: invalid text`);
  }
  if (hasOwn(unit, 'lifecycle') && !isVisibleText(unit.lifecycle)) {
    errors.push(`${base}.lifecycle: invalid text`);
  }

  let expectedId = null;
  if (!isObject(unit.canonical_refs)) {
    errors.push(`${base}.canonical_refs: expected object`);
  } else {
    const expectedFields = hasOwn(unit.canonical_refs, 'lifecycle')
      ? [...REF_FIELDS, 'lifecycle']
      : REF_FIELDS;
    for (const field of expectedFields) {
      if (!hasOwn(unit.canonical_refs, field)) {
        errors.push(`${base}.canonical_refs: missing required field ${safeQuote(field)}`);
      } else if (!isCanonicalRef(unit.canonical_refs[field])) {
        errors.push(`${base}.canonical_refs.${field}: invalid canonical reference`);
      }
    }
    if (Object.keys(unit.canonical_refs).some((field) => !expectedFields.includes(field))) {
      errors.push(`${base}.canonical_refs: contains unexpected fields`);
    }
    if (hasOwn(unit, 'lifecycle') !== hasOwn(unit.canonical_refs, 'lifecycle')) {
      errors.push(`${base}: lifecycle and canonical_refs.lifecycle must appear together`);
    }
    try {
      expectedId = canonicalCoverageId(unit.canonical_refs);
    } catch {
      // Specific reference errors above explain the mismatch.
    }
  }

  if (!isVisibleText(unit.coverage_id, 65536)) {
    errors.push(`${base}.coverage_id: invalid text`);
  } else if (expectedId !== null && unit.coverage_id !== expectedId) {
    errors.push(`${base}.coverage_id: expected canonical ID ${safeQuote(expectedId)}`);
  }

  validateAxes(unit.axes, `${base}.axes`, errors);
  validateStringArray(unit.starting_paths, `${base}.starting_paths`, errors, {
    allowEmpty: false,
    pathValue: true,
  });
  if (
    unit.ordinary_defect_class_block !== null &&
    !isVisibleText(unit.ordinary_defect_class_block)
  ) {
    errors.push(`${base}.ordinary_defect_class_block: expected null or non-empty text`);
  }
  validateStringArray(unit.selected_companion_blocks, `${base}.selected_companion_blocks`, errors);
  validateExcludedBlocks(unit.excluded_blocks, `${base}.excluded_blocks`, errors);

  if (Array.isArray(unit.excluded_blocks)) {
    const selected = new Set(
      Array.isArray(unit.selected_companion_blocks) ? unit.selected_companion_blocks : [],
    );
    unit.excluded_blocks.forEach((entry, blockIndex) => {
      if (!isObject(entry) || typeof entry.block !== 'string') return;
      if (selected.has(entry.block)) {
        errors.push(`${base}.excluded_blocks[${blockIndex}].block: block is also selected`);
      }
      if (
        typeof unit.ordinary_defect_class_block === 'string' &&
        entry.block === unit.ordinary_defect_class_block
      ) {
        errors.push(
          `${base}.excluded_blocks[${blockIndex}].block: block matches ordinary_defect_class_block`,
        );
      }
    });
  }

  if (!PRIOR_STATUSES.has(unit.prior_status)) {
    errors.push(`${base}.prior_status: invalid value ${safeQuote(unit.prior_status)}`);
  }
  if (!STATUSES.has(unit.status)) {
    errors.push(`${base}.status: invalid value ${safeQuote(unit.status)}`);
  }
  if (!Number.isInteger(unit.wave) || unit.wave < 1) {
    errors.push(`${base}.wave: expected a positive integer`);
  }
  if (unit.agent_id !== null && !isSafeAgentId(unit.agent_id)) {
    errors.push(`${base}.agent_id: expected null or a safe agent ID`);
  }

  validateAttempts(unit.attempts, unit, base, errors);
  validateStringArray(unit.reviewed_paths, `${base}.reviewed_paths`, errors, { pathValue: true });
  validateChecks(unit.checks, `${base}.checks`, errors);
  validateReviewedPathOwnership(unit, base, errors);
  validateStringArray(unit.result_fingerprints, `${base}.result_fingerprints`, errors, {
    fingerprint: true,
  });
  validateStringArray(unit.unresolved, `${base}.unresolved`, errors);

  if (hasOwn(unit, 'quality_notes')) {
    validateStringArray(unit.quality_notes, `${base}.quality_notes`, errors);
  }

  validateStateInvariants(unit, base, errors);
  return errors;
}

function validateDocument(ledger) {
  const errors = createErrorList();
  if (!Array.isArray(ledger)) {
    errors.push('$: expected a top-level array');
    return errors;
  }
  if (ledger.length > LIMITS.maxUnits) {
    errors.push(`$: exceeds ${LIMITS.maxUnits} coverage units`);
    return errors;
  }

  errors.push(...preflightDocument(ledger, { maxTopLevelItems: LIMITS.maxUnits }));
  if (errors.length > 0) return errors;

  const ids = new Map();
  const semantics = new Map();
  let previousId = null;

  for (let index = 0; index < ledger.length && errors.length < LIMITS.validationErrors; index++) {
    const unit = ledger[index];
    errors.push(...collectUnitErrors(unit, index));
    if (errors.length >= LIMITS.validationErrors) break;
    if (!isObject(unit) || typeof unit.coverage_id !== 'string') continue;

    const key = hasValidSemanticFields(unit) ? semanticKey(unit) : null;
    if (ids.has(unit.coverage_id)) {
      const previous = ids.get(unit.coverage_id);
      const qualifier = key !== null && previous.key !== null && previous.key !== key
        ? 'canonical identity collision with different semantic fields'
        : 'duplicate coverage ID';
      errors.push(`$[${index}].coverage_id: ${qualifier} at $[${previous.index}]`);
    } else {
      ids.set(unit.coverage_id, { index, key });
    }
    if (key !== null && semantics.has(key) && semantics.get(key).id !== unit.coverage_id) {
      const previous = semantics.get(key);
      errors.push(
        `$[${index}].canonical_refs: semantic tuple already uses coverage ID ${safeQuote(previous.id)} at $[${previous.index}]`,
      );
    } else if (key !== null) {
      semantics.set(key, { id: unit.coverage_id, index });
    }
    if (previousId !== null && previousId > unit.coverage_id) {
      errors.push(`$[${index}].coverage_id: units must be sorted lexicographically`);
    }
    previousId = unit.coverage_id;
  }

  return errors;
}

function run(file) {
  if (!file) {
    console.error('Usage: node validate-coverage-ledger.cjs <path-to-coverage-ledger.json>');
    return 1;
  }

  let contents;
  try {
    contents = readFileWithinLimit(file);
  } catch (error) {
    const reason = error instanceof SafeInputError ? error.message : 'input could not be opened or read safely';
    console.error(`Failed to read coverage ledger: ${reason}`);
    return 1;
  }

  let ledger;
  try {
    preflightJsonText(contents, { maxTopLevelItems: LIMITS.maxUnits, topLevelLabel: 'unit' });
  } catch (error) {
    const reason = error instanceof JsonStructureError ? error.message : 'invalid JSON structure';
    console.error(`Failed to parse coverage ledger: ${reason}`);
    return 1;
  }

  try {
    ledger = JSON.parse(contents);
  } catch {
    console.error('Failed to parse coverage ledger: invalid JSON syntax');
    return 1;
  }

  let errors;
  try {
    errors = validateDocument(ledger);
  } catch {
    console.error('Failed to validate coverage ledger: unexpected validation error');
    return 1;
  }

  for (const message of errors) console.error('ERROR:', escapeUnsafeDiagnosticCharacters(message));
  if (errors.length > 0) {
    const cap = errors.length === LIMITS.validationErrors ? `; output capped at ${LIMITS.validationErrors}` : '';
    console.error(`FAIL: ${errors.length} validation error(s)${cap}`);
    return 1;
  }
  console.log(`PASS: ${ledger.length} coverage unit(s) valid`);
  return 0;
}

module.exports = {
  AXES,
  LIMITS,
  canonicalCoverageId,
  encodeCanonicalRef,
  validateDocument,
};

if (require.main === module) process.exit(run(process.argv[2]));
