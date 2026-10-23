# Phase 1–2: Feature intent, contracts, and coverage

## Reconnaissance

Inspect the repository without executing target-controlled code. Map package boundaries, public exports, CLI commands, routes, UI flows, persisted formats, jobs, integrations, config, feature flags, migrations, and supported platforms. Read README/specs, docs, tests, changelog, tags, issue/PR rationale, commits (where available), and source. Inspect code to distinguish public entrypoints from internal helpers.

For each **externally meaningful feature**, record:
- Stable, source-derived `id` (not a line number or agent-generated ordinal), `name`, and in-scope status.
- `purpose`: the problem it solves. Set `intent_status` to `documented`, `inferred`, or `unknown`; list traceable `intent_evidence`, or an empty list and `purpose: null` for unknown. Do not claim author intention from implementation alone.
- `entrypoints`, observable contracts/invariants (inputs, outputs, side effects, errors, persistence, ordering, limits), and features/dependencies it relies on.
- Historical constraints: user-facing compatibility guarantees, declared deprecations, accepted behavior changes, platform/version support, and lifecycle transitions.
- Contradictory evidence or ambiguous behavior as an explicit limitation in `run.limitations`.

Use **evidence priority**, not blind authority: a current project specification is stronger about intended policy than a source guess; executable tests are strong evidence of tested behavior but can encode bugs; implementation is evidence of current behavior, not necessarily desired behavior. When evidence disagrees, preserve the disagreement and ask a human for intent where decisive.

Do not assume everything in a README works. Do not omit undocumented but reachable public behavior. Separate a new feature from a behavior regression in an existing feature.

## Deterministic coverage plan

Define a unit by `feature_id::axis::case_id`, with stable ASCII IDs; do not include agent identity, result, date, line number, or verdict in IDs. The canonical axes are:

| Axis | Question | Examples |
| --- | --- | --- |
| `primary` | Does the core advertised path work? | happy path, output, state change |
| `boundary` | Does the contract hold at edges? | empty, zero, maximum, encoding |
| `error` | Does the system fail correctly? | invalid input, timeout, rollback |
| `integration` | Do interacting components agree? | API/UI/storage, events, dependencies |
| `compatibility` | Are supported consumers preserved? | API, CLI, file formats, migration |
| `lifecycle` | Does it work over time? | create/update/delete, restart, retry, upgrade |

Every `in_scope` feature gets at least one case in each axis. Non-applicable axes require `not_applicable` with source-backed reason; do not silently omit. The six axes are a **minimum accounting structure**, not exhaustive test generation: add cases per input class, role, platform, configuration, fault mode, concurrency, performance threshold, and cross-feature interaction as warranted.

Use `out_of_scope` when the user explicitly excluded a feature or case, with reason. For incomplete runs record `deferred` (not assigned/budget), `blocked` (specific environment, dependency, approval, sandbox, fixture, or specification blocker), never `covered` by assumption.

A `covered` unit means HEAD behavior was actually observed to pass a check with test/runtime evidence. A `failed` unit means a checked HEAD assertion failed; this alone does not prove a regression. Static reasoning may generate a candidate or support an inapplicability decision, but may not fabricate an executed test.

Coverage critics look for missed entrypoints, sibling paths, alternate roles, config/platform modes, error handling, state transitions, changed dependencies, and excluded features whose exclusions lack justification. Their task is to propose missing units, not to ratify findings. The parent integrates deduplicated units, reassigns failed coverage, and revalidates the ledger.

## Prior-run reuse

For earlier runs, retain source refs and case identities. A previous pass can guide prioritization but is not a pass at HEAD unless relevant source, conditions, dependencies, and evidence are re-established. Changed behavior or changed dependencies require fresh checks. Old `blocked`/`deferred`/`needs_validation` units are not silently upgraded. Repeated audits should increase measured coverage, not merely duplicate prose.

