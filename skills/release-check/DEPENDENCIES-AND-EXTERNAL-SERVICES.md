# Dependencies and External Service Specification Hunting

#### When to use this file

Reach for this file when the target relies on third-party libraries, frameworks, SDKs, language runtimes, container base images, or external APIs and services (cloud providers, payment/auth/email/messaging SaaS, webhooks, databases, AI/LLM providers, or MCP servers). This domain uncovers hidden malfunctions caused by **misusing the pinned/installed library version**, **drifting behind breaking library/runtime releases**, or **calling deprecated, sunset, or schema-drifted external service APIs**—bugs that mocked unit tests routinely hide.

Use alongside `DEFECT-CLASSES.md`, `API-AND-PROTOCOLS.md`, `ASYNC-JOBS-AND-INTEGRATIONS.md`, `CLI-LIBRARY-AND-PACKAGING.md`, and `TESTING-AND-HARNESSES.md`.

## Core discipline (include in every agent prompt for this domain)

```text
- Never rely on training memory to declare what a library or external service's "latest"
  specification is. Ground every claim in either:
  (a) locally installed library source, `.d.ts`/type stubs, lockfiles, and manifests; OR
  (b) explicitly retrieved authoritative official documentation, changelogs, release notes,
      OpenAPI/JSON schemas, or sunset/deprecation notices (recording source and retrieval date).
- Separate TWO distinct questions:
  1. Pinned/installed mismatch: Does target code misuse the exact library/runtime version
     actually pinned or installed right now? (Directly testable locally in the sandbox.)
  2. Upstream/live service spec drift: Does target code call a deprecated/sunset endpoint,
     retired AI model ID, obsolete API-version header, or outdated response/webhook schema
     according to the external service's latest official specification?
- Target-controlled code NEVER accesses the network during testing, and the audit NEVER
  probes live external services or installs packages. Only read-only doc lookup by the parent
  or a `research` agent may consult official specs; if doc lookup is unavailable offline,
  mark external spec hypotheses `needs_validation` instead of guessing.
- Being behind the latest minor version with zero functional impact is a `quality_note`, NOT
  a `confirmed_defect`. Require concrete breakage, silent option ignore, retired/removed API,
  incompatible schema, or imminent sunset impacting supported callers.
```

## Library, framework, and runtime specification classes (subagent_type: `general`)

**Pinned vs installed library API misuse and silent option drift**
Target code passes renamed, removed, or misspelled option keys, wrong argument orders, obsolete middleware/hook signatures, or wrong error-type checks to an installed library—especially common after framework upgrades or when code was authored against outdated documentation. Check the actual installed library implementation/types (`node_modules`, `.venv`, vendor, lockfile version) and verify behavior locally without mocking the library.

**Floating version ranges and transitive breaking upgrades**
Manifests use unpinned or overly broad ranges (`*`, `latest`, `>=`, loose `^`/`~`, unpinned Docker `:latest` base images) without lockfile enforcement or compatibility tests, allowing a clean install or CI build to pull a newer release whose changed defaults, removed APIs, or strict validation break the product.

**Deprecated library APIs, runtime EOL, and removed primitives**
Code depends on language runtime features, standard-library flags, framework APIs, or container base images that are deprecated or already removed in current supported versions (e.g., removed Node.js/Python/Go/Rust APIs, deprecated TLS/crypto defaults, legacy framework routers/hooks) and fails on current supported runtime targets.

## External service, SaaS, and cloud API specification classes (subagent_type: `general`)

**Retired or deprecated external endpoints, model IDs, and API versions**
Source hardcodes sunset REST/GraphQL paths, retired or soon-to-be-retired LLM/AI model identifiers, obsolete provider API version headers (e.g., payment, cloud, VCS, messaging API versions), or removed OAuth scopes/grant flows that the external service no longer accepts or will reject under current official policy.

**Upstream response, webhook, and error-schema drift**
Target code or its mocked unit tests assume an older external response structure, pagination cursor format, webhook event/signature header, rate-limit header (`Retry-After` / reset format), or error envelope that contradicts the service's latest official documentation—causing crashes or silent data loss against live responses.

**SDK-to-service protocol, auth, and quota limit drift**
Target code constructs requests violating current provider constraints: deprecated authentication schemes, missing mandatory headers (`User-Agent`, API-version, idempotency, content-type), payload sizes/batch counts/timeouts exceeding current provider limits, or retry classifiers mistreating current provider status codes.

## Universal moves (apply across the above)

- Build a **Dependency & External Service Matrix** from manifests, lockfiles, Dockerfiles, and outbound clients: name, pinned version/range, installed version, API-version header or model ID, official latest/sunset status (with doc citation + retrieval date, or `unverified_offline`), and whether existing tests mock this boundary.
- Inspect the **real installed library source or type definitions** for every high-risk call site (auth, DB/ORM, HTTP client, serializer, parser, framework middleware, AI SDK) to catch options that are silently ignored or changed defaults.
- Run **Outbound-Contract & Latest-Spec Replay `virtual_test` harnesses** in `scratch/` (see [TESTING-AND-HARNESSES.md](TESTING-AND-HARNESSES.md)):
  1. Capture the exact HTTP request/headers/body/model ID emitted by the real target code to a local loopback server and diff it against the retrieved official latest service spec;
  2. Replay exact response, error, pagination, and webhook payloads from the external service's latest official docs into the real target parser/handler to expose schema-drift crashes or silent drops;
  3. Run an unmocked `real_env_test` / `virtual_test` invoking the real installed library (not a mock!) to verify actual library behavior.

## Validation rules (apply before reporting ANY finding here)

1. Cite the exact target code path (`trace` + `evidence`), exact pinned/installed version or hardcoded endpoint/model/header, and the authoritative specification reference (either installed package path or retrieved official doc/changelog with date).
2. Reject any claim based solely on unverified model memory without installed-package evidence or retrieved official documentation.
3. Classify **pinned/installed library breakage** reproduced locally (without mocking the library) as `confirmed_defect` (or `confirmed_regression` when a BASE→HEAD dependency bump or code edit broke a previously working BASE check).
4. Classify **external service spec drift** as `confirmed_defect` (`defect_category: "dependency_or_service_spec"`) only when (a) authoritative retrieved official documentation proves the endpoint, model ID, header, or schema is retired/removed/incompatible, AND (b) a bounded local `virtual_test` confirms the real target code either emits the incompatible request or fails/corrupts data when fed the officially documented current response/webhook payload.
5. Classify as `needs_validation` (no severity) when: official doc lookup was unavailable offline; behavior depends on an owner's account-pinned API version, plan tier, or feature opt-in; or live provider behavior cannot be confirmed without an owner-run staging/sandbox account check (`validation_plan.environment`).
6. Put non-breaking version lag or early deprecation notices with no current functional failure into `quality_notes`, never `confirmed_defect`.
