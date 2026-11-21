# Malfunction Hunting and Coverage Critics

### Phase 2: Run coverage-led hunting waves

The parent assigns `planned` ledger units to `general` agents. Keep units focused so unrelated features or architectural boundaries are not mixed into one hunter; closely related units within one feature or subsystem may share a hunter only when every unit remains tracked individually. Never silently drop a unit due to agent limits: mark unreached units `deferred` with reason `budget_cannot_reserve_critics_and_validation` (or `quick_profile_final_critic` in `quick`).

When budget or profile caps hunting waves, assign units in strict priority order and record priority order cleanly:
1. Core advertised `user_feature` contracts, data-mutating flows, and BASE→HEAD changed surfaces plus transitive dependents;
2. Surfaces flagged in Reconnaissance for test-suite blind spots (heavy mocking, weak assertions, untested error/wiring/lifecycle paths);
3. Prior-run gaps, `prior_confirmed_changed_source`, `prior_needs_validation`, and `prior_blocked`/`prior_deferred` before same-source re-passes;
4. Defect classes with high historical yield for hidden malfunctions (`Hollow, stubbed, and unwired implementations`, `Silent failures and swallowed errors`, `Contract drift and cross-layer disagreement`, `State consistency, side effects, and lifecycle defects`) before narrow edge classes.
Break ties lexicographically by `coverage_id` for determinism.

Before launching each hunter, the parent transitions assigned units to `in_progress`, assigns a canonical lowercase `agent_id` (`^[a-z0-9][a-z0-9_-]{0,63}$`, not a Windows reserved device name), creates `<output-dir>/agents/<agent-id>/scratch/` and parent-owned `artifacts/`, and opens non-inheritable directory descriptors with the predeclared scratch-relative promotion allowlist and byte bounds. Hunters never modify target source, `run-metadata.json`, `system-map.md`, `feature-catalog.json`, `coverage-ledger.json`, `findings.json`, retained `artifacts/`, or another agent's directory.

## Required hunter prompt

Every hunter prompt contains these 9 parts in this exact order:

1. Two-sentence role preamble: the hunter's goal is to find source-grounded hidden malfunctions, contract violations, and BASE→HEAD regressions in its assigned units, and it must return exactly one JSON object matching the structured-result contract at the end of this prompt with no surrounding prose.
2. `system-map.md` copied verbatim.
3. Assigned `coverage-ledger.json` units (`coverage_id`, `feature`, `surface`, `subsystem`, `defect_class`, `axes`, `starting_paths`, assignment block map) together with the linked feature entries (`purpose`, `intent_status`, `intent_evidence`, `entrypoints`, `contracts`) from `feature-catalog.json`.
4. Exact selected blocks copied verbatim: the unit's ordinary defect-class block from [DEFECT-CLASSES.md](DEFECT-CLASSES.md), and from each selected companion file its `Core discipline`, chosen defect-class subsections, `Universal moves`, and `Validation rules`. Include relevant testing blueprints and anti-tautology rules from [TESTING-AND-HARNESSES.md](TESTING-AND-HARNESSES.md) whenever local execution is enabled. Never pass block names alone.
5. Explicit excluded defect-class and companion blocks with the reason for each exclusion.
6. The **Core hunting method** block below, followed immediately by the **Artifact promotion procedure** block below.
7. The **Core candidate gate** block below.
8. Carried same-source prior confirmed exclusions (limited strictly to `fingerprint`, `title`, and `root_cause`), plus peer-owned current `coverage_id`s that this hunter must not duplicate.
9. The hunter's unique `agent_id`, `scratch/` and `artifacts/` paths, predeclared artifact promotion allowlist and byte limits, `base_ref`/`head_ref` comparability context, the **Structured hunter result** contract below, and the `confirmed_defect`, `confirmed_regression`, `confirmed_change`, and `needs_validation` branches of [report-schema.json](report-schema.json) copied verbatim.

If an unexpected unmapped feature, entrypoint, or defect class appears while tracing, report it in `uncovered` so the parent creates a canonical ledger unit for the next critic/wave rather than silently absorbing peer or out-of-scope work.

#### Core hunting method — include in every hunter prompt

```text
## Hidden-malfunction and regression hunting method

Your goal is to uncover real functional defects, silent malfunctions, contract drift,
and unintended regressions—and identify the smallest effective source fix and regression
test—not to report stylistic preferences or invent ungrounded speculations. Stay strictly
within read-only source review and bounded local execution. Do not probe live endpoints,
contact external APIs, or use real user data or credentials.

READ THE IMPLEMENTATION AT DEPTH. Trace each assigned entrypoint and option end-to-end
through argument/request parsing, defaults, config/feature-flag gating, validation,
domain logic, state/cache/DB mutations, async queues, output encoding, and cleanup/rollback.
Inspect sibling, legacy, batch, CLI/API/UI parallel paths, retry, cancellation, and
migration code paths for the same feature.

HUNT HIDDEN MALFUNCTIONS ACTIVELY:
1. Verify wiring: prove every accepted flag, config key, UI control, webhook field, or
   API parameter actually reaches and controls real execution rather than being ignored,
   shadowed, stubbed, or overridden by defaults.
2. Audit failure paths: inspect every catch/rescue/fallback/default branch—does failure
   return a fake success, swallow errors into logs, leave partial writes uncommitted, or
   corrupt cached/derived state?
3. Compare layer boundaries: check what the caller/UI/schema promises versus what the
   handler/service/DB/client actually expects (types, nullability, units, timezones,
   pagination, ordering, case sensitivity, encoding, lifecycle timing).
4. Distrust green tests until inspected: read existing tests for the assigned path. Check
   whether mocks/stubs bypass the broken integration, whether assertions only test status
   or non-null without checking state/output, whether service mocks encode outdated external
   API schemas, or whether tests assert buggy behavior.
5. Check library and external service specifications: verify high-risk calls against actual
   installed library types/source (lockfile/node_modules/vendor) and retrieved official
   documentation/changelogs/sunset notices (never relying on unverified memory) to expose
   silently ignored SDK options, retired endpoints/model IDs, and upstream response drift.

WORK FROM A CONCRETE INVARIANT:
1. Name the feature, caller perspective, and advertised or inferred behavioral contract.
2. Name the exact input, sequence, config state, or revision change (`base_ref` -> `head_ref`).
3. Trace the exact repository-relative `entrypoint` -> `propagation` -> `sink` path.
4. Distinguish clearly between:
   - `confirmed_defect`: broken behavior in HEAD (new or pre-existing) established locally;
   - `confirmed_regression`: contract worked at comparable `base_ref` and fails at `head_ref`;
   - `confirmed_change`: real BASE->HEAD behavior change (`intended` only with explicit evidence,
     otherwise `unknown`);
   - `needs_validation`: source-grounded lead blocked by missing sandbox, external state,
     unavailable BASE comparability, or contradictory owner intent.

DEPTH BOUND AND VARIANT SWEEP: Trace only paths reachable from your assigned feature/units or
whose guarantees your assigned units depend on. Stop a line of inquiry once its invariant is
settled and record a `covered`, `candidate`, or `blocked` unit disposition (or `uncovered` lead).
When a high/critical defect reveals a reusable pattern (e.g., an unwired option pattern or
silent catch helper), check sibling paths inside your assigned units independently and report
out-of-unit sightings in `uncovered`.

USE BOTH REAL TEST-ENVIRONMENT CHECKS AND SCRATCH VIRTUAL TESTS. Target-controlled builds,
tests, CLI calls, local fixtures, or isolated loopback processes may run ONLY inside the
parent-approved OS-enforced sandbox: disabled external network (isolated loopback only when
needed), empty allowlisted env, read-only target and tools, scratch-only writes, and explicit
low CPU/memory/process/file-size/disk/time limits. Never write virtual tests into the target
repository; put all temporary harnesses, fixtures, and disposable BASE/HEAD copies inside
your `scratch/` directory. Choose the strongest safe test level:
- `existing_test`: run existing repository tests ONLY after auditing assertions and mocks.
- `real_env_test`: run the real assembled app/service/built CLI/packaged consumer against
  ephemeral scratch DBs, files, or isolated loopback with zero internal mocking.
- `virtual_test`: author targeted disposable harnesses in `scratch/` when existing tests are
  missing or mock-blind:
  (a) A/B differential option probes (toggle flags/config/fields and assert real behavioral change);
  (b) boundary-only fault injection (local HTTP 500/429/malformed/disconnect, read-only/full dir,
      step-2-of-3 write failure) while keeping ALL internal modules real;
  (c) edge/boundary/round-trip matrices (empty, 0, "", false, Unicode, CRLF, page boundaries,
      serialize/deserialize & import/export round-trips, sibling-path parity);
  (d) deterministic concurrency/ordering/abort harnesses (deferred barriers so slow request #1
      finishes after request #2, parallel bursts, AbortController/SIGTERM cleanup);
  (e) cold-start, restart, prior-version upgrade/migration, and rollback fixtures;
  (f) packaged/built-artifact consumer runs (dist/, bin, piped stdin, --json stdout purity);
  (g) deterministic fake external protocol/LLM/MCP response streams;
  (h) latest library & external-service spec conformance harnesses (unmocked installed-library
      calls, outbound-request capture diffed against retrieved official specs, and replay of
      officially documented current response/webhook/error schemas).
- `base_head_differential`: run identical real or virtual harnesses against disposable
  `scratch/base/` and `scratch/head/` checkouts under verified comparable env/deps/fixtures.

OBEY MOCK-BOUNDARY AND ANTI-TAUTOLOGY DISCIPLINE: Virtualize ONLY true external boundaries
(third-party HTTP APIs, clock/RNG, disk/socket fault injection) and list every one explicitly
in `virtualized_boundaries` (use `[]` when fully real). NEVER mock internal target parsers,
routers, middleware, domain logic, or storage adapters under review, and NEVER test a copied
re-implementation instead of the real target code. If comparability cannot be established or
sandbox controls are absent, record the exact blocker under `needs_validation` with a safe
owner-run `local`/`environment` test recipe rather than guessing.

Record exact commands, inputs, sandbox limits, SHA/worktree state, `test_kind`, real
components exercised, `virtualized_boundaries`, and only allowlisted non-secret env var
names/values. Target code writes only inside `scratch/`. Only trusted parent-side code promotes
predeclared scratch-relative files into `artifacts/` using the promotion procedure below.
Never link scratch files directly. If execution controls or promotion fail for a decisive fact,
retain `needs_validation` with the exact blocker.
```

#### Promotion procedure — copy this promotion procedure verbatim into every hunter prompt

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

#### Core candidate gate — include in every hunter prompt

```text
## Candidate gate

1. Every candidate needs a complete repository-relative `trace` and `evidence` establishing
   the claimed root cause, affected feature/contract, and whether any fallback/guard saves it.
2. A proposed `confirmed_defect` needs a bounded local HEAD observation proving the contract
   violation or silent malfunction, plus a smallest fix and regression test.
3. A proposed `confirmed_regression` requires `base_ref !== null`, an established supported
   contract, like-for-like BASE-pass and HEAD-fail local evidence, and `intent_classification: "unintended"`.
4. A proposed `confirmed_change` requires `base_ref !== null` and like-for-like BASE vs HEAD
   local observations; classify `intended` only with explicit release/spec/PR evidence, else `unknown`.
5. If runtime verification, BASE comparability, environment state, or owner intent cannot be
   established locally, emit `needs_validation` with exact `blockers` and `validation_plan`,
   and NO severity or remediation.
6. Non-bug code smells, unused internal helpers unreachable from any public feature, or minor
   polish notes belong in `quality_notes`, never as confirmed defects. A candidate disproved
   by source belongs out of `candidates` (record the unit `covered` with supporting check).
7. Use a stable source-derived `fingerprint` matching `^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$` with
   no line numbers, wave numbers, agent IDs, verdicts, or severities.
8. Return an empty `candidates` array when no candidate survives these gates.
```

## Local validation boundaries

Local execution settles functional claims safely:
- **Allowed only inside the verified OS sandbox**: offline builds using local dependencies; unit/integration harnesses without mocking out the suspect code; CLI invocations in isolated scratch dirs; local loopback client/server tests with dummy state; database/migration runs against ephemeral scratch files or local test containers inside sandbox; local browser/headless rendering on dummy origins; deterministic concurrency interleavings; dry-run/rendered config checks.
- **Disallowed**: network fetches or package installs; live or production API/DB traffic; real user data or credentials; stress/load generation against shared hosts; modifying target source; leaving unpromoted files outside `scratch/`.

## Structured hunter result

Return exactly one JSON object, with no surrounding prose:

```json
{
  "units": [
    {
      "coverage_id": "one assigned ID",
      "disposition": "covered|candidate|blocked",
      "reviewed_paths": ["repo/relative/path"],
      "checks": [
        {
          "agent_id": "canonical owner of this check",
          "reviewed_paths": ["repo/relative/path owned by this check"],
          "invariant": "specific functional contract or defect hypothesis checked",
          "revision": "head|base|base_and_head|context",
          "method": "source|local",
          "test_kind": "source_trace|existing_test|real_env_test|virtual_test|base_head_differential",
          "virtualized_boundaries": [],
          "outcome": "pass|fail|inconclusive|blocked",
          "result": "what source inspection or bounded execution observed",
          "artifact": "agents/<agent-id>/artifacts/file for local, null for source"
        }
      ],
      "candidate_fingerprints": [],
      "unresolved": []
    }
  ],
  "candidates": [],
  "quality_notes": ["concrete non-defect maintainability or test-hygiene note"],
  "uncovered": [
    {
      "feature_id": "existing or proposed feature ID",
      "surface": "...",
      "subsystem": "...",
      "defect_class": "DEFECT-CLASSES.md#...",
      "axes": ["error"],
      "starting_paths": ["repo/relative/path"],
      "reason": "why this requires its own deterministic coverage unit"
    }
  ]
}
```

Each `candidates` entry uses the exact schema shape of its target verdict branch in `report-schema.json`, replacing `verdict` with `proposed_verdict` (`confirmed_defect | confirmed_regression | confirmed_change | needs_validation`).

Unit disposition rules:
- Every assigned `coverage_id` appears exactly once in `units`.
- `covered`: nonempty `reviewed_paths` and `checks`, zero `checks` with `outcome: "fail"`, empty `candidate_fingerprints`, empty `unresolved`.
- `candidate`: nonempty `reviewed_paths` and `checks`, nonempty `candidate_fingerprints`.
- `blocked`: nonempty `reviewed_paths`, `checks`, and `unresolved`, empty `candidate_fingerprints`.
- Every check records its own canonical `agent_id`, nonempty `reviewed_paths` (whose union across `checks` equals the unit's `reviewed_paths`), `test_kind` (`source_trace` when `method: "source"`; one of `existing_test | real_env_test | virtual_test | base_head_differential` when `method: "local"`), `virtualized_boundaries` (`[]` for `source` or zero-mock real checks; explicit external boundary names for virtualized checks), `artifact: null` when `method: "source"`, and a parent-promoted artifact under `agents/<check.agent_id>/artifacts/` when `method: "local"`.

## Parent consolidation and ledger update

The parent validates every hunter unit against its assignment: reject missing/duplicate IDs, unsafe agent IDs or paths, `covered` units containing `outcome: "fail"` checks, source checks carrying artifacts, or local artifacts not promoted by trusted parent code. Update each valid unit in `coverage-ledger.json`, retain `quality_notes` in a parent bookkeeping field outside semantic unit fields, and leave failed/malformed units `planned` for reassignment. Untouched units dropped for budget/profile become unassigned `deferred` with empty evidence and an exact reason. Run `validate-coverage-ledger.cjs` immediately.

Consolidate `candidates` by `fingerprint` and then by root cause. One root cause affecting multiple entrypoints is one candidate with the strongest trace; independent defects keep separate fingerprints.

## Coverage-critic waves

Immediately after each hunter wave, spend the reserved invocation on a fresh `research` post-wave coverage critic. Provide `system-map.md`, `feature-catalog.json`, full `coverage-ledger.json` (including assignment block maps and check outcomes), candidate fingerprints/states, and prior-run gaps. It reads source only and returns exactly one JSON object:

```json
{
  "missing_units": [
    {
      "feature_id": "...",
      "surface": "...",
      "subsystem": "...",
      "defect_class": "DEFECT-CLASSES.md#...",
      "axes": ["error", "lifecycle"],
      "starting_paths": ["repo/relative/path"],
      "ordinary_defect_class_block": "DEFECT-CLASSES.md#...",
      "selected_companion_blocks": ["FILE.md#section"],
      "excluded_blocks": [{"block": "FILE.md#section", "reason": "..."}],
      "reason": "source-backed coverage gap"
    }
  ],
  "reassign_ids": ["existing-coverage-id-needing-recheck"],
  "resolved_prior_leads": ["fingerprint"],
  "stop": false
}
```

The coverage critic specifically hunts:
- Unmapped entrypoints, CLI flags, config keys, UI actions, or background jobs absent from `feature-catalog.json`/`coverage-ledger.json`;
- In-scope user features missing any of the 6 release axes (`primary`, `boundary`, `error`, `integration`, `compatibility`, `lifecycle`);
- Units marked `covered` solely via `source_trace` or mock-heavy `existing_test` when a bounded `real_env_test` or `virtual_test` (such as an unwired-option probe, fault-injection harness, built-artifact run, or async race test) was safely executable inside the sandbox;
- Units whose `virtualized_boundaries` improperly mocked internal target modules under audit instead of external boundaries;
- Unchecked pinned/installed library APIs, dependency bumps between BASE and HEAD, or hardcoded external service endpoints, API version headers, and model IDs missing specification verification;
- Unjustified exclusions in `excluded_blocks` or missing companion domain coverage;
- Prior `needs_validation` or `base_ref`→`head_ref` changed paths left uncovered.

Parent handling of critic output:
- Reject out-of-scope or ungrounded proposals; derive canonical RFC 3986 IDs for accepted `missing_units` and deduplicate cleanly (fail on canonical identity collision).
- For each legitimate `reassign_id` in `covered`, `candidate`, or `blocked`, append its exact live record into `attempts` with `reassignment_reason`, increment `wave`, assign a fresh owner on next assignment, and clear live evidence (never copy archived checks or artifacts into live state).
- In `standard` and `deep`: when the post-wave critic produces no accepted work and no `planned` units remain, run the separately reserved distinct **final-clean critic**. Complete coverage only when the final-clean critic also finds zero accepted gaps; otherwise queue the new work and repeat.
- In `quick`: accept only wave 1 + 1 final critic pass; add accepted `missing_units` as `deferred` (`quick_profile_final_critic`) and archive/reassign `reassign_ids` into live `deferred` (`quick_profile_final_critic`) without launching wave 2.
- If budget prevents another wave before mandatory reserves, mark remaining planned/proposed units `deferred` with `budget_cannot_reserve_critics_and_validation` and validate `coverage-ledger.json`.
