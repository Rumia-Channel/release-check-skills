# Phase 3–4: Behavioral verification and regression comparison

## Investigation order

1. Start with a cataloged feature, its stated/inferred purpose, public interface, and one testable invariant; link it to exact coverage ID(s).
2. Trace input through parsing, validation, domain logic, persistence, and output. Inspect aliases, async/error paths, retries, cleanup, migration, cache, and public compatibility adapters.
3. Choose the smallest check that distinguishes passing behavior from a violated contract. Prefer preexisting project tests with understood assertions, then minimal targeted tests and disposable fixture-based integration checks. A passing command with no relevant assertion is not coverage.
4. Record a **HEAD observation** (commit/SHA, environment, exact command/input, assertion and output) and, for regression comparisons, an equivalent **BASE observation** in an independent disposable checkout/fixture.
5. Establish that environment, dependencies, configs, data and test oracles are comparable. If not, mark the precise comparison blocker; do not ascribe a difference to the code change.
6. Mark each coverage case `covered`, `failed`, `blocked`, `deferred`, `not_applicable`, or `out_of_scope`. Record scoped evidence and the remaining gap.
7. Search for the smallest practical source-level correction and a regression test proposal, without modifying the target automatically.

## Test execution boundary

Running arbitrary repository scripts is potentially unsafe. Execute target-controlled code only in a verified OS-enforced sandbox: disabled external networking, empty allowlisted environment, read-only target or disposable copy, scratch-only writes, hard process/memory/CPU/disk/time bounds. Avoid dependency installation or downloaded scripts. Do not use production data, shared infrastructure, live services, real credentials, paid APIs, or availability stress. If controls are not enforceable, do not execute. `blocked` is the correct result with a safe validation plan.

The tool or agent running tests must emit exact commands/inputs, expected assertion, actual result, SHA, sanitized local environment, and fixture identity. Retain only safe compact artifacts, under trusted parent control. No `test` evidence may be invented from static review.

## Classification

- **Confirmed regression**: documented/supported contract or clearly established pre-change user-visible behavior; BASE passed; comparable HEAD failed; a concrete impact exists; independent verification establishes all decisive facts. Record `confirmed_regression` with `intent_classification: unintended` only when the broken contract remains in force. A deliberately withdrawn contract with adequate evidence instead belongs under behavior change.
- **Confirmed behavior change**: an independently observed, material BASE→HEAD difference, without asserting that it is a defect or approved. `intent_classification` is `intended` only with explicit release/spec/owner evidence; otherwise `unknown`. A compatible improvement can belong here.
- **Needs validation**: a specific hypothesis is source-grounded but missing comparable runtime, environment, historical contract, or independent reviewer evidence. State exactly which fact and how to verify safely.
- **Rejected**: evidence disproves the claimed breakage, e.g. guard exists, no reachable path, BASE also fails, changed platform unsupported, test oracle invalid, or different intended contract.

Do not label a HEAD failure "regression" without baseline proof. Do not infer intention from a PR title alone when observable contracts contradict it. For major changes, trace transitive dependents and user-facing release notes; migrations, data compatibility and rollback paths deserve their own coverage units.

## Independent adversarial verifier

The verifier must be a distinct agent/run context from the discoverer, and re-read source and historical contract evidence. Request an attempt to **disprove** the finding, focusing on:
- wrong baseline or version, noncomparable environment, stale test expectation;
- feature flags, permissions, input normalization, compatibility shims, alternate entrypoints;
- flaky tests, nondeterminism, unsupported configurations, fixture artifacts;
- supposed product intent that is inferred or contradicted elsewhere;
- whether severity exceeds the demonstrated user-visible impact.

When safe and feasible, re-run the decisive minimal check independently. If disputed, demote to `needs_validation` or `rejected`; never amplify severity. When independent capacity is unavailable, do not emit confirmed verdicts. A coverage critic is not a substitute for finding verification.

## Release decision

Prioritize failures by exposed users, supported contracts, critical workflows, data integrity, recoverability, and documented consequences. A release can be advised `hold` for a confirmed critical regression, or `conditional` while important checks remain blocked. Otherwise recommend `candidate` with stated scope and residual uncertainty; these are recommendations, not authorization.

