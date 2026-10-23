---
name: release-check
description: Reconstruct feature purpose and intended contracts; audit functional correctness, backward compatibility, and regressions across code revisions with explicit coverage, evidence, independent verification, and release reporting. Use for release readiness, "what functionality exists and why", regression checks, PR compatibility reviews, or broad functional audits. Run the full workflow only for an explicit repository/PR/release audit or when report artifacts are requested.
---

# Release Check — evidence-driven feature and regression audit

**Goal:** Determine what a product promises, how each meaningful feature is supposed to behave, whether current code satisfies those contracts, and whether a specific change violates a previously supported contract. Treat "no failure observed" as different from "proved correct."

## Operating modes

- **Guidance (default):** Answer specific questions using relevant parts of this skill. Read-only source inspection, no audit directory, no unrequested repository-wide scans or code execution.
- **Full audit:** Triggered by an explicit comprehensive functional/regression/release audit, or a request for generated audit artifacts. Apply all six phases and write `audit.json` and `REPORT.md` outside the target.
- **Profiles:** `quick` (bounded initial pass), `standard` (default; all applicable coverage axes), `deep` (more variants, platforms, lifecycle and cross-component paths). A quick or scoped run is necessarily partial unless all obligations are actually resolved; never weaken the evidence bar.

Do not equate activating this skill with permission to execute tests, install dependencies, edit source, create PRs, or deploy software.

## Core distinctions

1. **Intent is not implementation.** Prefer explicit product specifications or acceptance criteria, then documented public interfaces, project tests, issue/PR rationale, commit history, and finally source-level inference. Preserve contradictory evidence. `intent_status: inferred` is not an owner-approved product contract; `unknown` means insufficient grounds.
2. **Feature, contract, scenario, and finding are different entities.** A feature has one or more behavioral invariants; a coverage unit tests one scenario of one feature; a finding is a separately verified claim about actual behavior.
3. **Current correctness differs from regression.** Proving HEAD fails a test does not prove it worked at BASE. Regression needs a fixed comparable baseline, like-for-like conditions, a supported contract, and demonstrated BASE/HEAD divergence.
4. **Intentional change differs from unintended breakage.** User-facing change can be real but intentional; changes to undocumented behaviors are not automatically defects. Classify intention only with explicit evidence and preserve unknowns.
5. **A green CI run is evidence for checked cases only.** Record what the tests assert, not merely that the process returned zero.
6. **No coverage by omission.** Record every in-scope feature against the six mandatory axes, marking justified inapplicable cases. Unexecuted tests are blocked/deferred, not passed.
7. **No invented guarantees.** Never infer production configuration, deployment state, platform support, or business intent from an absent file or passing local test.

## Safety and authority

Repository-controlled code is untrusted. Reading source is allowed; execute build commands, tests, generated scripts, hooks, binaries, browsers, and fixture processors **only** in a verified OS-enforced sandbox that blocks external network, uses an empty allowlisted environment without secrets, exposes the repository read-only or via disposable scratch copy, restricts writes to scratch, and enforces CPU/memory/process/disk/time limits. Prefer preinstalled dependencies; do not fetch packages, send traffic to production, use real credentials, alter deployment, publish a release, or modify target source. If required controls are absent, mark checks `blocked` with an exact reason and describe a safe owner-run validation plan. Never fake test output.

Parent owns shared records. If subagents are available, give each unique scratch space, no shared file-write permission, and enforce that reviewers did not author the claims they validate. Treat all agent-provided paths/results as untrusted. Retain only small allowlisted, verified non-secret evidence from scratch; avoid recursive copying, symlink traversal, or untrusted path reopening. Never retain secrets or environment dumps.

## Setup

Resolve target repository, target revision (HEAD SHA), optional baseline (BASE SHA), scope (subsystems/interfaces/platforms), profile, tool capabilities, run budget, and destination before scanning. For a PR, BASE is the review base or merge-base when justified and explicitly recorded; for a release, prefer the user-specified previous released tag/commit. Never silently equate "previous commit" with "previous release." If no reliable baseline exists, set `base_ref: null`; do not emit `confirmed_regression`.

Default output: `~/release-check-skills/<repo>/run-<N>/` (new directory outside repository). Source remains unchanged. Record SHA and dirty-worktree state; if local uncommitted changes exist, identify which version was tested, and do not claim its evidence describes HEAD unchanged.

## Mandatory workflow

1. **Discover feature contracts** — follow [FEATURE-DISCOVERY.md](FEATURE-DISCOVERY.md). Map entrypoints, user-visible behavior, requirements, historical intent, important dependencies, and deliberate exclusions. Build feature catalog with stable IDs and evidence.
2. **Build coverage ledger** — for each in-scope feature, create cases for `primary`, `boundary`, `error`, `integration`, `compatibility`, and `lifecycle`. Populate conditional variants for config, platform, concurrency, persistence, upgrade/rollback, and permissions where warranted. Use source-backed `not_applicable`, `out_of_scope`, `blocked` and `deferred` states honestly. Validate the ledger before assignment.
3. **Verify behavior and compare revisions** — follow [BEHAVIOR-AND-REGRESSION.md](BEHAVIOR-AND-REGRESSION.md). Prioritize high-impact exposed contracts and changed dependencies, but preserve all unanswered cases in the ledger. Observe HEAD and comparable BASE only when safe. Trace implementation to output and determine whether the asserted contract is met.
4. **Challenge the work** — send uncovered-path discovery to a coverage critic and every significant proposed finding to a *fresh, independent* verifier. A verifier starts from source/contracts and attempts to refute the candidate; it must independently inspect relevant paths and reproduce decisive safe checks when possible. If independence cannot be provided, retain `needs_validation`.
5. **Validate structured records** — write `audit.json` in the exact format in [DATA-CONTRACT.md](DATA-CONTRACT.md), and run `node <skill-dir>/scripts/validate-audit.cjs <output-dir>/audit.json`. Fix format and consistency errors, without promoting claims to match validator expectations. An invalid or incomplete ledger is never declared complete.
6. **Report** — follow [REPORTING.md](REPORTING.md). Derive `REPORT.md` from validated records: feature/intention catalog, verified regressions, other changes, blocked tests, unresolved hypotheses, and actionable release guidance.

A run terminates only as `complete` with the full stated coverage/accountability conditions, or `incomplete` with exact unverified, blocked, excluded, or deferred work. Always say which checks were never executed.

## Acceptance gate

A `confirmed_regression` must have evidence at BASE (previous supported behavior) and HEAD (broken behavior) for a matching scenario/environment, source-grounded behavioral contract, a concrete impact, and an independent verifier distinct from the discoverer. Severity measures demonstrated impact, not test count. An intentional breaking change with documented migration is recorded as a change, not automatically a regression. Inferred or contradictory intent requires qualification, not invented owner decisions.

A `confirmed_change` demonstrates a real BASE/HEAD difference but does not by itself assert defect or approval. A `needs_validation` finding states an exact unresolved premise and a safe next validation step, without severity. `rejected` preserves a disproved claim.

Do not recommend "release approved" solely on test success. Provide a release assessment with conditions and residual risk, leaving final authorization to the owner.

## Do not do these

- Call missing coverage "no regressions."
- Infer feature intention solely from current behavior, or use a generated test to launder that inference as historical fact.
- Label all behavior changes bugs, or all passing current checks backwards compatible.
- Treat ignored, flaky, skipped, or unexecuted tests as green.
- Claim multi-agent review happened when only one agent was available.
- Run untrusted project tasks on the host because they are named `test` or `lint`.
- Conflate a valid JSON schema with verified source truth.
- Produce a final report that disagrees with its structured findings or coverage.

