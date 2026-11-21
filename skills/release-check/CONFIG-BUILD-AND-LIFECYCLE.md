# Configuration, Build, and Lifecycle Malfunction Hunting

#### When to use this file

Reach for this file when the target relies on layered configuration, environment variables, feature flags, complex startup/bootstrap sequences, schema/app upgrade paths, health/readiness probes, or container/build/deployment manifests. Use alongside `DEFECT-CLASSES.md` and `STATE-AND-PERSISTENCE.md`.

## Core discipline (include in every agent prompt for this domain)

```text
- Trace configuration end-to-end: schema/default -> file -> env var -> CLI flag -> feature
  flag -> final consumer. Check type coercion ("false", "0", ""), missing keys, and precedence.
- Inspect lifecycle transitions: first-boot on empty state, normal restart, hot-reload,
  rolling upgrade (old + new running together), downgrade/rollback, and graceful shutdown.
- Distinguish in-repo configuration/code bugs (locally verifiable) from deployed runtime
  secrets, hosted overlays, or live orchestrator state (`needs_validation`).
- Never claim an environment is broken from an example `.env.example` or inactive dev
  override alone; establish which file/path actually drives active builds or runtime.
```

## Configuration and feature-flag defect classes (subagent_type: `general`)

**Config precedence, default-override, key-typo, and silent-fallback bugs**
Environment variables, config keys, or defaults conflict across loaders, use mismatched key names/casing, coerce `"false"`/`"0"` as truthy, silently fall back to development defaults on malformed config instead of failing fast, or apply overrides inconsistently across subsystems.

**Feature-flag half-implementation, flag-interaction, and inverted-default bugs**
A feature flag toggles the UI or route on while backend jobs/migrations stay off (or vice versa), two interacting flags break each other, toggling a flag dynamically leaves stale caches/listeners, or release defaults flip an experimental flag accidentally.

## Startup, upgrade, observability, and build defect classes (subagent_type: `general`)

**Bootstrap ordering, circular dependency, and fail-open startup bugs**
Modules read config, DB pools, or singletons before async initialization finishes, circular imports yield `undefined` at runtime, or startup continues in a degraded half-broken mode after essential resource initialization fails.

**Fresh-install, upgrade, downgrade, and hot-reload state divergence**
Fresh installs succeed only via dev seed scripts; upgrading from an earlier config/data version fails or drops settings; downgrading corrupts state; `SIGHUP`/hot-reload leaks old timers/connections or fails to update active workers.

**Health, readiness, and observability misreporting**
`/healthz`/`/readyz` probes report `200 OK` before migrations/dependencies are ready or keep reporting healthy while worker queues are deadlocked, or metrics/logs silently fail or drop correlation context on failure paths.

**Build, container, manifest, and environment-overlay drift**
Dockerfiles, compose files, Helm/K8s manifests, or build scripts copy wrong artifact paths, run mismatched runtime versions/ports/entrypoints, drop required binaries/CA certs/runtime tools in multi-stage images, or diverge silently across dev/staging/prod overlays.

## Universal moves (apply across the above)

- Build a matrix of every documented config key/env var vs actual code reference, type parser, default value, and validation error behavior.
- Render or inspect multi-stage Dockerfiles, manifests, and build outputs to verify the final entrypoint, copied files, ports, and healthcheck command actually exist and match code.
- Trace startup with missing required config, malformed config, and simulated pre-upgrade persisted state.
- Run a `real_env_test` cold start in a completely empty scratch directory with minimal allowlisted env vars (no dev `.env` files or seed scripts), plus `virtual_test` harnesses toggling flag combinations, passing `"false"`/`"0"`/malformed values, and exercising health probes while dependencies are stopped (see [TESTING-AND-HARNESSES.md](TESTING-AND-HARNESSES.md)).

## Validation rules (apply before reporting ANY finding here)

1. Identify the active config/build/lifecycle file, violated startup/config/deployment invariant, and concrete runtime failure or silent misconfiguration.
2. Confirm no wrapper entrypoint, entrypoint script, or overlay overrides the broken value before execution.
3. Reproduce locally via bounded config parsing tests, template rendering, or isolated scratch startup checks without touching live clusters.
4. Classify missing live environment variables, hosted overlays, or cluster runtime behavior as `needs_validation`.
