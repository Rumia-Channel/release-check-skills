# Async Jobs and Integrations Malfunction Hunting

#### When to use this file

Reach for this file when the target uses background job queues, workers, scheduled/cron tasks, event buses, internal/external webhooks, or integrations with third-party HTTP/API services. Use alongside `DEFECT-CLASSES.md` and `STATE-AND-PERSISTENCE.md`.

## Core discipline (include in every agent prompt for this domain)

```text
- Assume networks flake, jobs deliver at-least-once, events arrive out of order, workers
  crash mid-task, and third-party APIs return partial pages, 429s, or malformed payloads.
- Trace BOTH directions: producer enqueueing/publishing (including inside uncommitted DB
  transactions!) and consumer execution, ack/nack, retry, DLQ, and shutdown cleanup.
- Check timeout, rate-limit, retry-backoff, pagination, and error-classification logic for
  every external integration; never assume a mocked happy-path HTTP 200 proves resilience.
- Never hit live third-party services during verification; reproduce using local stub
  servers/transports inside the sandbox or mark external provider behavior `needs_validation`.
```

## Queue, ordering, and scheduler defect classes (subagent_type: `general`)

**Duplicate delivery and non-idempotent job consumers**
At-least-once broker delivery or job retries re-run side effects (emails, billing, inserts, counter increments) because deduplication is missing, runs after side effects, or fails to survive worker crashes.

**Out-of-order, stale-event, and late-arrival state corruption**
Delayed messages or stale webhooks overwrite newer state because handlers apply payloads blindly without sequence numbers, version checks, or `updated_at` comparisons, or jobs read stale snapshots after enqueue-before-commit races.

**Acknowledgment and commit ordering or zombie-job bugs**
Workers ack messages before durable DB commit (losing jobs on crash), fail to renew visibility/lease locks during long tasks (causing concurrent duplicate workers), or crash leaving jobs permanently stuck in `running` state.

**Poison-message, dead-letter, and unbounded retry-loop bugs**
Permanent validation/serialization errors are treated as transient retries—blocking partitions or burning retries endlessly without dead-letter quarantine—or DLQ replay tools fail due to altered payload schemas.

**Scheduler, cron, timezone/DST, and overlapping-execution bugs**
Multiple replicas fire duplicate cron jobs without distributed lock/fencing; long-running jobs overlap next tick; DST shifts or UTC/local mix-ups skip or double-run scheduled jobs.

## Third-party integration and shutdown defect classes (subagent_type: `general`)

**Third-party integration timeout, pagination, rate-limit, and contract-drift bugs**
Outbound HTTP/SDK clients lack connection/read timeouts (hanging workers forever), stop after page 1 of paginated responses, misclassify 429 `Retry-After` or 4xx vs 5xx errors, or crash/silently drop data when optional fields are null/missing.

**Graceful shutdown, cancellation propagation, and orphaned background work**
`SIGTERM`/shutdown exits immediately before flushing in-flight jobs, leaves parent DB connections closed while worker goroutines/tasks keep running, or drops cancellation tokens so aborted requests continue mutating state.

## Universal moves (apply across the above)

- Check enqueue sites: is the job published *before* the DB transaction commits? Can the worker pick it up and fail to find the row?
- Audit every outbound HTTP/RPC client wrapper for explicit timeouts, retries (only on idempotent operations), pagination completeness, and error mapping.
- Trace worker shutdown (`SIGINT`/`SIGTERM`) and exception paths end-to-end.
- Build `virtual_test` harnesses in `scratch/` (see [TESTING-AND-HARNESSES.md](TESTING-AND-HARNESSES.md)) with a local loopback stub server simulating 429 `Retry-After`, 500, partial pages, slow hangs, and out-of-order/duplicate job deliveries into the real worker consumer, plus a `real_env_test` sending `SIGTERM` mid-job to verify graceful drain and zero duplicate side effects.

## Validation rules (apply before reporting ANY finding here)

1. Name the queue/cron/integration surface, failure or concurrency condition, broken invariant, and concrete lost/duplicated/corrupted work.
2. Verify broker/framework semantics and retry classifiers in source before claiming lost or duplicated execution.
3. Reproduce using bounded local in-memory queues, local loopback fake third-party servers, or deterministic shutdown harnesses inside the sandbox.
4. Retain `needs_validation` when managed broker settings, cron infrastructure, or live third-party API responses cannot be verified locally.
