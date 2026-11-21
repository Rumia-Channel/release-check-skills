# Defect Classes

#### Defect classes — choose and split based on Phase 1

Select defect classes relevant to the product's architecture and features. Not every class applies to every unit; use Phase 1's feature catalog, wiring trace, test-blind-spot audit, and `base_ref..head_ref` diff to prioritize high-yield classes and split large codebases per feature and subsystem. Keep validation within read-only source review and bounded sandboxed local checks; never probe live deployments or alter target source.

Use `confirmed_defect` when source evidence and bounded local HEAD validation prove an actual malfunction (new or pre-existing). Use `confirmed_regression` when comparable BASE-pass and HEAD-fail evidence establish unintended breakage of a supported contract. Use `confirmed_change` when BASE→HEAD behavior materially changed and is either `intended` or `unknown`. Use `needs_validation` when runtime execution, external environment, BASE comparability, or contradictory owner intent prevents settling the claim locally.

> **UI and frontend targets** (SPAs, browser apps, reactive components, forms, client routing, SSR/hydration, browser storage, multi-tab state): use [UI-AND-FRONTEND.md](UI-AND-FRONTEND.md).
>
> **API, RPC, and protocol targets** (HTTP/REST/GraphQL/gRPC handlers, request/response schemas, pagination, status codes, idempotency, webhooks, versioning): use [API-AND-PROTOCOLS.md](API-AND-PROTOCOLS.md).
>
> **State, database, and persistence targets** (transactions, caches, SQL/ORM queries, migrations, soft-deletes, file/blob storage): use [STATE-AND-PERSISTENCE.md](STATE-AND-PERSISTENCE.md).
>
> **Async jobs, queues, and integration targets** (background workers, cron/schedulers, event consumers, retries/DLQ, third-party APIs, shutdown cancellation): use [ASYNC-JOBS-AND-INTEGRATIONS.md](ASYNC-JOBS-AND-INTEGRATIONS.md).
>
> **CLI, library, SDK, and packaging targets** (CLI flags/exit codes, cross-platform paths, package exports/types, build vs dev drift, plugin hooks): use [CLI-LIBRARY-AND-PACKAGING.md](CLI-LIBRARY-AND-PACKAGING.md).
>
> **Configuration, build, and lifecycle targets** (config precedence, feature flags, bootstrap ordering, upgrade/downgrade, health checks, containers/manifests): use [CONFIG-BUILD-AND-LIFECYCLE.md](CONFIG-BUILD-AND-LIFECYCLE.md).
>
> **AI, agent, and LLM workflow targets** (tool schemas/dispatch, prompt assembly, structured output parsing, agent loops/budgets, RAG indexing, MCP clients/servers): use [AI-AGENT-AND-LLM-WORKFLOWS.md](AI-AGENT-AND-LLM-WORKFLOWS.md).
>
> **Native, desktop, and systems targets** (C/C++/Rust/native handles, threads/locks, FFI/ABI, local IPC, OS/filesystem assumptions, installers/updaters): use [NATIVE-DESKTOP-AND-SYSTEMS.md](NATIVE-DESKTOP-AND-SYSTEMS.md).
>
> **Third-party library, runtime, and external service targets** (pinned vs installed SDK/framework APIs, floating dependency ranges, EOL runtimes/base images, external SaaS/Cloud/AI APIs, hardcoded model IDs, API version headers, upstream webhook/response schema drift): use [DEPENDENCIES-AND-EXTERNAL-SERVICES.md](DEPENDENCIES-AND-EXTERNAL-SERVICES.md).

**Hollow, stubbed, and unwired implementations** (subagent_type: `general`)
Features that appear present in UI, CLI help, API schemas, or config files yet silently do nothing, execute placeholder logic, or drop inputs before reaching the real worker:
- Accepted CLI flags, API request fields, query parameters, or config options parsed at the boundary and silently ignored, overwritten by defaults, or never passed into the inner call.
- UI buttons, menu actions, modal confirmations, or form controls bound to no-op handlers, commented-out dispatches, or mocked responses left behind from prototyping.
- Functions returning hardcoded constants, empty arrays, dummy success objects, or `TODO`/`NotImplemented` branches under valid user paths.
- Middleware, validators, hooks, plugins, or event listeners registered in the wrong order, against the wrong key/event name, or never imported by the live entrypoint.
- Build or packaging configurations that ship outdated generated files or exclude handlers that work only in dev/source mode.

Verify the full call chain from public entrypoint to real side effect—never infer wiring just because symbols exist or unit tests mock the inner dependency.
- **Recommended local verification**: `virtual_test` A/B differential option probe (toggle each flag/config/UI control ON vs OFF through the real public entrypoint and assert real output/state changes) + `real_env_test` against the built/packaged artifact (see [TESTING-AND-HARNESSES.md](TESTING-AND-HARNESSES.md)).

**Silent failures and swallowed errors** (subagent_type: `general`)
Failures that pretend to succeed, drop data quietly, or mask broken operations from callers and operators:
- Broad `try/catch`, `recover`, or `|| defaultValue` blocks that catch real I/O, validation, parse, or persistence errors and return `200 OK`, `true`, `null`, `[]`, or stale cached values.
- Fire-and-forget promises, detached goroutines/threads, or unawaited async callbacks whose rejections vanish without error propagation, rollback, or failure recording.
- Error paths that log a warning or metric while leaving partial state committed, broken files on disk, or callers believing a save/export/delete succeeded.
- Validation or parsing that silently coerces malformed input (for example `NaN`, `0`, `false`, empty string, or truncated UTF-8) instead of rejecting it.
- Fallback chains where primary failure falls back to an incompatible or stale mode without surfacing failure when fallback also misbehaves.
- **Recommended local verification**: `virtual_test` boundary-only fault injection (local loopback HTTP 500/429/malformed body, read-only scratch dir, injected step-2 storage failure) keeping all internal code real and asserting accurate error propagation and rollback.

**Business logic, invariants, and edge-case defects** (subagent_type: `general`)
Logical errors inside core computations, rules, and boundary handling that unit happy-path tests miss:
- Off-by-one bounds, inclusive vs exclusive range checks (`<` vs `<=`), pagination fenceposts, and wrong operator precedence.
- Numeric edge cases: zero, negative values, floating-point rounding drift, currency/unit scaling errors, integer overflow/truncation, and `0 || default` falsy bugs where `0`, `""`, or `false` are valid inputs.
- Empty collections, missing optional fields, single-item vs multi-item batches, duplicate items, Unicode/multi-byte strings, whitespace-only strings, and special characters.
- Time and locale assumptions: DST transitions, UTC vs local timezone mismatches, leap days, monotonic vs wall clock elapsed comparisons, and locale-dependent formatting/sorting.
- State-machine bugs: skipped steps, invalid transitions, replayed completions, non-idempotent retries, and missing rollback when step 2 of 3 fails.
- **Recommended local verification**: `virtual_test` boundary, adversarial-input & round-trip matrix (empty, `0`, `""`, `false`, negative/max, DST/leap-day timestamps, Unicode/CRLF, pagination boundaries, and out-of-order state sequences).

**Contract drift and cross-layer disagreement** (subagent_type: `general`)
Two components communicate across a boundary while holding incompatible assumptions about shape, meaning, defaults, or invariants:
- Documentation, OpenAPI/JSON Schema, TypeScript/Protobuf types, CLI `--help`, or UI form rules promising behavior that runtime validation or handlers contradict.
- Caller/UI/client expecting one field name, enum value, timestamp unit (seconds vs milliseconds), encoding, nullability, or error envelope while server/worker emits or reads another.
- Producer and consumer parsing or normalizing the same value differently (case folding, path normalization, trimming, query-array encoding, decimal formatting).
- Validation applied at one entrypoint (e.g., UI or REST handler) while sibling entrypoints (CLI, batch import, GraphQL, internal job) accept the same state without enforcing the invariant.
- Mocked test fixtures encoding an outdated or idealized contract that drifted away from actual downstream behavior, installed library signatures, or the external service's latest official specification.
- **Recommended local verification**: `real_env_test` replacing mocked adapters with real local collaborators/installed libraries + `virtual_test` sibling-path parity check and latest-spec outbound-request capture / response replay (see [TESTING-AND-HARNESSES.md](TESTING-AND-HARNESSES.md) and [DEPENDENCIES-AND-EXTERNAL-SERVICES.md](DEPENDENCIES-AND-EXTERNAL-SERVICES.md)).

**State consistency, side effects, and lifecycle defects** (subagent_type: `general`)
Operations that leave persistent stores, caches, derived views, or runtime resources inconsistent across time:
- Non-atomic multi-step updates where crash or mid-operation error leaves database tables, indexes, caches, or files out of sync.
- Create, update, delete, restore, and cancellation paths that update primary records while forgetting caches, search indexes, counters, active timers, or child references.
- Initialization and teardown bugs: use before bootstrap completes, missing cleanup on close/abort/unmount, leaked file descriptors/connections/temp files, and inability to re-initialize cleanly.
- Upgrade, downgrade, and restart bugs: old persisted formats crashing new code, new default fields misinterpreted on existing rows, or resume logic re-executing completed steps.
- Shared mutable state (module globals, singleton caches, pooled buffers) leaking state from one request, tenant, or test run into the next.
- **Recommended local verification**: `real_env_test` / `virtual_test` cold-start, create→update→soft-delete→recreate, process restart, mid-write fault injection, and vN-1 upgrade/rollback harnesses in scratch.

**Concurrency, async, and ordering defects** (subagent_type: `general`)
Malfunctions triggered when work executes concurrently, re-entrantly, out of order, or under cancellation/timeouts:
- Check-then-act races (`read -> compute -> write` without atomic conditional update/lock) causing lost updates, duplicate creation, or double execution.
- Out-of-order async completion (slow request #1 overwriting newer request #2 in UI state, cache, or storage).
- Re-entrancy, double-submit, duplicate event delivery, and concurrent initialization races causing duplicate side effects or deadlocks.
- Missing cancellation/timeout propagation: timed-out caller receives failure while underlying job continues mutating state or holding locks/connections.
- Event-loop starvation, unbounded queue/buffer growth, or lock acquisition order mismatches under concurrent workflows.
- **Recommended local verification**: `virtual_test` deterministic barrier harness (pause async request #1 until request #2 finishes, then release #1), parallel contention bursts on shared keys/counters, and mid-flight abort/`SIGTERM` cleanup checks.

**Backward compatibility and revision regressions** (subagent_type: `general`)
Changes between `base_ref` and `head_ref` (or across supported versions) that break existing callers, data, or workflows:
- Removed, renamed, or tightened public functions, CLI flags, env vars, config keys, API routes, response fields, or error codes without documented deprecation/shim.
- Changed default values, sorting order, exit codes, return types, or null/empty handling affecting existing consumers.
- Broken reading/migration of config files, lockfiles, databases, exports, or serialized artifacts produced by prior versions.
- Transitive breakages: refactoring a shared helper subtly alters behavior for an unrelated caller or plugin hook.
- Platform/toolchain regressions: code now fails on a previously supported OS, shell, runtime version, or build mode.
- **Recommended local verification**: `base_head_differential` running the identical real or virtual harness against disposable `scratch/base/` and `scratch/head/` checkouts under verified comparable runtime, deps, config, and fixtures.

**Chained malfunctions and cross-feature interference** (subagent_type: `general`)
Features that appear healthy in isolation yet fail when composed sequentially or concurrently in real user workflows:
- Output produced by Feature A (export, normalization, migration, plugin transform, cache warmup) breaks Feature B (import, query, render, restore, downstream consumer).
- Shared configuration, global singleton, middleware, database table, or temp directory modified by one feature corrupts another feature's invariants.
- Multi-step workflow dependency failure: undo/redo, retry/resume, bulk-edit + export, or flag-A + flag-B combinations entering impossible states.
- Error recovery in one subsystem triggering cascading retries, stale cache poisoning, or duplicate execution in another.
- **Recommended local verification**: `real_env_test` multi-feature workflow composition (e.g., export→import, filter+sort+paginate, edit+cache+search, flag-A+flag-B) in an isolated scratch test environment without internal mocks.

**Wildcard** (subagent_type: `general`)
Hunt real functional bugs outside predefined checklists by investigating anomalies, inconsistencies, and under-tested seams inside your assigned scope:
- Read code that looks awkward, overly defensive, bolted-on, or surrounded by `temp`, `hack`, `legacy`, `workaround`, or apologetic comments—verify whether the workaround actually holds.
- Inspect the test suite's blind spots flagged in Phase 1: rewrite or trace what happens when mocks are replaced by the real callee, or when `skipped`/`todo` tests run against current code.
- Exercise the backend/library in sequences the UI or happy-path CLI never issues (partial payloads, out-of-order calls, empty batches, interrupted flows, repeated invocations).
- Check git history near complex files for reverted fixes, rushed patches, or incomplete refactors that left sibling paths inconsistent.
- Test hidden environment assumptions: empty `$HOME`, read-only working dir, non-UTF-8 or space-containing paths, clock jump, missing optional tool, non-zero exit from helper subprocess.

Pursue anomalies until the invariant is settled either way (`covered`, `candidate`, or `blocked`), reporting out-of-scope discoveries under `uncovered`. Prefer writing a minimal `virtual_test` harness in `scratch/` (or running a `real_env_test` against real collaborators) whenever mocked tests leave a seam unverified.

**Obvious broken things** (subagent_type: `general`)
Perform a literal, thorough sweep for blatant functional defects often overlooked because reviewers assume automated checks already caught them:
- Reachable `TODO`, `FIXME`, `XXX`, `NotImplementedError`, `throw new Error("unimplemented")`, or placeholder return statements inside active feature paths.
- Package manifest mismatches: broken `bin`, `main`, `exports`, missing runtime dependencies placed in `devDependencies`, or scripts referencing non-existent files.
- Hardcoded `localhost`, `127.0.0.1`, local file paths, developer usernames, or debug bypass flags left enabled in non-dev code paths.
- Copy-paste bugs: duplicated branches checking the wrong variable, swapped arguments (`(height, width)` vs `(width, height)`), inverted boolean conditions, or unreachable `else if` clauses.
- Lying status/health endpoints or CLI commands that unconditionally return `OK` / exit `0` without checking real readiness or operation success.
- Dead configuration or environment keys documented in README/example configs whose code lookup uses a different name or wrong type conversion (`"false"` treated as truthy!).
- Hardcoded retired/deprecated LLM model IDs, obsolete external API version headers, EOL runtime/base image tags, or unpinned `:latest`/`*` dependency ranges contradicting current official specifications.

**Important**: Every item found here still requires tracing the full reachable path and establishing real caller impact (preferring a `real_env_test` against built/packaged output or a minimal `virtual_test` invoking the broken flag/probe/manifest) before proposing a finding. A dead comment in unreachable test code is a `quality_note`, not a `confirmed_defect`.
