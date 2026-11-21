'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadSchema, validateDocument } = require('./validate-feature-catalog.cjs');

const schema = loadSchema();

function makeCatalog() {
  return [
    {
      feature_id: 'cli-export',
      name: 'CLI JSON export',
      kind: 'user_feature',
      purpose: 'Export project records as JSON to stdout or a target file.',
      intent_status: 'documented',
      intent_evidence: [
        { ref: 'README.md', line: 14, detail: 'Documents `export --json` usage' },
        { ref: 'doc:docs/cli.md#export', detail: 'Specifies schema guarantees' },
      ],
      entrypoints: ['src/cli/export.ts#runExport'],
      contracts: [
        'Writes valid UTF-8 JSON to --out or stdout and exits 0',
        'Fails with non-zero exit code when destination is unwritable',
      ],
      dependencies: ['state-store'],
      status: 'in_scope',
      exclusion_reason: null,
    },
    {
      feature_id: 'config-loader',
      name: 'Config loader',
      kind: 'cross_cutting',
      purpose: 'Merge default, file, env, and CLI config layers.',
      intent_status: 'inferred',
      intent_evidence: [
        { ref: 'src/config/load.ts', line: 8, detail: 'Applies layered precedence across sources' },
      ],
      entrypoints: ['src/config/load.ts#loadConfig'],
      contracts: ['CLI flags override env vars and config files'],
      dependencies: [],
      status: 'in_scope',
      exclusion_reason: null,
    },
    {
      feature_id: 'legacy-xml',
      name: 'Legacy XML importer',
      kind: 'user_feature',
      purpose: null,
      intent_status: 'unknown',
      intent_evidence: [],
      entrypoints: ['src/legacy/xml.ts'],
      contracts: ['Deprecated legacy import path'],
      dependencies: [],
      status: 'out_of_scope',
      exclusion_reason: 'Explicitly excluded by user scope as scheduled for removal',
    },
  ];
}

function expectInvalid(doc, snippet) {
  const errors = validateDocument(doc, schema);
  assert.ok(
    errors.some((e) => e.includes(snippet)),
    `Expected error containing ${JSON.stringify(snippet)}, got: ${JSON.stringify(errors)}`,
  );
}

test('valid feature catalog passes', () => {
  assert.deepEqual(validateDocument(makeCatalog(), schema), []);
});

test('rejects duplicate and unsorted feature_id and :: separator', () => {
  const dup = makeCatalog();
  dup.push(structuredClone(dup[0]));
  expectInvalid(dup, 'duplicate');

  const unsorted = [makeCatalog()[1], makeCatalog()[0]];
  expectInvalid(unsorted, 'sorted lexicographically');

  const badSep = makeCatalog();
  badSep[0].feature_id = 'cli::export';
  expectInvalid(badSep, 'must not contain "::"');
});

test('enforces intent_status and purpose/intent_evidence consistency', () => {
  const unknownWithPurpose = makeCatalog();
  unknownWithPurpose[2].purpose = 'Guessed purpose';
  expectInvalid(unknownWithPurpose, 'requires purpose to be null');

  const docNoEvidence = makeCatalog();
  docNoEvidence[0].intent_evidence = [];
  expectInvalid(docNoEvidence, 'requires at least one evidence item');

  const inferredNullPurpose = makeCatalog();
  inferredNullPurpose[1].purpose = null;
  expectInvalid(inferredNullPurpose, 'requires a visible purpose');
});

test('validates safe intent refs and entrypoints', () => {
  const badRef = makeCatalog();
  badRef[0].intent_evidence[0].ref = '../secret.md';
  expectInvalid(badRef, 'expected safe relative path');

  const badDocTraversal = makeCatalog();
  badDocTraversal[0].intent_evidence[0].ref = 'doc:../outside.md';
  expectInvalid(badDocTraversal, 'expected safe relative path');

  const badEntrypoint = makeCatalog();
  badEntrypoint[0].entrypoints = ['src/cli/export.ts#'];
  expectInvalid(badEntrypoint, 'expected safe repository-relative path or path#symbol');
});

test('enforces in_scope and out_of_scope constraints', () => {
  const emptyContracts = makeCatalog();
  emptyContracts[0].contracts = [];
  expectInvalid(emptyContracts, 'requires at least one contract');

  const inScopeWithExclusion = makeCatalog();
  inScopeWithExclusion[0].exclusion_reason = 'should be null';
  expectInvalid(inScopeWithExclusion, 'must set exclusion_reason to null');

  const outOfScopeMissingReason = makeCatalog();
  outOfScopeMissingReason[2].exclusion_reason = null;
  expectInvalid(outOfScopeMissingReason, 'requires a visible exclusion_reason');
});

test('rejects cyclic references and executes cleanly via CLI', () => {
  const cyclic = makeCatalog();
  cyclic[0].dependencies.push(cyclic[0]);
  expectInvalid(cyclic, 'repeated or cyclic');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-feat-'));
  try {
    const validFile = path.join(tmpDir, 'feature-catalog.json');
    fs.writeFileSync(validFile, JSON.stringify(makeCatalog(), null, 2));
    const stdout = execFileSync(
      process.execPath,
      [path.join(__dirname, 'validate-feature-catalog.cjs'), validFile],
      { encoding: 'utf8' },
    );
    assert.match(stdout, /PASS: 3 feature\(s\) valid/);

    const badFile = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(badFile, '{"not":"array"}');
    assert.throws(() => {
      execFileSync(process.execPath, [path.join(__dirname, 'validate-feature-catalog.cjs'), badFile], {
        stdio: 'pipe',
      });
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
