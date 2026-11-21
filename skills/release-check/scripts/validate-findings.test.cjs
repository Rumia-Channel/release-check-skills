'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadSchema, validateDocument } = require('./validate-findings.cjs');

const schema = loadSchema();

function baseTrace() {
  return [
    {
      kind: 'entrypoint',
      file: 'src/cli/export.ts',
      line: 12,
      scope: 'runExport',
      description: 'Reads --out option from parsed CLI flags',
    },
    {
      kind: 'propagation',
      file: 'src/cli/export.ts',
      line: 25,
      scope: 'formatOutput',
      description: 'Builds JSON payload and passes options object',
    },
    {
      kind: 'sink',
      file: 'src/io/writer.ts',
      line: 40,
      scope: 'writeOutput',
      description: 'Ignores opts.out and always writes to process.stdout',
    },
  ];
}

function baseEvidence() {
  return [{ file: 'src/io/writer.ts', line: 40, description: 'Hardcodes stdout write' }];
}

function makeConfirmedDefect(fp = 'a-defect') {
  return {
    verdict: 'confirmed_defect',
    fingerprint: fp,
    feature_id: 'cli-export',
    coverage_ids: ['cov-1'],
    title: 'Export --out flag is ignored',
    description: 'Passing --out writes JSON to stdout instead of creating the requested output file.',
    defect_category: 'hollow_or_unwired',
    root_cause: 'writeOutput reads options.outputFile instead of options.out',
    intended_behavior: '--out writes JSON to the requested file path',
    intent_status: 'documented',
    trace: baseTrace(),
    evidence: baseEvidence(),
    conditions: [{ kind: 'input_shape', description: 'When --out <file> is provided' }],
    execution: {
      test_kind: 'virtual_test',
      virtualized_boundaries: [],
      caller_perspective: 'CLI user running export --out result.json',
      inputs: ['export --out result.json'],
      instructions: ['Run built CLI in isolated scratch dir with --out result.json'],
      head_observed_result: 'Exit code 0, stdout contains JSON, result.json does not exist',
      base_observed_result: null,
      environment_comparability: null,
    },
    remediation: {
      strategy: 'Read options.out consistently in writeOutput and write atomically',
      code_changes: [{ file_name: 'src/io/writer.ts', fixed_code: 'const target = opts.out;' }],
      regression_test: 'Assert --out writes target file and leaves stdout empty',
    },
    severity: {
      likelihood: { score: 'high', reason: 'Flag documented as primary interface' },
      impact: { score: 'high', reason: 'Advertised file export produces no file silently' },
      overall_severity: 'high',
    },
    confidence: { score: 'high', reason: 'Directly reproduced locally on HEAD' },
  };
}

function makeConfirmedRegression(fp = 'b-regression') {
  return {
    verdict: 'confirmed_regression',
    fingerprint: fp,
    feature_id: 'cli-export',
    coverage_ids: ['cov-2'],
    title: 'Empty dataset export throws TypeError',
    description: 'Exporting zero records throws in HEAD whereas BASE emitted [] cleanly.',
    defect_category: 'logic_or_edge',
    intent_classification: 'unintended',
    root_cause: 'rows[0].schema accessed without empty-array check',
    intended_behavior: 'Empty array exports valid [] JSON',
    intent_status: 'documented',
    trace: [{ kind: 'sink', file: 'src/cli/export.ts', line: 55, scope: 'serialize', description: 'Unchecked rows[0]' }],
    evidence: [{ file: 'src/cli/export.ts', line: 55, description: 'Throws on empty array' }],
    conditions: [{ kind: 'data_state', description: 'Zero matching records in store' }],
    execution: {
      test_kind: 'base_head_differential',
      virtualized_boundaries: [],
      caller_perspective: 'CLI user exporting an empty workspace',
      inputs: ['[]'],
      instructions: ['Invoke export against empty fixture on BASE and HEAD'],
      base_observed_result: 'Outputs "[]" and exits 0',
      head_observed_result: 'Exits 1 with TypeError: Cannot read properties of undefined',
      environment_comparability: 'Identical Node runtime and scratch fixtures at BASE and HEAD',
    },
    remediation: {
      strategy: 'Return [] early when rows.length === 0',
      regression_test: 'Export empty store fixture and assert exit 0 and [] output',
    },
    severity: {
      likelihood: { score: 'medium', reason: 'Occurs on fresh workspaces' },
      impact: { score: 'high', reason: 'Primary export command crashes' },
      overall_severity: 'medium',
    },
    confidence: { score: 'high', reason: 'Verified BASE pass vs HEAD fail locally' },
  };
}

function makeConfirmedChange(fp = 'c-change') {
  return {
    verdict: 'confirmed_change',
    fingerprint: fp,
    feature_id: 'cli-export',
    coverage_ids: ['cov-3'],
    title: 'Pretty-printed JSON indentation changed from 2 to 4 spaces',
    description: 'Output indentation width changed between BASE and HEAD.',
    intent_classification: 'unknown',
    behavior_before: 'JSON.stringify(data, null, 2)',
    behavior_after: 'JSON.stringify(data, null, 4)',
    impact_summary: 'Consumers parsing JSON unaffected; snapshot tests on whitespace fail',
    migration_or_compat_notes: 'Confirm with owners whether 4-space output is intentional',
    trace: [{ kind: 'sink', file: 'src/io/writer.ts', line: 44, scope: 'writeOutput', description: 'Indent parameter changed' }],
    evidence: [{ file: 'src/io/writer.ts', line: 44, description: 'Uses indent 4' }],
    conditions: [],
    execution: {
      test_kind: 'base_head_differential',
      virtualized_boundaries: [],
      caller_perspective: 'Caller diffing raw JSON output text',
      inputs: ['{"a":1}'],
      instructions: ['Run export on BASE and HEAD with single record'],
      base_observed_result: '2-space indentation',
      head_observed_result: '4-space indentation',
      environment_comparability: 'Same Node runtime and fixture',
    },
    confidence: { score: 'high', reason: 'Directly observed diff between BASE and HEAD' },
  };
}

function makeNeedsValidation(fp = 'd-needs') {
  return {
    verdict: 'needs_validation',
    fingerprint: fp,
    feature_id: 'cli-export',
    coverage_ids: ['cov-4'],
    title: 'Windows CRLF line ending handling unverified on Linux host',
    description: 'Path normalization branch for win32 cannot execute on Linux host.',
    claimed_verdict: 'confirmed_defect',
    claimed_root_cause: 'Line endings stripped inconsistently on win32 CRLF inputs',
    trace: baseTrace(),
    evidence: baseEvidence(),
    blockers: ['Audit host runs Linux; Windows runtime behavior unavailable locally'],
    validation_plan: {
      environment: 'Run export --out fixture on Windows runner and verify LF/CRLF preservation',
    },
  };
}

function makeRejected(fp = 'e-rejected') {
  return {
    verdict: 'rejected',
    fingerprint: fp,
    feature_id: 'cli-export',
    coverage_ids: ['cov-5'],
    title: 'Claimed missing close on write stream',
    description: 'Disproved because fs.writeFileSync closes descriptor internally.',
    claimed_root_cause: 'Descriptor leak on write error',
    trace: baseTrace(),
    evidence: baseEvidence(),
    reason: 'fs.writeFileSync handles closing the file descriptor in a finally block inside Node core.',
  };
}

function expectInvalid(findings, snippet) {
  const errors = validateDocument(findings, schema);
  assert.ok(
    errors.some((e) => e.includes(snippet)),
    `Expected error containing ${JSON.stringify(snippet)}, got: ${JSON.stringify(errors)}`,
  );
}

test('all five valid verdicts pass in lexicographic order', () => {
  const docs = [
    makeConfirmedDefect(),
    makeConfirmedRegression(),
    makeConfirmedChange(),
    makeNeedsValidation(),
    makeRejected(),
  ];
  assert.deepEqual(validateDocument(docs, schema), []);
});

test('enforces fingerprint uniqueness and sorting', () => {
  const dup = [makeConfirmedDefect('same'), makeRejected('same')];
  expectInvalid(dup, 'duplicate');

  const unsorted = [makeConfirmedRegression('z-fp'), makeConfirmedDefect('a-fp')];
  expectInvalid(unsorted, 'sorted lexicographically');
});

test('enforces severity <= impact and trace invariants', () => {
  const overSevere = makeConfirmedDefect();
  overSevere.severity.impact.score = 'low';
  overSevere.severity.overall_severity = 'high';
  expectInvalid([overSevere], 'cannot exceed demonstrated impact');

  const badTraceOrder = makeConfirmedDefect();
  badTraceOrder.trace[1].kind = 'sink';
  expectInvalid([badTraceOrder], 'must be "propagation"');

  const unsafePath = makeConfirmedDefect();
  unsafePath.evidence[0].file = '../outside.ts';
  expectInvalid([unsafePath], 'safe repository-relative');
});

test('enforces strict verdict separation and validation_plan non-emptiness', () => {
  const nvWithSeverity = makeNeedsValidation();
  nvWithSeverity.severity = {
    likelihood: { score: 'low', reason: 'x' },
    impact: { score: 'low', reason: 'x' },
    overall_severity: 'low',
  };
  expectInvalid([nvWithSeverity], 'unexpected field "severity"');

  const nvEmptyPlan = makeNeedsValidation();
  nvEmptyPlan.validation_plan = {};
  expectInvalid([nvEmptyPlan], 'requires at least one visible local, environment, or owner_intent step');

  const changeWithSeverity = makeConfirmedChange();
  changeWithSeverity.severity = { overall_severity: 'low' };
  expectInvalid([changeWithSeverity], 'unexpected field "severity"');

  const defectBadTestKind = makeConfirmedDefect();
  defectBadTestKind.execution.test_kind = 'source_trace';
  expectInvalid([defectBadTestKind], 'invalid value "source_trace"');

  const defectMissingVirtualBoundaries = makeConfirmedDefect();
  delete defectMissingVirtualBoundaries.execution.virtualized_boundaries;
  expectInvalid([defectMissingVirtualBoundaries], 'missing required field "virtualized_boundaries"');
});

test('CLI validates valid and invalid findings files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-find-'));
  try {
    const file = path.join(tmpDir, 'findings.json');
    fs.writeFileSync(file, JSON.stringify([makeConfirmedDefect()], null, 2));
    const out = execFileSync(
      process.execPath,
      [path.join(__dirname, 'validate-findings.cjs'), file],
      { encoding: 'utf8' },
    );
    assert.match(out, /PASS: 1 finding\(s\) valid/);

    const bad = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify([makeNeedsValidation()]));
    const nv = makeNeedsValidation();
    nv.validation_plan = {};
    fs.writeFileSync(bad, JSON.stringify([nv]));
    assert.throws(() => {
      execFileSync(process.execPath, [path.join(__dirname, 'validate-findings.cjs'), bad], {
        stdio: 'pipe',
      });
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
