'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { AXES } = require('./lib/validation-utils.cjs');
const { canonicalCoverageId } = require('./validate-coverage-ledger.cjs');
const { validateOutputDirectory, validateRunObjects } = require('./validate-run.cjs');

function makeMetadata(overrides = {}) {
  return {
    run_id: 'run-1',
    repo: 'example/app',
    target: '/repo/app',
    base_ref: '1111111',
    head_ref: '2222222',
    worktree_dirty: false,
    profile: 'standard',
    scope_paths: ['.'],
    budget: 25,
    execution_policy: 'sandboxed-source-and-local-only',
    selected_companions: ['CLI-LIBRARY-AND-PACKAGING.md'],
    prior_runs: [],
    shared_file_owners: { parent: 'coordinator' },
    run_status: 'complete',
    incomplete_reason: null,
    ...overrides,
  };
}

function makeCatalog() {
  return [
    {
      feature_id: 'cli-export',
      name: 'CLI Export',
      kind: 'user_feature',
      purpose: 'Export JSON records',
      intent_status: 'documented',
      intent_evidence: [{ ref: 'README.md', line: 10, detail: 'Describes export' }],
      entrypoints: ['src/export.ts#run'],
      contracts: ['Exports records to --out'],
      dependencies: ['config-loader'],
      status: 'in_scope',
      exclusion_reason: null,
    },
    {
      feature_id: 'config-loader',
      name: 'Config Loader',
      kind: 'cross_cutting',
      purpose: 'Load layered configuration',
      intent_status: 'documented',
      intent_evidence: [{ ref: 'README.md', line: 20, detail: 'Config precedence' }],
      entrypoints: ['src/config.ts#load'],
      contracts: ['CLI flags override env'],
      dependencies: [],
      status: 'in_scope',
      exclusion_reason: null,
    },
    {
      feature_id: 'legacy-xml',
      name: 'Legacy XML',
      kind: 'user_feature',
      purpose: null,
      intent_status: 'unknown',
      intent_evidence: [],
      entrypoints: ['src/xml.ts'],
      contracts: ['Legacy parser'],
      dependencies: [],
      status: 'out_of_scope',
      exclusion_reason: 'Excluded by user scope',
    },
  ];
}

function makeUnit(feature, defectClass, axes, overrides = {}) {
  const refs = {
    feature,
    surface: `src/${feature}.ts#entry`,
    subsystem: 'core',
    defect_class: defectClass,
  };
  const agent = overrides.agent_id === undefined ? 'hunter-1' : overrides.agent_id;
  return {
    coverage_id: canonicalCoverageId(refs),
    canonical_refs: refs,
    feature,
    surface: `${feature} entry`,
    subsystem: 'core',
    defect_class: defectClass,
    axes,
    starting_paths: [`src/${feature}.ts`],
    ordinary_defect_class_block: defectClass,
    selected_companion_blocks: [],
    excluded_blocks: [],
    prior_status: 'none',
    attempts: [],
    wave: 1,
    status: 'covered',
    agent_id: agent,
    reviewed_paths: agent ? [`src/${feature}.ts`] : [],
    checks: agent
      ? [
        {
          agent_id: agent,
          reviewed_paths: [`src/${feature}.ts`],
          invariant: 'Contract verified',
          revision: 'head',
          method: 'source',
          test_kind: 'source_trace',
          virtualized_boundaries: [],
          outcome: 'pass',
          result: 'Verified path',
          artifact: null,
        },
      ]
      : [],
    result_fingerprints: [],
    unresolved: [],
    ...overrides,
  };
}

function makeFullFixture(withBase = true) {
  const uExportPrimary = makeUnit(
    'cli-export',
    'DEFECT-CLASSES.md#Hollow, stubbed, and unwired implementations',
    ['primary', 'boundary', 'error'],
    {
      status: 'candidate',
      agent_id: 'hunter-1',
      checks: [
        {
          agent_id: 'hunter-1',
          reviewed_paths: ['src/cli-export.ts'],
          invariant: '--out writes file',
          revision: 'head',
          method: 'local',
          test_kind: 'virtual_test',
          virtualized_boundaries: [],
          outcome: 'fail',
          result: 'File not created',
          artifact: 'agents/hunter-1/artifacts/export.txt',
        },
      ],
      result_fingerprints: ['fp-defect'],
    },
  );

  const uExportCompat = makeUnit(
    'cli-export',
    'DEFECT-CLASSES.md#Backward compatibility and revision regressions',
    ['integration', 'compatibility', 'lifecycle'],
    withBase
      ? {
        status: 'candidate',
        agent_id: 'hunter-2',
        reviewed_paths: ['src/cli-export.ts'],
        checks: [
          {
            agent_id: 'hunter-2',
            reviewed_paths: ['src/cli-export.ts'],
            invariant: 'Empty input returns []',
            revision: 'base_and_head',
            method: 'local',
            test_kind: 'base_head_differential',
            virtualized_boundaries: [],
            outcome: 'fail',
            result: 'BASE passed, HEAD threw',
            artifact: 'agents/hunter-2/artifacts/regression.txt',
          },
        ],
        result_fingerprints: ['fp-reg'],
      }
      : {
        status: 'covered',
        agent_id: 'hunter-2',
        reviewed_paths: ['src/cli-export.ts'],
        checks: [
          {
            agent_id: 'hunter-2',
            reviewed_paths: ['src/cli-export.ts'],
            invariant: 'Compatibility path reviewed',
            revision: 'head',
            method: 'source',
            test_kind: 'source_trace',
            virtualized_boundaries: [],
            outcome: 'pass',
            result: 'Source path valid',
            artifact: null,
          },
        ],
        result_fingerprints: [],
      },
  );

  const uConfig = makeUnit(
    'config-loader',
    'DEFECT-CLASSES.md#Silent failures and swallowed errors',
    ['primary', 'error'],
    {
      agent_id: 'hunter-3',
      reviewed_paths: ['src/config-loader.ts'],
      checks: [
        {
          agent_id: 'hunter-3',
          reviewed_paths: ['src/config-loader.ts'],
          invariant: 'Malformed JSON errors cleanly',
          revision: 'head',
          method: 'source',
          test_kind: 'source_trace',
          virtualized_boundaries: [],
          outcome: 'pass',
          result: 'Throws parse error',
          artifact: null,
        },
      ],
    },
  );

  const uXml = makeUnit(
    'legacy-xml',
    'DEFECT-CLASSES.md#Business logic, invariants, and edge-case defects',
    ['primary'],
    {
      status: 'out_of_scope',
      agent_id: null,
      reviewed_paths: [],
      checks: [],
      unresolved: ['Excluded by user scope'],
    },
  );

  const ledger = [uExportPrimary, uExportCompat, uConfig, uXml].sort((a, b) =>
    a.coverage_id < b.coverage_id ? -1 : 1,
  );

  const defect = {
    verdict: 'confirmed_defect',
    fingerprint: 'fp-defect',
    feature_id: 'cli-export',
    coverage_ids: [uExportPrimary.coverage_id],
    title: 'Export --out ignored',
    description: 'Flag ignored at sink',
    defect_category: 'hollow_or_unwired',
    root_cause: 'Wrong option key read',
    intended_behavior: 'Writes to --out path',
    intent_status: 'documented',
    trace: [{ kind: 'sink', file: 'src/cli-export.ts', line: 10, scope: 'run', description: 'Writes stdout' }],
    evidence: [{ file: 'src/cli-export.ts', line: 10, description: 'Hardcoded stdout' }],
    conditions: [],
    execution: {
      test_kind: 'virtual_test',
      virtualized_boundaries: [],
      caller_perspective: 'CLI user',
      inputs: ['--out a.json'],
      instructions: ['Run CLI in scratch'],
      head_observed_result: 'Writes stdout instead of a.json',
      base_observed_result: null,
      environment_comparability: null,
    },
    remediation: {
      strategy: 'Use opts.out',
      regression_test: 'Verify a.json created',
    },
    severity: {
      likelihood: { score: 'high', reason: 'Direct CLI option' },
      impact: { score: 'high', reason: 'Feature fails silently' },
      overall_severity: 'high',
    },
    confidence: { score: 'high', reason: 'Reproduced in scratch' },
  };

  const regression = {
    verdict: 'confirmed_regression',
    fingerprint: 'fp-reg',
    feature_id: 'cli-export',
    coverage_ids: [uExportCompat.coverage_id],
    title: 'Empty export crashes in HEAD',
    description: 'BASE returned [], HEAD throws',
    defect_category: 'logic_or_edge',
    intent_classification: 'unintended',
    root_cause: 'Unchecked index 0',
    intended_behavior: 'Empty array returns []',
    intent_status: 'documented',
    trace: [{ kind: 'sink', file: 'src/cli-export.ts', line: 22, scope: 'serialize', description: 'rows[0]' }],
    evidence: [{ file: 'src/cli-export.ts', line: 22, description: 'Throws TypeError' }],
    conditions: [],
    execution: {
      test_kind: 'base_head_differential',
      virtualized_boundaries: [],
      caller_perspective: 'CLI user',
      inputs: ['[]'],
      instructions: ['Run BASE and HEAD on empty input'],
      base_observed_result: 'Outputs []',
      head_observed_result: 'Throws TypeError',
      environment_comparability: 'Same Node runtime',
    },
    remediation: {
      strategy: 'Guard empty array',
      regression_test: 'Assert [] succeeds',
    },
    severity: {
      likelihood: { score: 'medium', reason: 'Empty store' },
      impact: { score: 'high', reason: 'Crash' },
      overall_severity: 'medium',
    },
    confidence: { score: 'high', reason: 'BASE vs HEAD observed' },
  };

  const findings = (withBase ? [defect, regression] : [defect]).sort((a, b) =>
    a.fingerprint < b.fingerprint ? -1 : 1,
  );

  return {
    metadata: makeMetadata(withBase ? {} : { base_ref: null }),
    catalog: makeCatalog(),
    ledger,
    findings,
  };
}

function expectInvalid(bundle, snippet) {
  const errors = validateRunObjects(bundle);
  assert.ok(
    errors.some((e) => e.includes(snippet)),
    `Expected error containing ${JSON.stringify(snippet)}, got: ${JSON.stringify(errors)}`,
  );
}

test('complete run with confirmed_defect and confirmed_regression passes', () => {
  assert.deepEqual(validateRunObjects(makeFullFixture(true)), []);
});

test('complete run without base_ref passes with confirmed_defect', () => {
  assert.deepEqual(validateRunObjects(makeFullFixture(false)), []);
});

test('rejects base evidence and base verdicts when base_ref is null', () => {
  const withBaseFindings = makeFullFixture(true);
  withBaseFindings.metadata.base_ref = null;
  expectInvalid(withBaseFindings, 'requires a non-null base_ref');
  expectInvalid(withBaseFindings, 'forbidden without base_ref');

  const defectWithBaseObs = makeFullFixture(false);
  defectWithBaseObs.findings[0].execution.base_observed_result = 'Passed at old commit';
  expectInvalid(defectWithBaseObs, 'cannot report BASE observation without base_ref');

  const defectWithDiffKind = makeFullFixture(false);
  defectWithDiffKind.findings[0].execution.test_kind = 'base_head_differential';
  expectInvalid(defectWithDiffKind, 'base_head_differential is forbidden without base_ref');

  const ledgerWithDiffKind = makeFullFixture(false);
  const candidateUnit = ledgerWithDiffKind.ledger.find((u) => u.status === 'candidate');
  candidateUnit.checks[0].test_kind = 'base_head_differential';
  expectInvalid(ledgerWithDiffKind, 'base_head_differential is forbidden without base_ref');
});

test('enforces all 6 release axes per in_scope user_feature and cross_cutting coverage', () => {
  const missingAxis = makeFullFixture(false);
  const compatUnit = missingAxis.ledger.find(
    (u) => u.canonical_refs.defect_class.includes('Backward compatibility'),
  );
  compatUnit.axes = ['integration', 'compatibility'];
  expectInvalid(missingAxis, 'missing axis "lifecycle"');

  const missingCrossCutting = makeFullFixture(false);
  missingCrossCutting.ledger = missingCrossCutting.ledger.filter(
    (u) => u.canonical_refs.feature !== 'config-loader',
  );
  expectInvalid(missingCrossCutting, 'cross_cutting feature "config-loader" has no coverage unit');
  assert.equal(AXES.length, 6);
});

test('rejects active units on out_of_scope features and broken finding->ledger links', () => {
  const activeOos = makeFullFixture(false);
  const oosUnit = activeOos.ledger.find((u) => u.canonical_refs.feature === 'legacy-xml');
  oosUnit.status = 'planned';
  oosUnit.unresolved = [];
  expectInvalid(activeOos, 'cannot have active status "planned"');

  const orphanFp = makeFullFixture(false);
  orphanFp.findings[0].fingerprint = 'fp-not-in-unit';
  expectInvalid(orphanFp, 'absent from result_fingerprints');

  const wrongFeatureLink = makeFullFixture(false);
  const configUnit = wrongFeatureLink.ledger.find((u) => u.canonical_refs.feature === 'config-loader');
  wrongFeatureLink.findings[0].coverage_ids = [configUnit.coverage_id];
  expectInvalid(wrongFeatureLink, 'links to feature "config-loader" instead of "cli-export"');
});

test('enforces completion gate and metadata rules', () => {
  const unvalidatedInAttempt = makeFullFixture(false);
  unvalidatedInAttempt.ledger[2].wave = 2;
  unvalidatedInAttempt.ledger[2].attempts = [
    {
      wave: 1,
      status: 'candidate',
      agent_id: 'hunter-old',
      reviewed_paths: ['src/config-loader.ts'],
      checks: [
        {
          agent_id: 'hunter-old',
          reviewed_paths: ['src/config-loader.ts'],
          invariant: 'Test',
          revision: 'head',
          method: 'source',
          test_kind: 'source_trace',
          virtualized_boundaries: [],
          outcome: 'fail',
          result: 'Candidate spotted',
          artifact: null,
        },
      ],
      result_fingerprints: ['fp-forgotten-in-attempt'],
      unresolved: [],
      reassignment_reason: 'Reopened',
    },
  ];
  expectInvalid(unvalidatedInAttempt, 'fp-forgotten-in-attempt');

  const incompleteValid = makeFullFixture(false);
  incompleteValid.metadata.run_status = 'incomplete';
  incompleteValid.metadata.incomplete_reason = 'validation_budget_exhausted';
  assert.deepEqual(validateRunObjects(incompleteValid), []);

  const badIncomplete = makeFullFixture(false);
  badIncomplete.metadata.run_status = 'incomplete';
  badIncomplete.metadata.incomplete_reason = null;
  expectInvalid(badIncomplete, 'incomplete run requires visible incomplete_reason');
});

test('validates real output directory and executes CLI end-to-end', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-run-'));
  try {
    const bundle = makeFullFixture(true);
    fs.writeFileSync(path.join(tmpDir, 'run-metadata.json'), JSON.stringify(bundle.metadata, null, 2));
    fs.writeFileSync(path.join(tmpDir, 'feature-catalog.json'), JSON.stringify(bundle.catalog, null, 2));
    fs.writeFileSync(path.join(tmpDir, 'coverage-ledger.json'), JSON.stringify(bundle.ledger, null, 2));
    fs.writeFileSync(path.join(tmpDir, 'findings.json'), JSON.stringify(bundle.findings, null, 2));

    assert.deepEqual(validateOutputDirectory(tmpDir), []);

    const out = execFileSync(
      process.execPath,
      [path.join(__dirname, 'validate-run.cjs'), tmpDir],
      { encoding: 'utf8' },
    );
    assert.match(out, /PASS: run metadata, feature catalog, coverage ledger, and findings cross-validated/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
