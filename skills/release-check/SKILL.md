---
name: release-check
description: Reconstruct feature purpose and intended contracts; hunt hidden implementation malfunctions, silent failures, contract drift, compatibility issues, and BASE-to-HEAD regressions using coverage-led isolated agents, adversarial validation, independent record verification, and deterministic validators. Use for release readiness, "what features exist and why", finding hidden bugs, PR compatibility reviews, or comprehensive functional audits. Run the complete workflow only for explicit repository/PR/release audit requests or when report artifacts are requested.
---

# Release Check

Reconstruct what a product promises, hunt hidden malfunctions inside its implementation, verify whether current code satisfies intended contracts, and determine whether changes break previously supported behavior—then give owners the source trace, bounded local reproduction, priority, and smallest effective fix. This is a source-first, evidence-driven workflow. Never equate "tests pass" or "no failure observed" with "proved functional."

## Operating modes

This skill is guidance by default. Loading it does not authorize the complete audit workflow, test execution, or file creation.

- **Guidance mode**: For focused functional questions, intent reconstruction, targeted bug hunting, PR diff inspection, or triage of a specific failure, use only the relevant parts of this skill. Do not automatically run all six phases, create an output directory, or write audit artifacts. Focused agents may be launched when useful; they return results to the current task.
- **Full audit mode**: Use the complete workflow when the user explicitly requests a comprehensive functional audit, hidden-defect audit, regression audit, release-readiness audit, or generated audit report artifacts. Run all six phases and write the files defined below.

If the request could mean either mode, ask one focused question before creating files or starting the complete workflow.

Do not equate activating this skill with permission to execute tests, install dependencies, edit target source, create PRs, tag releases, or deploy software.

## Platform terminology

This skill is agent-neutral:

- **Parent** is the agent that coordinates the run and owns shared state.
- **Task tool** is the platform's delegation or sub-agent mechanism.
- **`research` agent** is a delegated agent for focused source exploration, test-suite blind-spot analysis, coverage critique, and factual record verification.
- **`general` agent** is a delegated agent for deep code-path hunting, adversarial verification, and bounded local execution.
- **`subagent_type:`** in a heading names which of these two delegated agent roles runs that work.

Use equivalent platform capabilities while preserving role, write-isolation, prompt, and independence boundaries.

## Universal execution safety

These rules apply in both operating modes. Repository-controlled code is untrusted. Source inspection is read-only. Run target-controlled builds, tests, processes, browsers, emulators, CLI binaries, and fixture processing **only** inside an OS-enforced sandbox that provides all of these controls:

- no external network; use only an isolated loopback namespace when a check requires local client/server traffic;
- an empty environment populated from an explicit allowlist with safe values, with scratch-local `HOME`, temporary directories, and caches;
- a read-only target and toolchain (using a disposable copy inside the agent's assigned `scratch/` when a build or baseline checkout must write beside source), with the target-controlled process able to write only inside its assigned `scratch/` directory; and
- explicit low CPU, memory, process, file-size, disk, and wall-clock limits.

In guidance mode, do not retain target-controlled files. In full audit mode, only trusted parent-side code may promote the minimum non-secret result to retained `artifacts/` using the procedure under Write isolation. Never expose a retained output directory (other than the agent's own assigned `scratch/`), another agent's directory, the host home directory, credentials, sockets, or shared services to target code. Do not install dependencies or let builds fetch them; use only tools and dependencies already available locally. If every control cannot be enforced, do not execute target code: record the missing sandbox capability as a `needs_validation` blocker and provide a safe owner-run validation plan. Never fake test output.

Use dummy fixtures, dummy state, and mocked external integrations. Do not probe deployed endpoints, live external APIs, shared infrastructure, production databases, real credentials, or paid services. Do not stress availability, publish packages, alter deployments, or continue beyond the minimum local effect needed to establish the malfunction or divergence.

## Full audit setup

In full audit mode, resolve these values before reconnaissance:

- **Skill directory**: the absolute directory containing this `SKILL.md`.
- **Target**: the absolute repository root under review.
- **Repo name**: a stable repository identifier from the directory or local Git remote.
- **Output directory**: a new writable directory outside the target, defaulting to `~/release-check-skills/<repo-name>/run-<N>`, where `<N>` is the next unused integer. Use a directory inside the target only when the user explicitly selects it and the parent verifies that version control ignores the entire directory. Otherwise stop and request an external path.
- **Revision scope (`head_ref`, `base_ref`, `worktree_dirty`)**:
  - `head_ref`: the target commit SHA (plus exact dirty-worktree state; if local uncommitted edits exist, record `worktree_dirty: true`, identify what version was actually inspected/tested, and never claim evidence describes HEAD unchanged).
  - `base_ref`: optional baseline commit SHA or tag when comparing revisions. For a PR, use the review base or merge-base when justified and explicitly recorded; for a release, prefer the user-specified previous released tag/commit. Never silently equate "previous commit" with "previous release." If no reliable baseline exists, set `base_ref: null` and do not emit `confirmed_regression` or `confirmed_change`.

### Write isolation

The parent creates and is the sole writer of shared run files:

- `run-metadata.json`
- `system-map.md`
- `feature-catalog.json`
- `coverage-ledger.json`
- `findings.json`
- `REPORT.md`
- `FINDINGS-DETAIL.md`
- `NEEDS-VALIDATION.md`

Each hunter or verifier receives a unique root under `<output-dir>/agents/<agent-id>/`, with separate `scratch/` and `artifacts/` directories. Canonical agent IDs match `^[a-z0-9][a-z0-9_-]{0,63}$` and must not equal a Windows device name (`con`, `prn`, `aux`, `nul`, `com1` through `com9`, `lpt1` through `lpt9`). Lowercase IDs prevent case-fold collisions. The agent and every target-controlled process may write only to `scratch/`; retained `artifacts/` is parent-owned, is never exposed to the sandbox, and is writable only by trusted parent-side promotion code. Agents may not modify shared files, target source, retained artifacts, or another agent's directory. Do not use `/tmp` or the host home directory as a writable fallback.

Before execution, the parent opens and retains trusted, non-inheritable directory descriptors for the agent's `scratch/` and `artifacts/` roots, and records an allowlist of expected scratch-relative artifact files plus explicit per-file and cumulative byte limits. Never pass those descriptors to the agent or sandbox. After the sandbox and all its processes terminate, trusted parent-side code promotes each allowlisted file separately:

1. Validate the declared relative path: reject absolute, empty, `.`, `..`, or symlinked components.
2. Walk each parent component from the retained scratch-root descriptor with no-follow directory-relative operations; never reopen by path.
3. Open the leaf no-follow and nonblocking.
4. Verify with `fstat` that it is a regular file with link count exactly one and within the recorded per-file and cumulative byte limits.
5. Enforce those limits again while reading from that descriptor.
6. Copy exactly the verified size, repeat `fstat`, and reject a changed identity, type, link count, or size.
7. For the destination, walk every parent component from the retained artifacts-root descriptor with no-follow directory-relative operations; require each existing component to be a real directory, and create any missing directory exclusively before reopening and verifying it no-follow.
8. Create the leaf exclusively without following links, verify that the opened destination is a regular file with link count exactly one, and copy from the verified source descriptor without reopening either path.
9. Use equivalent race-safe APIs on non-POSIX systems.
10. Never recursively copy or glob scratch, extract an archive into artifacts, or open or promote a symlink, FIFO, socket, device, directory, hard-linked file, changing file, or file that exceeds its bound.
11. If any check is unavailable, cannot be enforced, or fails, discard the scratch entry; if it is decisive evidence, retain `needs_validation` with the exact promotion blocker.

[HUNTING.md](HUNTING.md) and [VALIDATION-AND-REPORTING.md](VALIDATION-AND-REPORTING.md) carry this procedure as one identical fenced block for hunter and verifier prompts; it states the same rules in the same order as this list.

For a reproduced check, record the exact command or invocation, test inputs, sandbox limits, and only the allowlisted environment variable names plus safe non-secret values needed to reproduce it. Never capture or copy the ambient environment, inherited variables, credential values, or unrelated host paths.

Before delegation, the parent writes `run-metadata.json` with:
- `run_id`, `repo`, `target`, `base_ref`, `head_ref`, `worktree_dirty`, `profile`, `scope_paths`, `budget` (`null` if unset),
- `execution_policy: "sandboxed-source-and-local-only"`,
- `selected_companions`, `prior_runs`, `shared_file_owners`,
- `run_status: "in_progress"`, and `incomplete_reason: null`.

Update metadata only when these run facts change (and upon terminal completion/incompletion); candidate and coverage state belong in `feature-catalog.json`, `coverage-ledger.json`, and `findings.json`.

## Full audit planning

### Coverage and prior runs

No single pass exhausts a codebase. Build a deterministic feature catalog and coverage ledger before hunting and update the ledger after every agent result. [RECONNAISSANCE.md](RECONNAISSANCE.md) defines canonical coverage units and [HUNTING.md](HUNTING.md) defines coverage-critic waves. The parent alone updates shared files.

If prior runs exist for the same repo, read every compatible `feature-catalog.json`, `coverage-ledger.json`, and `findings.json` before planning:

1. Compare the relevant current source and dependencies with each prior feature, unit, and finding. A prior source ref alone is not evidence that behavior is unchanged.
2. Carry an unchanged prior `confirmed_defect`, `confirmed_regression`, or `confirmed_change` record into the current candidate set only when its relevant source, baseline, and conditions remain unchanged and its evidence still meets the current contract. Link it to a current `planned` unit with `prior_status: "prior_confirmed_same_source"`, preserve its fingerprint, exclude only that carried root cause from hunters, and send the carried record through the current validation path; the Phase 3 verifier becomes that unit's assignment owner.
3. When relevant source, dependencies, or baseline changed for a prior confirmed record, create a `planned` unit with `prior_status: "prior_confirmed_changed_source"`. Do not exclude it from hunting or assume the prior verdict still holds.
4. Convert prior `needs_validation`, `deferred`, `blocked`, `out_of_scope` (when now in scope), and changed-source units into current `planned` work. A still-blocked `needs_validation` record may be carried only after current source supports its trace, linked to a `planned` unit (`prior_status: "prior_needs_validation"`), and re-verified in Phases 3 and 5.
5. A prior same-source `covered` unit informs priority but remains visible in the current ledger. A prior `rejected` record suppresses only that unchanged claim when source and evidence are unchanged, never coverage of its unit.
6. Respect prior `profile` and `scope_paths`: a prior `quick` or scoped run contributes only its recorded evidence and gaps, never an implied "rest is fine."

If no compatible prior run exists, state so in the final report.

### Run profiles and scope

Select a profile from the user's request or propose one based on repository size and release stakes (`standard` is default):

- **`quick`** — bounded pass for small changes, re-runs, or fast initial triage. Coarsen ledger units' `subsystem` dimension to the fixed canonical identifier `profile/quick/all-in-scope-subsystems`, run exactly one hunter wave followed by exactly one final coverage-critic pass (recording accepted `missing_units` and `reassign_ids` as `deferred`), and use one fresh verifier per candidate for combined Phase 3 + Phase 5 validation.
- **`standard`** — the complete six-phase workflow as written.
- **`deep`** — for high-stakes releases or complex systems. Split ledger units per subsystem and lifecycle mode, run critic waves until a clean final-clean critic pass, keep Phase 3 and Phase 5 verification strictly separate, and give `prior_covered_same_source` units an independent second pass.

A **scoped run** audits a subset (named paths, one subsystem, specific features, or `base_ref..head_ref` diff and its transitive dependents). Seed `planned` units for in-scope features/surfaces and record discovered excluded features/surfaces as `out_of_scope` — never as `covered`. A `quick` or scoped run must always present itself as partial coverage.

Profiles change breadth and redundancy, never the evidence bar. Never weaken candidate gates, execution safety, `needs_validation` discipline, deterministic validators, or independent verification.

#### Cost budget

When the user specifies a budget — or the parent proposes one for a large repository — record `budget` in `run-metadata.json` as a maximum number of delegated agent invocations across all phases.

Apply the strict pre-reconnaissance budget gate before launching any reconnaissance agent:
- Reserve baseline reconnaissance calls (`4` when `base_ref === null`, `5` when `base_ref !== null` to include revision-diff mapping),
- Plus mandatory critics (`1` final critic for `quick`; `1` post-wave critic + `1` distinct final-clean critic for `standard`/`deep`),
- Plus at least `1` verifier call.

Add focused reconnaissance agents only after repeating this gate for each extra call. If the requested budget cannot fund that minimum, launch no agent: ask for a larger budget, narrower scope, or `quick` profile. If unchanged, set `run_status: "incomplete"` with `incomplete_reason: "budget_cannot_fund_reconnaissance_and_reserves"` and report that no audit pass ran.

Spend remaining budget in this strict order:
1. Count every reconnaissance call, post-wave critic, and final-clean critic as agent invocations.
2. **Reserve critics and validation before hunting.** For `quick`, reserve its single final critic. Before every `standard`/`deep` hunter wave, reserve one immediate post-wave critic plus one distinct final-clean critic. Also reserve verifier capacity from the profile (roughly 1–2 verifiers per expected candidate; when uncertain reserve 30% of the balance after critic reservations). Never assign hunters into either reserve.
3. Assign hunters in priority order until the hunting allowance is spent, then run the reserved post-wave critic.
4. Before any subsequent wave, reserve its new post-wave critic again. If the remaining budget cannot fund the required critic calls and validation reserve, launch no hunters for that wave, mark remaining `planned` units `deferred` with reason `budget_cannot_reserve_critics_and_validation`, and spend the retained final-clean critic to document gaps.

If later facts consume the required final-critic reserve before hunting starts, mark all planned work `deferred`, set `run_status: "incomplete"` with `incomplete_reason: "critic_budget_exhausted"`, and make no complete-coverage claim.

If surviving candidates (or material Phase 5 replacements requiring fresh re-verification) exceed the remaining budget: stop hunting, validate candidates in lexicographic `fingerprint` order while budget permits, set `run_status: "incomplete"` with `incomplete_reason: "validation_budget_exhausted"`, leave unvalidated fingerprints only on their `candidate` ledger units (never put unvalidated candidates into `findings.json` or relabel them `needs_validation`), and disclose every unvalidated fingerprint/unit at the top of `REPORT.md`.

## Core principles

### 1. Intent is not implementation
Reconstruct what a feature is *supposed* to do before judging whether code is right or wrong. Follow strict evidence priority:
1. Explicit product specifications, RFCs, or acceptance criteria
2. Documented public interfaces, schemas, CLI help, and API docs
3. Existing executable tests (strong evidence of tested behavior, though tests themselves can encode bugs or mock away broken integration)
4. Issue/PR/commit rationale and release notes
5. Source-level inference (mark `intent_status: "inferred"`; never launder implementation guesses as owner-approved contracts)

Preserve contradictions between docs, tests, and code; mark `intent_status: "unknown"` with `purpose: null` when evidence is insufficient.

### 2. Require a concrete invariant and observed malfunction
Every candidate defect or regression must name the feature (`feature_id`), lower-trust/caller perspective, entry surface, intended contract or invariant, violated source path (`entrypoint` → `sink`), and concrete observed failure. Do not treat code-style preferences, unreached dead code (unless it violates a public contract or exposes a broken advertised path), or missing defensive polish with no observable contract failure as confirmed defects.

A passing test suite proves **only** what its assertions actually check under its actual test doubles and environment. Always inspect assertions and mocks before treating a test file as coverage.

### 3. Separate current defect, regression, and behavior change
Use five strictly distinct verdicts:
- **`confirmed_defect`**: Independently verified malfunction in HEAD where code fails an intended contract, produces silent data corruption/loss, swallows failures, leaves features unwired/hollow, mishandles state/concurrency/edges, or fails packaging/configuration—regardless of whether it also existed at BASE or has no BASE.
- **`confirmed_regression`**: Independently verified unintended breakage from comparable `base_ref` to `head_ref` on a supported contract, demonstrated with like-for-like BASE-pass and HEAD-fail observations.
- **`confirmed_change`**: Independently verified material behavior difference between `base_ref` and `head_ref` where `intent_classification` is `intended` (documented/explicitly planned change) or `unknown` (requires owner confirmation). Never automatically call an undocumented change a bug or automatically approve a breaking change.
- **`needs_validation`**: Source-grounded hypothesis blocked by missing sandbox capability, unobservable external environment/dependency/platform state, unavailable comparable BASE runtime, or unresolved contradictory product intent. Has **no** severity.
- **`rejected`**: Claim disproved by source controls, unreachable path, invalid test oracle, or matching intended contract. Retained so future runs do not repeat disproved leads.

### 4. Combine real test-environment execution with virtual test harnesses
Static tracing establishes the exact code mechanism and missing guard; empirical verification settles runtime behavior inside the OS-enforced sandbox using the right test level per [TESTING-AND-HARNESSES.md](TESTING-AND-HARNESSES.md):
- **`existing_test`**: Existing project tests—counted only after auditing their assertions and verifying mocks do not bypass the suspect wiring.
- **`real_env_test`**: Running the assembled target (built CLI binary, packaged library consumer, local loopback service, ephemeral scratch DB/files, headless UI) end-to-end in an isolated sandbox test environment without mocking internal collaborators.
- **`virtual_test`**: Auditor-authored disposable synthetic harnesses written strictly inside `scratch/` (unwired-option A/B differential probes, boundary-only fault injection, boundary/round-trip matrices, deterministic async/race/abort barriers, cold-start/migration/rollback checks, deterministic fake external protocol/LLM servers). Virtualize **only** external boundaries—never internal wiring—and record exact `virtualized_boundaries` on every check and confirmed finding.
- **`base_head_differential`**: Identical real or virtual harness executed against clean disposable `base_ref` and `head_ref` checkouts under verified comparable conditions.

If the decisive fact lies in an unobservable staging/production environment, unavailable OS/browser matrix, external hosted service, missing sandbox capability, or unresolved owner intent, retain `needs_validation` with the exact missing fact and an owner-executable resolution recipe (`local`, `environment`, and/or `owner_intent`).

### 5. Separate priority from certainty
Only `confirmed_defect` and `confirmed_regression` receive `severity` (`likelihood`, `impact`, `overall_severity`, where `overall_severity <= impact`). `confirmed_change`, `needs_validation`, and `rejected` carry no defect severity.

Calibrate impact and overall severity with these functional anchors:
- **critical** — unrecoverable data corruption or loss, core application/service unable to start or execute its primary mission, silent wrong output across primary workflows, or irreversible broken upgrade/migration affecting all users.
- **high** — a core advertised feature or workflow fails completely or produces materially wrong state/results under ordinary usage, silent failure that falsely reports success, or major backward-compatibility breakage with no fallback.
- **medium** — functional malfunction on non-trivial edge cases, secondary workflows, specific valid configurations/platforms, or recoverable resource/lifecycle leaks requiring specific conditions.
- **low** — minor functional glitch, misleading error/diagnostic behavior with intact data and easy workaround, or narrow corner-case inconsistency.
- **informational** — confirmed trivial behavior anomaly or cosmetic divergence with negligible functional consequence.

### 6. Recommend the smallest effective source fix and regression test
For every confirmed defect or regression, identify the invariant that failed, the narrowest repository-relative fix (without editing target source during the audit), and a concrete regression test that would have caught the failure without mocking out the broken boundary.

### 7. Audit completeness differs from release approval
`run_status: "complete"` means all in-scope features and coverage units completed the required audit workflow with validated records and independent verification—even if the audit discovered confirmed regressions or defects! Conversely, a run with zero confirmed bugs can still be `incomplete` if tests were blocked or budget ran out.

Based on verified findings and residual risk, `REPORT.md` provides an advisory release assessment—`hold` (critical/high confirmed regressions or unresolved release-blocking defects), `conditional` (medium/low defects or critical `needs_validation` blockers requiring owner action), or `candidate` (within stated scope and residual risks)—never final human authorization to ship.

## Full audit workflow

In full audit mode, follow all six phases in order:

1. **Reconnaissance & Feature Discovery** — map architecture, entrypoints, feature catalog & intent, end-to-end wiring, test-suite blind spots, optional BASE→HEAD blast radius, local execution capabilities, prior runs, and deterministic `coverage-ledger.json` per [RECONNAISSANCE.md](RECONNAISSANCE.md).
2. **Coverage-led Hunting Waves** — assign isolated `general` hunters from ledger units using [HUNTING.md](HUNTING.md), [DEFECT-CLASSES.md](DEFECT-CLASSES.md), [TESTING-AND-HARNESSES.md](TESTING-AND-HARNESSES.md), and selected domain companions; run real isolated test-environment checks and `scratch/`-based virtual tests alongside source tracing, and run `research` coverage-critic waves to expose missed features, axes, sibling paths, mocked-only blind spots, and shallow closures.
3. **Independent Adversarial Candidate Validation** — consolidate fingerprints and send every unique candidate (and carried confirmation) to a fresh `general` verifier that attempts to refute it—auditing virtual-test oracle/mock discipline and independently reproducing decisive checks per [VALIDATION-AND-REPORTING.md](VALIDATION-AND-REPORTING.md) and [TESTING-AND-HARNESSES.md](TESTING-AND-HARNESSES.md).
4. **Structured Output & Validation** — write `findings.json` and run all four zero-dependency validators (`validate-feature-catalog.cjs`, `validate-coverage-ledger.cjs`, `validate-findings.cjs`, `validate-run.cjs`).
5. **Independent Final Record Verification** — launch fresh `research` verifiers per final `confirmed_*` and `needs_validation` record; route any material replacement through another fresh verifier and re-run all validators.
6. **Target-Neutral Reporting** — derive `REPORT.md`, `FINDINGS-DETAIL.md`, and `NEEDS-VALIDATION.md` strictly from validated JSON records.

Terminate in exactly one of two states: (a) all Phase 6 artifacts are written and all four validators exit 0 (`run_status: "complete"` unless budget/scope/blockers explicitly limit coverage, in which case `incomplete` if unresolved candidates or unexecuted mandatory steps remain), or (b) `run_status: "incomplete"` is recorded in `run-metadata.json` with an exact `incomplete_reason` and full disclosure in `REPORT.md`. Never stop mid-phase.

## Anti-patterns

1. Treating a green test suite as proof that wired features work without checking what the tests actually assert and mock.
2. Auditing only happy-path unit behavior while ignoring unwired options, swallowed exceptions, fallback paths, and cross-layer drift.
3. Refusing to confirm a hidden malfunction in HEAD because `base_ref` is missing (`confirmed_defect` exists specifically for HEAD malfunctions).
4. Labeling a HEAD failure a `confirmed_regression` without like-for-like BASE-pass proof.
5. Automatically calling an undocumented BASE→HEAD change a defect, or assuming a breaking change is intended from a vague commit title alone.
6. Treating missing coverage, skipped tests, or blocked execution as "no bugs found."
7. Assigning severity to `needs_validation` or `confirmed_change` records.
8. Running untrusted target builds, scripts, or fixtures outside an OS-enforced sandbox because they are named `test` or `check`.
9. Claiming independent validation when the same agent discovered and verified the finding, or repairing malformed subagent JSON instead of discarding and re-running.
10. Letting `REPORT.md` prose upgrade verdicts, hide `blocked`/`deferred` units, or contradict `findings.json` and `coverage-ledger.json`.
11. Conflating schema validation (`PASS`) with verified behavioral truth.
12. Editing target source files (or writing virtual tests into the target repository instead of `scratch/`) during an audit instead of recommending fixes and regression tests.
13. Writing tautological virtual tests that re-implement target logic, mock out internal wiring under audit, or launder guessed behavior as a documented contract.
14. Closing a unit with `source_trace` or a mock-heavy `existing_test` when a bounded `real_env_test` or `virtual_test` is safely executable in the sandbox.
