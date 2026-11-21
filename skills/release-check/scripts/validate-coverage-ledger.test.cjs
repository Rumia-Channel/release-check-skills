'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  canonicalCoverageId,
  encodeCanonicalRef,
  validateDocument,
} = require('./validate-coverage-ledger.cjs');

function makeRefs(overrides = {}) {
  return {
    feature: 'cli-export',
    surface: 'src/cli/export.ts#runExport',
    subsystem: 'packages/cli',
    defect_class: 'DEFECT-CLASSES.md#Silent failures and swallowed errors',
    ...overrides,
  };
}

function makeCheck(agentId = 'hunter-1', overrides = {}) {
  const method = overrides.method || 'source';
  return {
    agent_id: agentId,
    reviewed_paths: ['packages/cli/src/export.ts'],
    invariant: 'Errors writing export file must fail with non-zero status',
    revision: 'head',
    method,
    test_kind: method === 'source' ? 'source_trace' : 'virtual_test',
    virtualized_boundaries: [],
    outcome: 'pass',
    result: 'fs.writeFileSync error propagates to main handler',
    artifact: null,
    ...overrides,
  };
}

function makeUnit(overrides = {}) {
  const refs = overrides.canonical_refs || makeRefs();
  return {
    coverage_id: canonicalCoverageId(refs),
    canonical_refs: refs,
    feature: 'CLI JSON export',
    surface: 'cli export',
    subsystem: 'packages/cli',
    defect_class: 'Silent failures and swallowed errors',
    axes: ['primary', 'error'],
    starting_paths: ['packages/cli/src/export.ts'],
    ordinary_defect_class_block: 'DEFECT-CLASSES.md#Silent failures and swallowed errors',
    selected_companion_blocks: ['CLI-LIBRARY-AND-PACKAGING.md#Core discipline'],
    excluded_blocks: [{ block: 'UI-AND-FRONTEND.md#Core discipline', reason: 'CLI only' }],
    prior_status: 'none',
    attempts: [],
    wave: 1,
    status: 'planned',
    agent_id: null,
    reviewed_paths: [],
    checks: [],
    result_fingerprints: [],
    unresolved: [],
    ...overrides,
  };
}

function expectInvalid(ledger, snippet) {
  const errors = validateDocument(ledger);
  assert.ok(
    errors.some((e) => e.includes(snippet)),
    `Expected error containing ${JSON.stringify(snippet)}, got: ${JSON.stringify(errors)}`,
  );
}

test('RFC 3986 canonical ID encoding handles reserved and UTF-8 bytes deterministically', () => {
  assert.equal(encodeCanonicalRef('alpha-._~09'), 'alpha-._~09');
  assert.equal(encodeCanonicalRef('a/b c:é'), 'a%2Fb%20c%3A%C3%A9');
  const id = canonicalCoverageId(makeRefs({ lifecycle: 'upgrade/v1->v2' }));
  assert.equal(id.split('::').length, 5);
});

test('valid ledger across multiple states passes', () => {
  const refsA = makeRefs({ defect_class: 'DEFECT-CLASSES.md#Hollow, stubbed, and unwired implementations' });
  const refsB = makeRefs();
  const refsC = makeRefs({ surface: 'src/cli/export.ts#parseArgs' });
  const refsD = makeRefs({ surface: 'src/cli/export.ts#writeOutput' });
  const ledger = [
    makeUnit({
      canonical_refs: refsA,
      coverage_id: canonicalCoverageId(refsA),
      defect_class: 'Hollow, stubbed, and unwired implementations',
      status: 'planned',
    }),
    makeUnit({
      canonical_refs: refsB,
      coverage_id: canonicalCoverageId(refsB),
      status: 'covered',
      agent_id: 'hunter-1',
      reviewed_paths: ['packages/cli/src/export.ts'],
      checks: [makeCheck('hunter-1')],
    }),
    makeUnit({
      canonical_refs: refsC,
      coverage_id: canonicalCoverageId(refsC),
      surface: 'parseArgs',
      status: 'candidate',
      agent_id: 'hunter-2',
      reviewed_paths: ['packages/cli/src/export.ts', 'packages/cli/src/args.ts'],
      checks: [
        makeCheck('hunter-2', {
          reviewed_paths: ['packages/cli/src/args.ts'],
          outcome: 'fail',
          method: 'local',
          artifact: 'agents/hunter-2/artifacts/out-flag.txt',
        }),
        makeCheck('verifier-1', {
          reviewed_paths: ['packages/cli/src/export.ts'],
          outcome: 'fail',
        }),
      ],
      result_fingerprints: ['export-out-flag-unwired'],
    }),
    makeUnit({
      canonical_refs: refsD,
      coverage_id: canonicalCoverageId(refsD),
      surface: 'writeOutput',
      status: 'deferred',
      unresolved: ['budget_cannot_reserve_critics_and_validation'],
    }),
  ].sort((a, b) => (a.coverage_id < b.coverage_id ? -1 : 1));

  assert.deepEqual(validateDocument(ledger), []);
});

test('detects canonical identity collision, sorting, and semantic duplication', () => {
  const u1 = makeUnit();
  const u2 = makeUnit({ feature: 'Different feature label' });
  expectInvalid([u1, u2], 'canonical identity collision');

  const u3 = makeUnit({
    canonical_refs: makeRefs({ surface: 'other-surface' }),
    coverage_id: canonicalCoverageId(makeRefs({ surface: 'other-surface' })),
  });
  expectInvalid([u1, u3], 'semantic tuple already uses coverage ID');

  const uOther = makeUnit({
    canonical_refs: makeRefs({ feature: 'aaa-first' }),
    coverage_id: canonicalCoverageId(makeRefs({ feature: 'aaa-first' })),
    feature: 'First',
  });
  expectInvalid([u1, uOther], 'sorted lexicographically');
});

test('enforces state invariants, failing check rule on covered, and path ownership', () => {
  const coveredFail = makeUnit({
    status: 'covered',
    agent_id: 'hunter-1',
    reviewed_paths: ['packages/cli/src/export.ts'],
    checks: [makeCheck('hunter-1', { outcome: 'fail' })],
  });
  expectInvalid([coveredFail], 'cannot contain a check with outcome "fail"');

  const mismatchUnion = makeUnit({
    status: 'covered',
    agent_id: 'hunter-1',
    reviewed_paths: ['packages/cli/src/export.ts', 'extra.ts'],
    checks: [makeCheck('hunter-1')],
  });
  expectInvalid([mismatchUnion], 'has no check owner');

  const badArtifact = makeUnit({
    status: 'covered',
    agent_id: 'hunter-1',
    reviewed_paths: ['packages/cli/src/export.ts'],
    checks: [
      makeCheck('hunter-1', {
        method: 'local',
        artifact: 'agents/other-agent/artifacts/log.txt',
      }),
    ],
  });
  expectInvalid([badArtifact], 'requires an artifact owned by agent');

  const reservedAgent = makeUnit({
    status: 'in_progress',
    agent_id: 'con',
  });
  expectInvalid([reservedAgent], 'canonical lowercase agent ID');

  const sourceWithVirtualKind = makeUnit({
    status: 'covered',
    agent_id: 'hunter-1',
    reviewed_paths: ['packages/cli/src/export.ts'],
    checks: [makeCheck('hunter-1', { method: 'source', test_kind: 'virtual_test' })],
  });
  expectInvalid([sourceWithVirtualKind], 'source-only check must use "source_trace"');

  const sourceWithVirtualBoundaries = makeUnit({
    status: 'covered',
    agent_id: 'hunter-1',
    reviewed_paths: ['packages/cli/src/export.ts'],
    checks: [makeCheck('hunter-1', { method: 'source', virtualized_boundaries: ['clock'] })],
  });
  expectInvalid([sourceWithVirtualBoundaries], 'must use an empty array []');

  const localWithSourceKind = makeUnit({
    status: 'covered',
    agent_id: 'hunter-1',
    reviewed_paths: ['packages/cli/src/export.ts'],
    checks: [
      makeCheck('hunter-1', {
        method: 'local',
        test_kind: 'source_trace',
        artifact: 'agents/hunter-1/artifacts/run.txt',
      }),
    ],
  });
  expectInvalid([localWithSourceKind], 'local check requires existing_test, real_env_test, virtual_test, or base_head_differential');
});

test('enforces append-only attempts archive and fresh ownership after critic reassignment', () => {
  const reopened = makeUnit({
    wave: 2,
    status: 'covered',
    agent_id: 'hunter-2',
    reviewed_paths: ['packages/cli/src/export.ts'],
    checks: [
      makeCheck('hunter-2', {
        method: 'local',
        artifact: 'agents/hunter-2/artifacts/retest.txt',
      }),
    ],
    attempts: [
      {
        wave: 1,
        status: 'blocked',
        agent_id: 'hunter-1',
        reviewed_paths: ['packages/cli/src/export.ts'],
        checks: [
          makeCheck('hunter-1', {
            outcome: 'blocked',
            method: 'local',
            artifact: 'agents/hunter-1/artifacts/partial.txt',
          }),
        ],
        result_fingerprints: [],
        unresolved: ['Initial run missing fixture'],
        reassignment_reason: 'Critic found local fixture available in tests/',
      },
    ],
  });
  assert.deepEqual(validateDocument([reopened]), []);

  const reusedOwner = structuredClone(reopened);
  reusedOwner.agent_id = 'hunter-1';
  expectInvalid([reusedOwner], 'must be fresh after reassignment');

  const reusedArtifact = structuredClone(reopened);
  reusedArtifact.checks[0].artifact = 'agents/hunter-1/artifacts/partial.txt';
  expectInvalid([reusedArtifact], 'cannot be reused');

  const badWave = structuredClone(reopened);
  badWave.attempts[0].wave = 2;
  expectInvalid([badWave], 'must precede current wave');
});

test('enforces axes and disjoint excluded_blocks and runs via CLI', () => {
  const badAxes = makeUnit({ axes: [] });
  expectInvalid([badAxes], 'must not be empty');

  const overlapExclude = makeUnit({
    excluded_blocks: [{ block: 'CLI-LIBRARY-AND-PACKAGING.md#Core discipline', reason: 'overlap' }],
  });
  expectInvalid([overlapExclude], 'block is also selected');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-ledger-'));
  try {
    const file = path.join(tmpDir, 'coverage-ledger.json');
    fs.writeFileSync(file, JSON.stringify([makeUnit()], null, 2));
    const out = execFileSync(
      process.execPath,
      [path.join(__dirname, 'validate-coverage-ledger.cjs'), file],
      { encoding: 'utf8' },
    );
    assert.match(out, /PASS: 1 coverage unit\(s\) valid/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
