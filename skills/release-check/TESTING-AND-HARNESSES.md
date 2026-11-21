# Real Testing and Virtual Test Harnesses

This guide defines how hunters (Phase 2) and adversarial verifiers (Phase 3) design, execute, and audit **real tests in isolated test environments** and **virtual (synthetic) test harnesses** inside the OS-enforced sandbox—so hidden implementation malfunctions are exposed empirically without modifying target source or touching live infrastructure.

## Why both real tests and virtual tests are mandatory

Existing test suites frequently stay green while real functionality is broken because they:
- mock out the exact adapter, parser, store, router, or middleware where wiring failed;
- assert weak postconditions (exit code `0`, no exception thrown, truthy response) without checking real outputs or persisted state;
- exercise `src/` under a dev runner instead of the built/packaged artifact shipped to users;
- cover only clean happy-path fixtures and skip error rollback, concurrency, cold start, upgrade, and cross-feature composition.

A thorough audit therefore combines **four distinct test levels**, recorded explicitly in every ledger check (`test_kind`) and every confirmed finding (`execution.test_kind` + `execution.virtualized_boundaries`):

| `test_kind` | What it runs | What it proves | Key limitation |
|---|---|---|---|
| `existing_test` | An existing repository test audited for real assertions and real collaborators | Baseline contract behavior for checked assertions only | Never closes a unit if mocks bypass the suspect layer |
| `real_env_test` | The actual app, service, CLI binary, built package, or UI running in an isolated local test environment (ephemeral DB/files/loopback/headless browser) with real internal wiring | True end-to-end wiring, startup, persistence, packaging, and cross-component agreement | Unavailable if required OS/service/hardware cannot run locally |
| `virtual_test` | An auditor-authored, disposable synthetic harness written strictly inside `<output-dir>/agents/<agent-id>/scratch/` targeting a specific defect hypothesis | Exposes unwired options, swallowed errors, partial writes, edge/boundary failures, async races, lifecycle leaks, and external-failure mishandling | Must obey anti-tautology & external-boundary-only virtualization rules |
| `base_head_differential` | Identical real or virtual harness executed side-by-side against disposable `base_ref` and `head_ref` checkouts under verified comparable conditions | Proves whether a failure is a true `confirmed_regression`, a pre-existing `confirmed_defect`, or a `confirmed_change` | Requires valid `base_ref !== null` and documented `environment_comparability` |

## Execution workspace rules (never mutate target source)

1. Target source at `<target>` remains strictly **read-only**.
2. All virtual test scripts, ephemeral fixtures, temporary databases, fake loopback servers, unpacked build artifacts, and disposable `base_ref`/`head_ref` copies live strictly inside `<output-dir>/agents/<agent-id>/scratch/`.
3. Every target-controlled command runs inside the verified OS-enforced sandbox: disabled external networking (isolated loopback only when local client/server traffic is required), empty allowlisted environment with scratch-local `HOME`/`TMPDIR`/cache, explicit low CPU/memory/process/file-size/disk/wall-clock limits, and zero package fetching.
4. Retain only small, sanitized, non-secret outputs (test harness summary, command/input record, observed stdout/stderr/exit code, state diff) promoted from `scratch/` to `agents/<agent-id>/artifacts/` exclusively by trusted parent-side promotion code (see the 11-step promotion procedure in [HUNTING.md](HUNTING.md)).
5. If required sandbox controls or runtime dependencies are unavailable, **do not execute target code**: record the exact blocker and emit a concrete owner-run test plan under `needs_validation`.

## Part 1: Running real tests in an isolated test environment (`real_env_test` & `existing_test`)

### 1.1 Auditing existing tests before running or trusting them (`existing_test`)

Before treating an existing test as evidence for a coverage unit, read the test file and its helpers:
1. **Assertion audit**: Does it assert exact return values, persisted rows/files, HTTP status + body schema, exit codes, and side effects—or only `toBeDefined()` / no throw?
2. **Mock audit**: List every `mock`, `spy`, `stub`, `fake`, or DI override. If the test mocks the internal layer whose wiring or contract is under review, it **cannot** close the unit; record the blind spot and build an unmocked real or virtual test.
3. **Artifact parity audit**: Note whether the test runs against `src/` (dev mode) or the compiled/packaged artifact (`dist/`, built binary, container image).
4. **Targeted execution**: Run the narrowest relevant test file/case inside the sandbox with explicit scratch paths and resource caps, capturing exact command, test filter, pass/fail output, and asserted invariants.

### 1.2 Isolated real test-environment execution (`real_env_test`)

When the target is a service, CLI, web app, daemon, worker, or library with locally available runtimes/stores, exercise the **real assembled system** inside `scratch/`:

1. **Isolated data & config**: Point databases (e.g., ephemeral SQLite file, local sandboxed DB instance), file stores, caches, and config files exclusively to `<scratch>/env/`. Use dummy seed fixtures—never production data or host `$HOME` configs.
2. **Isolated loopback network**: Bind servers/daemons only to an isolated loopback namespace (`127.0.0.1` ephemeral port) with strict startup/shutdown timeouts and guaranteed process teardown.
3. **Real full-workflow exercise**: Run realistic multi-step user journeys through the public interface (not internal private functions):
   - Fresh cold start (empty store, default config, minimal env)
   - Core CRUD / command / API / UI workflow with real serialization and persistence
   - Restart / reload of the process to verify state survives durably and caches reload cleanly
   - Graceful shutdown (`SIGINT`/`SIGTERM`) to confirm clean flush and zero orphan processes or corrupt files
4. **Built/packaged verification**: Whenever the project builds or bundles artifacts (`npm run build`, compiled binary, wheel, archive), run at least one real check against the **built output** (e.g., executing the actual `bin` entrypoint or importing the built package from a neutral scratch consumer directory) to catch missing runtime dependencies, broken `exports`, and missing bundled assets.

### 1.3 Like-for-like BASE vs HEAD comparison (`base_head_differential`)

When `base_ref` is non-null and a regression or behavior change is suspected:
1. Prepare two clean disposable checkouts/copies inside `scratch/base/` and `scratch/head/` (using existing local git objects—no network fetch). If `worktree_dirty: true`, state explicitly whether HEAD testing used the committed SHA or dirty working copy.
2. Verify comparability before attributing any difference to code:
   - Same runtime/compiler version and locally installed dependency tree (if lockfiles or build deps changed incompatibly between BASE and HEAD, record the exact comparability blocker instead of claiming a regression);
   - Identical allowlisted environment variables, config files, initial fixture/DB state, timezone/locale, and inputs;
   - Identical external boundary stubs (if any).
3. Run the identical real or virtual test harness against both `scratch/base/` and `scratch/head/` and capture exact `base_observed_result`, `head_observed_result`, and `environment_comparability`.
4. Classify rigorously:
   - BASE passes contract, HEAD breaks contract unintentionally → candidate `confirmed_regression`
   - BASE and HEAD both break the contract → candidate `confirmed_defect` (pre-existing malfunction, NOT a regression!)
   - BASE and HEAD differ materially, and change is documented/intended or intent is unconfirmed → candidate `confirmed_change` (`intended` or `unknown`).

## Part 2: Designing and running virtual / synthetic tests (`virtual_test`)

When existing tests are missing, over-mocked, or blind to a suspected hidden malfunction, write a **minimal, deterministic virtual test harness** inside `scratch/harnesses/<name>` that imports or invokes the **real target code** while virtualizing *only* external boundaries.

### Eight core virtual-test blueprints

#### 1. Unwired-option & hollow-implementation A/B differential probe
- **Target defects**: CLI flags, API parameters, UI toggles, config keys, or feature flags parsed at the boundary and silently ignored, shadowed, or overridden by defaults.
- **How to build**: Invoke the outermost public entrypoint twice with identical fixtures—once with option/flag/config set to value `A` (e.g., default) and once set to value `B` (e.g., `--out file.json`, `dryRun=true`, `limit=2`, `featureX=false`). Assert that the observable output, written file, HTTP payload, or persisted state actually changes in the documented way.
- **What proves a defect**: Both runs return identical output or no-op despite documented contrasting behavior, backed by the source trace showing the option is dropped or overwritten.

#### 2. Boundary-only fault-injection virtual test
- **Target defects**: Swallowed exceptions (`catch {}`), fake `200 OK` / `exit 0` on error, partial multi-step writes without rollback, stale caches after failed writes, broken retry/DLQ paths.
- **How to build**: Keep **every internal module real and unmocked**. Inject controlled faults *only* at the outermost external I/O boundary:
  - Ephemeral local loopback HTTP stub returning `500`, `429 Retry-After`, malformed JSON, slow delay exceeding timeout, or abrupt mid-body socket close;
  - Read-only scratch output directory, non-existent parent path, pre-populated colliding filename, or corrupted/truncated local state file;
  - Deterministic failure triggered on the N-th call of an external storage/queue/provider adapter to fault step 2 of a 3-step mutation.
- **What to assert**: Caller receives an accurate error/non-zero exit code, step 1 was rolled back or compensated cleanly, and no corrupted/half-written state remains on disk, cache, or DB.

#### 3. Boundary, adversarial-input & round-trip property harness
- **Target defects**: Off-by-one pagination, `0`/`""`/`false` falsy coercion bugs, NaN/overflow/precision loss, timezone/DST/leap-day bugs, Unicode/CRLF/path-with-spaces truncation, schema drift, lossy serialization.
- **How to build**: Drive a small deterministic input matrix through real parsers, validators, domain services, and serializers:
  - Empty collections (`[]`, `{}`), single-item, exact page-size, page-size + 1, zero/negative/max numbers, strings with quotes/spaces/CRLF/Unicode/combining marks, `null` vs omitted optional keys, extra unknown fields.
  - **Round-trip checks**: `deserialize(serialize(x))`, `import(export(x))`, `update(create(x))`, verifying no silent field loss, precision drift, or re-ordering corruption.
  - **Sibling-path parity checks**: Send the exact same valid and invalid edge inputs to parallel entrypoints (e.g., REST vs CLI vs batch import, or client validator vs server validator) and compare decisions.

#### 4. Deterministic concurrency, ordering & cancellation harness
- **Target defects**: Lost updates on read-modify-write, duplicate creation under concurrent clicks/retries, slow async response #1 overwriting newer response #2, leaked timers/handles, mutations continuing after abort/timeout.
- **How to build**:
  - **Controlled ordering barrier**: Use a local deferred-promise/barrier stub at the external boundary so request #1 pauses while request #2 completes, then release #1 and assert newer state is NOT clobbered.
  - **Parallel contention burst**: Launch a small deterministic parallel batch (e.g., 5–10 concurrent calls inside sandbox limits) targeting the same resource/idempotency key/counter and verify final persisted count and uniqueness invariants.
  - **Mid-flight abort/shutdown test**: Trigger `AbortController.abort()`, close a local loopback client socket mid-stream, or send `SIGTERM` to a scratch child process during work, then inspect state consistency and lingering open handles/temp files.

#### 5. Cold-start, restart, upgrade & rollback lifecycle harness
- **Target defects**: Fresh install relying on dev seeds, broken schema/config migration on non-empty vN-1 data, soft-delete blocking re-creation, stale cache surviving restart, hot-reload leaks.
- **How to build**:
  - Run startup on a brand-new empty scratch directory with minimal required config only (no dev defaults or seed fixtures).
  - Seed a realistic dummy prior-version file/config/database schema (including NULLs, optional legacy fields, soft-deleted records, and edge values), run HEAD migration/load, verify data preservation, then execute downgrade/rollback if supported.
  - Execute create → update → soft-delete → recreate same identifier → restart → read across primary store, cache, and index.

#### 6. Packaged-consumer & cross-layer contract harness
- **Target defects**: Works in `src/` dev mode but breaks after build/pack; runtime import of `devDependencies`; missing templates/schemas/migrations in built package; ESM vs CJS dual-package mismatch; CLI stdout polluted by debug logs in `--json` mode.
- **How to build**: Create an isolated consumer script in `scratch/consumer/` that imports only the built entrypoint (or invokes the built CLI binary from an unrelated scratch working directory with piped stdin `< /dev/null`), parses stdout strictly (e.g., `JSON.parse`), checks stderr separation, and verifies exit codes.

#### 7. Deterministic fake external protocol / LLM / MCP harness
- **Target defects**: Tool-schema vs handler dispatch mismatch, crashing on markdown-fenced/partial streaming JSON, swallowed tool errors, unbounded agent loops, webhook replay/out-of-order bugs, pagination stopping after page 1.
- **How to build**: Stand up a tiny local loopback or stdio script inside `scratch/` that replays deterministic edge protocol responses (multi-page API with changing cursor, duplicate webhook event, truncated JSON chunk, malformed tool arguments, repeated tool error) into the real target client/agent loop—zero live API calls, zero paid spend.

#### 8. Latest library & external-service specification conformance harness
- **Target defects**: Code misusing the actually installed/pinned library version (renamed options, changed defaults, removed signatures); outbound HTTP/SDK requests sending retired model IDs, obsolete API-version headers, removed fields, or deprecated endpoints; target parsers crashing or dropping fields when fed the external service's latest officially documented response/webhook/error payload.
- **How to build**:
  1. **Installed-library unmocked check**: Import the real installed library/SDK (never mocked!) inside `scratch/` and exercise the exact target wrapper with realistic inputs to prove whether options/defaults/error classes actually work as target code assumes.
  2. **Outbound-request capture check**: Point the real target service client at a local loopback capture server in `scratch/` (listing the external service in `virtualized_boundaries`), trigger the real feature path, record exact HTTP method, URL path, headers (API version, auth scheme, content-type), model ID, and JSON body, and diff them against the authoritative retrieved official specification.
  3. **Latest-spec response & webhook replay**: Replay exact response, error, rate-limit, and webhook payloads documented in the external service's latest official docs (including newly optional/nullable fields or updated schema fields) into the real target handler without mocking internal parsing or domain logic.

## Part 3: Mock-boundary discipline and anti-tautology rules

Every local check MUST populate `virtualized_boundaries` (an array of strings naming each virtualized external dependency, or `[]` when zero virtualization was used).

### Allowed vs disallowed virtualization

| Boundary | Virtualizing in `virtual_test`? | Rule |
|---|---|---|
| External third-party SaaS / cloud / paid LLM API | **Allowed** | Virtualize via local loopback stub or deterministic client double; record exact boundary name in `virtualized_boundaries` |
| System clock / timezone / randomness (for DST/expiry/determinism) | **Allowed** | Virtualize via injected clock or deterministic seed; record in `virtualized_boundaries` |
| External network socket / transient disk error (for fault injection) | **Allowed** | Inject faults at the true I/O edge while keeping target parsing, logic, transaction, and error-handling code real |
| Target's own parser, validator, router, middleware, domain service, serializer, or ORM query builder | **DISALLOWED** | Never mock the target's internal wiring! A test that mocks internal layers under audit cannot establish `confirmed_*` or close an `integration` / `hollow_or_unwired` coverage unit |

### Anti-tautology checklist (mandatory for Hunters and Phase 3 Verifiers)

Before accepting any virtual test result:
1. **Real target code executed**: Does the harness invoke actual target repository files or built artifacts (never re-typed/copied logic)?
2. **No mocked-away bug**: Do `virtualized_boundaries` exclude all internal components along the `entrypoint` → `sink` trace?
3. **Reachable inputs**: Could a real caller, user action, persisted file, or external peer realistically supply the test inputs?
4. **Grounded oracle**: Is the expected behavior backed by documented specs, public interfaces, BASE behavior, or fundamental functional invariants (no crash/data corruption/silent no-op)—never an invented preference?
5. **Minimal bounded scope**: Did execution stay within strict sandbox limits, dummy data, and scratch-only writes, and was evidence promoted via the 11-step parent procedure?

## Part 4: Compact test-evidence artifact format

When a local check (`existing_test`, `real_env_test`, `virtual_test`, or `base_head_differential`) runs inside the sandbox, write a compact, non-secret evidence record inside `scratch/` (predeclared on the parent's promotion allowlist and byte limit) so the parent promotes it to `agents/<agent-id>/artifacts/<file>`:

```text
TEST_KIND: virtual_test | real_env_test | existing_test | base_head_differential
COVERAGE_ID: <canonical coverage_id>
REVISION: head=<head_ref> base=<base_ref_or_null> dirty=<true|false>
COMMAND: <exact reproducible invocation>
ALLOWLISTED_ENV: <KEY=safe_value ... (never ambient env or secrets)>
SANDBOX_LIMITS: net=none|loopback_only cpu=... mem=... wall=...
REAL_COMPONENTS: <actual target entrypoints/modules/binaries executed>
VIRTUALIZED_BOUNDARIES: <none | comma-separated external boundaries>
INPUTS_OR_FIXTURE: <minimal input or scratch fixture summary>
EXPECTED_INVARIANT: <specific contract or invariant asserted>
OBSERVED_RESULT: <exact exit code, key output/state diff, failure message>
OUTCOME: pass | fail | inconclusive | blocked
```

## Part 5: When a real test environment is unavailable (`needs_validation`)

Never fabricate runtime verification or poke live staging/production endpoints when a decisive test cannot execute locally (for example: missing OS-enforced sandbox, Windows/macOS-only behavior while auditing on Linux, managed cloud broker/DB semantics, real browser GPU rendering, or live third-party webhook behavior).

Instead:
1. Record the exact missing environment or sandbox capability in `blockers`.
2. Provide an exact, non-destructive owner-run recipe in `validation_plan`:
   - `local`: exact minimal command or virtual harness the owner can run locally in a sandboxed environment;
   - `environment`: exact step-by-step check in the owner's staging/CI/target-OS test environment (with dummy tenant/fixture, expected vs failing observation, and rollback safety);
   - `owner_intent`: exact product question when specs, tests, and code disagree on desired behavior.
