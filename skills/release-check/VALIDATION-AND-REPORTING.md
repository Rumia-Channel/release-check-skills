# Validation, Structured Output, Verification, and Reporting

### Phase 3: Independently validate every candidate

After the clean coverage-critic pass (or an explicitly recorded `quick`/budget early stop), consolidate Phase 2 candidates and carried same-source prior confirmations by `fingerprint` and root cause. Send every unique proposed candidate (`confirmed_defect`, `confirmed_regression`, `confirmed_change`, `needs_validation`) to a fresh `general` verifier that did not discover it. Carried prior confirmations follow the same path even though hunters excluded them.

Assign each verifier a unique canonical lowercase `agent_id` and `<output-dir>/agents/<verifier-id>/scratch/` + parent-owned `artifacts/`. Give it only: the candidate, its linked feature entry from `feature-catalog.json`, its linked coverage-unit `checks` and promoted artifact paths, needed `system-map.md` context, exact relevant companion validation rules, the verbatim **Artifact promotion procedure** block below, execution safety boundaries, all five verdict branches of [report-schema.json](report-schema.json) copied verbatim, and any prior records with the same `fingerprint`. Never show it another verifier's conclusion.

#### Candidate-verifier prompt

```text
You did not discover this candidate. Attempt to REFUTE it from repository source,
intent evidence, and bounded local execution. Do not probe live deployments or external
services. Run target-controlled code ONLY inside the approved OS-enforced sandbox: no
external network, empty allowlisted environment, read-only target and tools, scratch-only
writes, and explicit low resource/wall-clock limits. If any control is missing, do not
execute; retain the missing capability as a needs_validation blocker. Only trusted
parent-side code may promote predeclared scratch-relative files to artifacts/, following
the promotion procedure block below verbatim. Never use unpromoted scratch files as evidence.

1. Verify every trace and evidence file, positive line number, scope, and operation.
   Confirm the first entry is a real lower-trust/caller entrypoint and the last reaches
   the claimed malfunction or broken sink.
2. Reconstruct the strongest source-visible guards, fallbacks, defaults, validation,
   error handlers, transactions, or compatibility shims on the path. Could an upstream
   or downstream layer prevent the claimed malfunction?
3. Inspect intent evidence (`documented`, `inferred`, `unknown`). Reject claims that invent
   a contract contradicted by explicit specs, or confirm `confirmed_change` (`intended` vs
   `unknown`) if the behavior change is real and not clearly an unintended defect.
4. For proposed `confirmed_defect`: audit the hunter's `test_kind` and `virtualized_boundaries`
   per TESTING-AND-HARNESSES.md—reject any tautological harness that copies logic, feeds
   unreachable inputs, or mocks internal target wiring. Independently run a minimal real
   (`real_env_test`) or unmocked virtual (`virtual_test`) reproduction at HEAD in your own
   `scratch/`. Verify inputs, conditions, impact, and that the proposed fix and regression
   test enforce the invariant without over-mocking.
5. For proposed `confirmed_regression` or `confirmed_change`: verify `base_ref !== null`,
   reproduce like-for-like BASE and HEAD checks (`base_head_differential` or matching
   `real_env_test`/`virtual_test` runs) in clean `scratch/base/` and `scratch/head/` copies
   under identical runtime/deps/config/fixtures, and verify `environment_comparability`.
   If BASE also fails the exact check, it is NOT a regression (reclassify to
   `confirmed_defect` if broken at HEAD, or `rejected` if claim assumed BASE worked).
6. For proposed `needs_validation`: verify whether the blocker genuinely cannot be resolved
   locally via either a real test-environment run or a boundary-only virtual test in `scratch/`.
   If source or a safe local check refutes the trace, emit `rejected`; if a safe local check
   resolves it, reproduce and promote or reject; if still blocked (e.g., unavailable OS,
   external staging dependency, missing sandbox, contradictory intent), keep `needs_validation`
   with exact blockers and concrete, owner-runnable `local`, `environment`, and/or
   `owner_intent` validation recipes (no severity).
7. Verify `severity` calibration (`overall_severity <= impact.score`, matching observed
   functional blast radius) for `confirmed_defect` and `confirmed_regression` only.
8. Preserve `fingerprint` for the same root cause across verdict transitions.

Return exactly one JSON object and no surrounding prose:
{"decision": "confirmed_defect|confirmed_regression|confirmed_change|needs_validation|rejected", "record": { ... }}
where `record` strictly conforms to the chosen verdict branch of report-schema.json.
```

Copy this promotion procedure verbatim into every candidate-verifier prompt:

```text
Artifact promotion procedure (trusted parent-side code only):
Reference only for you: the parent performs these steps; you never perform them.

Before execution, the parent opens and retains trusted, non-inheritable directory
descriptors for the agent's scratch/ and artifacts/ roots, and records an allowlist
of expected scratch-relative artifact files plus explicit per-file and cumulative
byte limits. Never pass those descriptors to the agent or sandbox. After the sandbox
and all its processes terminate, trusted parent-side code promotes each allowlisted
file separately:

1. Validate the declared relative path: reject absolute, empty, `.`, `..`, or
   symlinked components.
2. Walk each parent component from the retained scratch-root descriptor with
   no-follow directory-relative operations; never reopen by path.
3. Open the leaf no-follow and nonblocking.
4. Verify with `fstat` that it is a regular file with link count exactly one and
   within the recorded per-file and cumulative byte limits.
5. Enforce those limits again while reading from that descriptor.
6. Copy exactly the verified size, repeat `fstat`, and reject a changed identity,
   type, link count, or size.
7. For the destination, walk every parent component from the retained
   artifacts-root descriptor with no-follow directory-relative operations; require
   each existing component to be a real directory, and create any missing directory
   exclusively before reopening and verifying it no-follow.
8. Create the leaf exclusively without following links, verify that the opened
   destination is a regular file with link count exactly one, and copy from the
   verified source descriptor without reopening either path.
9. Use equivalent race-safe APIs on non-POSIX systems.
10. Never recursively copy or glob scratch, extract an archive into artifacts, or
    open or promote a symlink, FIFO, socket, device, directory, hard-linked file,
    changing file, or file that exceeds its bound.
11. If any check is unavailable, cannot be enforced, or fails, discard the scratch
    entry; if it is decisive evidence, retain `needs_validation` with the exact
    promotion blocker.
```

Parent rules after verifier completion:
- Discard malformed or prose-wrapped verifier output without manually repairing it; re-run with a fresh verifier if budget allows, otherwise treat as an unvalidated ledger candidate under the budget-exhausted incomplete-run rule.
- Update linked `coverage-ledger.json` unit `checks` with the verifier's own `agent_id`, `reviewed_paths`, `revision`, `method`, `test_kind`, `virtualized_boundaries`, `outcome`, and owned promoted `artifact` (keeping unit `reviewed_paths` equal to the union across `checks`). If a carried prior unit was seeded `planned`, the verifier becomes its assignment owner and transitions it to `candidate`.
- If a candidate is `rejected` and no other active candidate remains on that ledger unit (and all checks show the invariant passes), transition the unit from `candidate` to `covered` with empty `result_fingerprints` (unless awaiting other open leads), while keeping the `rejected` record in `findings.json` with its `coverage_ids` pointing to the unit!
- If strict budget exhausts before validating every candidate, stop, keep unvalidated candidates only in `coverage-ledger.json`, set `run_status: "incomplete"` with `incomplete_reason: "validation_budget_exhausted"`, and never include unvalidated candidates in `findings.json`.

### Phase 4: Write and validate structured records

The parent writes `<output-dir>/findings.json` sorted lexicographically by `fingerprint`, enforcing all five distinct schemas in [report-schema.json](report-schema.json) (`additionalProperties: false`). Validate all four structured files together:

```sh
node <skill-dir>/scripts/validate-feature-catalog.cjs <output-dir>/feature-catalog.json
node <skill-dir>/scripts/validate-coverage-ledger.cjs <output-dir>/coverage-ledger.json
node <skill-dir>/scripts/validate-findings.cjs <output-dir>/findings.json
node <skill-dir>/scripts/validate-run.cjs <output-dir>
```

Fix every schema, state, ownership, or cross-reference error before Phase 5. Validator `PASS` proves structural and cross-record integrity only—never empirical truth.

### Phase 5: Verify final records with fresh eyes

Launch one fresh `research` verifier in parallel for every final `confirmed_defect`, `confirmed_regression`, `confirmed_change`, and `needs_validation` record in `findings.json`. (In `quick`, Phase 3 and Phase 5 merge into one fresh independent verifier per candidate; every other profile requires two separate independent reviewers.)

For `confirmed_defect` and `confirmed_regression`, check:
1. Every trace/evidence path, positive line number, scope, and operation matches actual repository source;
2. Caller perspective, `execution.test_kind`, `execution.virtualized_boundaries` (confirming internal target wiring was never mocked out), native inputs, conditions, and observed HEAD (plus comparable BASE for regressions) match the evidence and are not defeated by an overlooked fallback/guard;
3. Intent classification (`documented|inferred|unknown`) matches actual specification/test evidence;
4. Severity (`overall_severity <= impact.score`) accurately reflects demonstrated functional blast radius;
5. Remediation (`strategy`, `code_changes`, `regression_test`) enforces the failed invariant cleanly without breaking another contract.

For `confirmed_change`, check:
1. BASE vs HEAD behavioral difference is real, like-for-like comparable, and accurately described in `behavior_before`/`behavior_after`;
2. `intent_classification` (`intended` vs `unknown`) is supported by actual release/spec evidence or honestly marked `unknown`;
3. `migration_or_compat_notes` accurately describe caller impact.

For `needs_validation`, check:
1. Source trace supports `claimed_root_cause` and `claimed_verdict`;
2. Every listed blocker is genuine and cannot already be resolved locally within sandbox rules;
3. `validation_plan` contains concrete, non-destructive `local`, `environment`, and/or `owner_intent` steps;
4. No severity, remediation, or live-probe instructions appear.

Each Phase 5 verifier returns strictly one JSON object:
`{"decision":"verified","fingerprint":"..."}` or `{"decision":"replace","reason":"...","record":{...}}`

Discard malformed or prose-wrapped output and re-run with a fresh verifier if budget permits.

**Material replacement gate**: Do NOT apply a replacement directly if it promotes a verdict (especially to any `confirmed_*` verdict), changes verdict category (e.g., `confirmed_change` → `confirmed_regression`), or materially alters root cause, trace, observed result, impact, or severity. Send that complete replacement to a **new independent `general` verifier** that did not hunt, perform Phase 3 validation, or propose the Phase 5 replacement; it rechecks source and reproduces decisive local checks, returning `verified` or another replacement. Repeat until independently verified, or—if budget or independence is unavailable—remove the disputed record from `findings.json`, keep its ledger unit unresolved, and set `run_status: "incomplete"`. Re-run all four validators after every applied replacement.

Mark `run_status: "complete"` in `run-metadata.json` only when no `planned` or `in_progress` ledger units remain, every candidate fingerprint in the ledger has a verified final disposition in `findings.json`, every retained record passed Phase 5, and `validate-run.cjs` exits 0. Note: a `complete` audit MAY contain `confirmed_defect`, `confirmed_regression`, `confirmed_change`, `needs_validation` (for genuinely external/env-blocked items), and `rejected` records!

### Phase 6: Produce target-neutral reports from final records

Only after Phase 5 completes and `validate-run.cjs` exits 0, derive prose reports strictly from validated JSON records and ledger bookkeeping (`quality_notes`). Prose must never upgrade a verdict, invent severity, or hide blocked/deferred/unexecuted checks.

#### `REPORT.md`

Include these sections in order:
1. **Executive Release Assessment**: Advisory recommendation (`hold`, `conditional`, or `candidate`—explicitly stating final ship authorization belongs to owners), `run_status` (`complete` or `incomplete` + exact reason), profile, scope, budget planned vs spent, `base_ref`/`head_ref`, `worktree_dirty`, sandbox execution policy, prior-run reuse, coverage completeness statement (clearly marking `quick`/scoped/budget-limited runs as partial, and listing any unvalidated fingerprints at the top if budget ran out).
2. **Feature & Intent Catalog**: Each cataloged feature's ID, kind, purpose, `intent_status` (`documented`, `inferred`, `unknown`), key contracts, entrypoints, and preserved specification/code contradictions.
3. **Confirmed Regressions**: Table (`severity`, `title`, `feature_id`, `defect_category`, `head_observed_result`) and concise summaries with BASE/HEAD comparable evidence, impacted contract, smallest fix, and regression test (omit or state "None" when `base_ref: null`).
4. **Confirmed Implementation Defects**: Table (`severity`, `title`, `feature_id`, `defect_category`, `head_observed_result`) and concise summaries for hidden malfunctions in HEAD (noting whether pre-existing at BASE or unknown).
5. **Confirmed Behavior Changes**: Table (`intent_classification`, `title`, `feature_id`, `impact_summary`) summarizing BASE→HEAD behavioral shifts and compatibility/migration notes (no defect severity).
6. **Needs Validation**: Separate table listing `title`, `feature_id`, `claimed_verdict`, repository trace, exact blockers, and safe `local`/`environment`/`owner_intent` resolution steps. Zero severity.
7. **Quality Notes & Positive Verified Invariants**: Non-defect maintainability/test-hygiene observations from `quality_notes`, plus positive invariants demonstrated locally.
8. **Coverage Summary**: Counts from `coverage-ledger.json` by status, across all 6 release axes, breakdown by `test_kind` (`source_trace`, `existing_test`, `real_env_test`, `virtual_test`, `base_head_differential`), summary of any virtualized external boundaries vs fully real local checks, `deferred`/`blocked`/`out_of_scope` reasons, and final coverage-critic result.
9. **Next Actions & Human Decision Points**: Ranked actions, missing acceptance criteria, test blind spots to close, and owner decisions (conflicting intent, intentional breaking changes, migration sign-off, residual risk acceptance).

Do not present `rejected` records as findings; mention their fingerprints only when explaining a disproved lead or coverage decision.

#### `FINDINGS-DETAIL.md`

For every confirmed `medium`, `high`, or `critical` defect or regression (and any breaking `confirmed_change`), include complete reproduction and remediation details:
- Ordered repository-relative `trace` and `evidence`
- `caller_perspective`, `conditions`, `execution.test_kind`, `execution.virtualized_boundaries`, and target-native minimal `inputs` + bounded `instructions`
- `head_observed_result` (and `base_observed_result` + `environment_comparability` where applicable)
- Root cause, violated invariant, smallest source-level fix (`strategy` + `code_changes`), and concrete `regression_test`.

#### `NEEDS-VALIDATION.md`

For every `needs_validation` record, include the complete source `trace`, `evidence`, `claimed_verdict`, `claimed_root_cause`, exact `blockers`, and exact non-destructive `local`, `environment`, and `owner_intent` resolution plans. Keep these as prioritized validation leads without severity or live-probe instructions.

Keep reports proportional to evidence. A clean run may have zero confirmed defects or regressions—report that honestly alongside coverage boundaries and unexecuted environments without inventing trivial findings.
