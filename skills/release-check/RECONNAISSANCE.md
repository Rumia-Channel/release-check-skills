# Reconnaissance and Coverage Planning

### Phase 1: Map the source, reconstruct intent, and seed coverage

The parent initializes `run-metadata.json`, applies the strict pre-reconnaissance budget gate in `SKILL.md`, then creates agent scratch roots, `system-map.md`, `feature-catalog.json`, and `coverage-ledger.json` before hunting. If the budget gate fails, record `run_status: "incomplete"` in `run-metadata.json` and launch no reconnaissance agent. Reconnaissance reads the target and locally available build/configuration state only; it never runs target code, fetches dependencies, or contacts external services.

Launch the baseline `research` agents in parallel (`1a`–`1d`, plus `1e` when `base_ref` is set). They return structured source facts with repository-relative `file:line` references and do not write files.

**Agent 1a: Product, stack, dependencies, external services, and local operation**

```text
Read the target at <target>. Do not use network access or execute target code. Return:
1. Product type, primary user personas, operators, and core workflows.
2. Languages, frameworks, runtimes (including version pins/Docker base images), package boundaries, build system, and packaging/distribution targets (CLI bin, library exports, web app, container, desktop installer, plugin).
3. Direct libraries/SDKs (manifest version ranges vs lockfile pinned versions and locally installed paths), plus every external service/SaaS/cloud/AI API referenced in source (base URLs, hardcoded API version headers, model IDs, webhook protocols, OAuth scopes).
4. Repository-relative entrypoints and subsystem boundaries, highlighting differences between dev execution and built/packaged outputs.
5. Exact build and test commands that could run offline with locally installed dependencies, their expected write locations, and target-controlled inputs they read. Do not run them.
6. Comparable software or protocol baseline visible from local docs and dependencies, if source-grounded (otherwise state none).
7. Missing local toolchains, compilers, runtimes, or build artifacts that limit local verification.
Return only observed facts with repository-relative file:line references.
```

**Agent 1b: Feature catalog, specifications, and historical intent**

```text
Read READMEs, product specs, API/CLI/schema definitions, changelogs, UI strings, docs, tests, and local git history/tags (when available) at <target>. Do not run target code. Return:
1. Every externally meaningful user feature (CLI commands, HTTP/RPC routes, UI screens/actions, SDK public APIs, file formats, scheduled jobs, webhooks, config flags, plugins) and cross-cutting infrastructure surfaces (auth/config loading, error handling, persistence, caching, migrations, telemetry/health).
2. For each feature: stable candidate ID, human name, purpose, intent_status (`documented` | `inferred` | `unknown`), traceable intent_evidence (doc/spec/test/git ref + line + detail), entrypoints, and observable behavioral contracts/invariants (inputs, outputs, side effects, errors, ordering, limits, lifecycle).
3. Compatibility guarantees, deprecations, migrations, and supported platform/version constraints.
4. Contradictions or ambiguities between documentation, comments, tests, and implementation. Do not guess author intent when contradictory or absent.
Return facts with exact repository-relative file:line or git:ref citations.
```

**Agent 1c: End-to-end data flows, state stores, wiring, and sibling paths**

```text
Trace how inputs and actions actually flow through <target> without executing code:
1. For every entrypoint, follow parsing, defaults, config/feature-flag gating, validation, business logic, state/persistence/cache writes, background/async queues, external integrations, output formatting, and error/cleanup/rollback paths.
2. Flag structural malfunction hotspots: accepted options/flags/UI controls that appear disconnected or overridden downstream; stubbed/TODO/No-Op handlers; broad try/catch or fallback branches that swallow errors; schema/type mismatches between producer and consumer layers; non-transactional multi-step writes; lifecycle cleanup gaps.
3. Map sibling and legacy paths that mutate or read the same state (interactive endpoint vs batch/import/CLI/migration/retry/admin path).
4. Record cross-feature dependencies and shared mutable state.
Return repository-relative file:line paths and specific observations.
```

**Agent 1d: Test-suite blind spots, local test environments, and virtual-harness feasibility**

```text
Read existing test suites, test helpers, mocks/fixtures, build scripts, CI definitions, manifests, and environment overlays at <target> without running them. Return:
1. Test-suite blind spots: which features or modules rely heavily on mocks/stubs that bypass real internal wiring; tests with weak assertions (e.g., exit-code 0, no-throw, non-null only); tests that run only `src/` instead of built/packaged artifacts; skipped/disabled/quarantined tests; untested error, boundary, concurrency, upgrade/rollback, and cross-platform paths; tests that appear to encode suspicious or contradictory behavior.
2. Real test-environment capabilities available locally inside the sandbox: which offline unit/integration/E2E suites, built CLI binaries, ephemeral local stores (SQLite/files/in-memory DBs), isolated loopback servers, or headless UI runners can execute with dummy data without network access.
3. Virtual-test harness surfaces: identify the exact external boundaries (third-party APIs, LLM/MCP providers, clocks, disk errors, queues) that should be virtualized in scratch harnesses while keeping internal target code unmocked, plus fixtures/schemas needed to test cold start, error rollback, concurrency, and upgrades.
4. Commands that fetch dependencies, access networks, contact live/paid APIs, or mutate shared state (mark prohibited).
5. Deployed/runtime controls, external staging services, OS/browser matrices, or environment configs not visible or runnable locally (these require needs_validation with an owner-run environment test plan if decisive).
6. Whether the local platform can enforce all required sandbox controls (no external network, empty allowlisted env, read-only target/tools, scratch-only writes, resource/time limits) and parent-side no-follow descriptor-based artifact promotion. Missing controls block execution.
Return facts with repository-relative file:line references.
```

**Agent 1e (launch only when `base_ref` is non-null): Revision diff and blast-radius mapping**

```text
Inspect the repository diff between base_ref (<base_ref>) and head_ref (<head_ref>), plus dirty worktree state if any, without executing target code. Return:
1. Changed files, modified public interfaces, schemas, config defaults, migrations, CLI flags, exports, dependencies, and build/packaging files.
2. Transitive callers, downstream consumers, sibling paths, and cross-feature dependents affected by the changes.
3. Documented release notes, migration guides, or commit/PR rationales explaining intended changes versus undocumented behavioral shifts.
4. Any build/dependency differences between BASE and HEAD that could affect like-for-like comparability.
Return repository-relative file:line and revision citations.
```

**Agent 1f (launch when key third-party frameworks/SDKs or external services exist and budget permits): Library and external service latest-specification check**

```text
Inspect manifests, lockfiles, locally installed library types/source (read-only), and
external service clients identified by Agent 1a. Do not execute target code or probe live
API endpoints. When authorized read-only web/doc lookup is available, consult authoritative
official documentation, changelogs, release notes, and sunset/deprecation notices (recording
exact source URL/doc name and retrieval date); never rely on unverified memory. Return:
1. Installed/pinned library API mismatches: methods, options, middleware signatures, defaults,
   or error classes called by target code that differ from the actual installed/pinned version.
2. Latest-release and runtime drift: pinned/floating library or runtime versions with known
   breaking changes, deprecations, EOL status, or changed defaults in current official releases.
3. External service specification drift: hardcoded endpoints, API-version headers, LLM model
   IDs, OAuth scopes, webhook signature/payload formats, or pagination/rate-limit assumptions
   that conflict with current official service specifications or sunset notices.
4. Offline/visibility gaps: every library or external service whose latest specification could
   not be verified from official docs (mark explicitly for needs_validation/limitations).
Return facts with repository-relative file:line citations and dated official doc references.
```

Add focused `research` agents for materially distinct subsystems, frontends, native components, or deployment modes that the baseline agents do not cover. Enforce the budget gate in `SKILL.md` before launching any focused agent (`1f` included): if the budget blocks a focused agent, launch nothing for it, seed the unmapped area as `deferred` with `budget_cannot_reserve_critics_and_validation`, and disclose the gap.

## Prior-run input

Before seeding work, the parent reads every compatible prior `feature-catalog.json`, `coverage-ledger.json`, and `findings.json` for the same repo:

- Compare current source, contracts, and dependencies against every prior feature, coverage unit, and finding. A prior source ref alone does not prove unchanged behavior.
- Carry an unchanged prior `confirmed_defect`, `confirmed_regression`, or `confirmed_change` into the current candidate set with the same `fingerprint` only when its relevant source, baseline (`base_ref`), and conditions remain unchanged and its evidence meets the current contract. Link it to a `planned` unit with `prior_status: "prior_confirmed_same_source"`, put only that carried root cause on the hunter exclusion list, and send it through Phase 3 verification (whose verifier becomes the unit's assignment owner).
- Seed `prior_confirmed_changed_source` when any relevant source, dependency, or baseline changed; do not exclude that root cause from hunters.
- Seed `planned` work for prior `needs_validation`, `deferred`, `blocked`, `out_of_scope` (when now in scope), and changed-source units. A still-blocked `needs_validation` record may carry its fingerprint only after verifying current source supports its trace, linked to a `planned` unit with `prior_status: "prior_needs_validation"`.
- Treat prior `rejected` records as suppressing only the exact unchanged claim when source and evidence are unchanged, never coverage of the unit itself.
- Record incompatible or absent prior ledgers instead of treating them as empty coverage.

Record prior-run paths in `run-metadata.json` and summarize coverage consequences in `system-map.md`.

## System map and companion selection

The parent synthesizes `<output-dir>/system-map.md` with a hard cap of about 1,000 words:

1. Product overview, user roles, core workflows, and summary of reconstructed feature contracts & intent contradictions.
2. Comparable-software baseline from Agent 1a, if source-grounded (omit when absent).
3. Tech stack, packaging targets, dev-vs-built differences, and offline sandbox/toolchain limits.
4. Critical end-to-end data/state flows, sibling paths, and structural malfunction hotspots (unwired controls, silent catches, contract mismatches).
5. Test-suite blind spots (mocked-away wiring, weak assertions, outdated service mocks, untested failure/lifecycle modes).
6. Pinned vs latest library, runtime, and external service specification findings, deprecation/sunset risks, and whether official doc lookup ran or was offline-limited.
7. Revision diff blast radius (`base_ref` → `head_ref`), when applicable.
8. Repository-relative starting paths per subsystem.
9. Prior coverage gaps, changed-source revalidation targets, and carried exclusions.
10. Companion-selection summary derived from [DEFECT-CLASSES.md](DEFECT-CLASSES.md): selected companion files and the concrete boundaries/subsystems requiring them.

Keep assignment-level ordinary blocks, selected companion blocks, and excluded blocks with reasons inside each unit of `coverage-ledger.json`, not inside `system-map.md`. Select a companion file only because reconnaissance found the corresponding functional surface described in its `When to use this file` section—never merely because a dependency name exists.

## Feature catalog (`feature-catalog.json`)

The parent writes `<output-dir>/feature-catalog.json` as a top-level JSON array matching [feature-catalog-schema.json](feature-catalog-schema.json), sorted lexicographically by `feature_id`:

- Assign stable, source-derived ASCII `feature_id` values matching `^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$` without `::` (no line numbers or agent ordinals).
- Include every externally meaningful `user_feature` and essential `cross_cutting` infrastructure surface.
- Set `intent_status` honestly (`documented`, `inferred`, or `unknown` with `purpose: null`).
- Record `in_scope` (requires nonempty `entrypoints`, nonempty `contracts`, and `exclusion_reason: null`) or `out_of_scope` (requires nonempty `exclusion_reason`).

Validate immediately:

```sh
node <skill-dir>/scripts/validate-feature-catalog.cjs <output-dir>/feature-catalog.json
```

## Deterministic coverage ledger (`coverage-ledger.json`)

The parent writes `<output-dir>/coverage-ledger.json` as a top-level JSON array. Derive one unit for every material combination of `feature`, `surface`, `subsystem`, and applicable ordinary or companion `defect_class` at the run profile's granularity (`quick` uses `profile/quick/all-in-scope-subsystems` for `subsystem`; `deep` splits per subsystem and `lifecycle` mode). Record excluded surfaces discovered in scoped runs as `out_of_scope` units.

### Six mandatory release axes

Across its ledger units, every `in_scope` `user_feature` must account for all six canonical release axes (either covered by active units or explicitly recorded in `not_applicable` / `out_of_scope` / `deferred` units with source-backed reasons):

| Axis | Core Verification Question |
|---|---|
| `primary` | Does the core advertised path actually wire end-to-end and succeed with real data? |
| `boundary` | Do limits, empty/zero/max values, encodings, and edge configurations hold? |
| `error` | Are invalid inputs, dependency failures, timeouts, and partial failures surfaced and rolled back cleanly without silent failure? |
| `integration` | Do interacting components, UI/API/DB/jobs, plugins, and third-party contracts agree on types, defaults, and side effects? |
| `compatibility` | Are supported APIs, CLI flags, schemas, persisted data, migrations, and cross-platform behaviors preserved? |
| `lifecycle` | Do create/update/delete, init/shutdown, restart, retry, upgrade/downgrade, and resource cleanup hold over time? |

Each active unit declares a nonempty `axes` array identifying which of these six axes it investigates.

### Canonical references and RFC 3986 `coverage_id`

Each dimension (`feature`, `surface`, `subsystem`, `defect_class`, and optional `lifecycle`) has a human label and an exact source-derived identifier in `canonical_refs` (`canonical_refs.feature` must equal a `feature_id` in `feature-catalog.json`; block references use `FILE.md#Exact Bold Class Name` or `FILE.md#Section heading` before any parenthetical qualifier). Derive `coverage_id` deterministically:

1. Require every `canonical_refs` value to be Unicode NFC with valid scalar values, visible content, no control, format, line/paragraph separator, or default-ignorable code point, and no surrounding whitespace.
2. Percent-encode its UTF-8 bytes per RFC 3986: leave only `A-Z a-z 0-9 - . _ ~` unescaped and encode every other byte as uppercase `%HH`.
3. Join encoded `feature`, `surface`, `subsystem`, and `defect_class` with `::`; append encoded `lifecycle` when present.

Sort units lexicographically by `coverage_id` before every assignment. Fail on duplicate IDs, canonical identity collisions, or semantic tuple duplication.

### Unit structure

```json
{
  "coverage_id": "...",
  "canonical_refs": {
    "feature": "cli-export",
    "surface": "src/cli/export.ts#runExport",
    "subsystem": "packages/cli",
    "defect_class": "DEFECT-CLASSES.md#Silent failures and swallowed errors"
  },
  "feature": "CLI export",
  "surface": "cli export command",
  "subsystem": "packages/cli",
  "defect_class": "Silent failures and swallowed errors",
  "axes": ["error", "primary"],
  "starting_paths": ["packages/cli/src/export.ts"],
  "ordinary_defect_class_block": "DEFECT-CLASSES.md#Silent failures and swallowed errors",
  "selected_companion_blocks": [
    "CLI-LIBRARY-AND-PACKAGING.md#Core discipline",
    "CLI-LIBRARY-AND-PACKAGING.md#Exit code, stdout/stderr separation, TTY, and machine-output defects",
    "CLI-LIBRARY-AND-PACKAGING.md#Universal moves",
    "CLI-LIBRARY-AND-PACKAGING.md#Validation rules"
  ],
  "excluded_blocks": [
    {
      "block": "UI-AND-FRONTEND.md#Core discipline",
      "reason": "CLI package renders no browser UI"
    }
  ],
  "prior_status": "none",
  "attempts": [],
  "wave": 1,
  "status": "planned",
  "agent_id": null,
  "reviewed_paths": [],
  "checks": [],
  "result_fingerprints": [],
  "unresolved": []
}
```

When `lifecycle` is material, include both `canonical_refs.lifecycle` and human `lifecycle`. `ordinary_defect_class_block` may be `null` only when a companion defect class alone applies. Parent bookkeeping fields (such as retained `quality_notes`) may be added outside semantic fields, while keeping semantic fields unchanged.

### State invariants and append-only `attempts`

Enforce this state table strictly across every unit and archived attempt:

| Status | Unit `agent_id` | `reviewed_paths` / `checks` | `result_fingerprints` | `unresolved` |
|---|---|---|---|---|
| `planned` | `null` | empty | empty | empty |
| `not_applicable`, `out_of_scope`, `deferred` | `null` | empty | empty | nonempty reason |
| `in_progress` | canonical owner | empty | empty | empty |
| `blocked` | canonical owner | both nonempty owned partial evidence | empty | nonempty blocker |
| `covered` | canonical owner | both nonempty (no check may have `outcome: "fail"`) | empty | empty |
| `candidate` | canonical owner | both nonempty | nonempty | optional |

Every entry in `checks` records `agent_id`, nonempty `reviewed_paths`, `invariant`, `revision` (`head|base|base_and_head|context`), `method` (`source|local`), `test_kind` (`source_trace` when `method: "source"`; `existing_test|real_env_test|virtual_test|base_head_differential` when `method: "local"`), `virtualized_boundaries` (empty `[]` for `source` or fully real tests; array of named external boundaries virtualized for `virtual_test` / stubbed checks), `outcome` (`pass|fail|inconclusive|blocked`), `result`, and `artifact` (`null` for `source`; promoted regular file under `agents/<check.agent_id>/artifacts/` for `local`). Unit `reviewed_paths` must equal the exact union of `checks[*].reviewed_paths`. See [TESTING-AND-HARNESSES.md](TESTING-AND-HARNESSES.md) for real-test vs virtual-test rules.

When a coverage critic reopens a `blocked`, `covered`, or `candidate` unit, archive its exact live terminal state (`wave`, `status`, `agent_id`, `reviewed_paths`, `checks`, `result_fingerprints`, `unresolved`, plus `reassignment_reason`) into `attempts` (strictly increasing `wave < current wave`), increment live `wave`, assign a fresh `agent_id`, and start with empty live evidence. Never copy archived checks or artifacts into live fields.

Validate both files after seeding, after every update, and before Phase 6:

```sh
node <skill-dir>/scripts/validate-feature-catalog.cjs <output-dir>/feature-catalog.json
node <skill-dir>/scripts/validate-coverage-ledger.cjs <output-dir>/coverage-ledger.json
```
