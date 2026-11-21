# State and Persistence Malfunction Hunting

#### When to use this file

Reach for this file when the target persists state to SQL/NoSQL databases, embedded stores, caches, search indexes, queues, or local files/blobs, or defines schema migrations, backups, exports, or soft-deletes. Use alongside `DEFECT-CLASSES.md` and `ASYNC-JOBS-AND-INTEGRATIONS.md`.

## Core discipline (include in every agent prompt for this domain)

```text
- Trace every write to ALL derived copies (primary tables, secondary indexes, caches,
  search indexes, counters, blobs, audit logs) and trace every failure mid-way through.
- Verify transaction boundaries carefully: opening a transaction without passing `tx` to
  every downstream repository/helper silently runs queries outside the transaction.
- Inspect migrations against realistic non-empty production-like rows, NULLs, duplicates,
  downgrades, and interrupted re-runs—never only against fresh empty schemas.
- Use `confirmed_defect` / `confirmed_regression` only with bounded local store/fixture
  evidence; use `needs_validation` when managed DB engine versions, external cache settings,
  or production data shapes are unobservable locally.
```

## Persistence and consistency defect classes (subagent_type: `general`)

**Partial writes, missing transactions, and broken rollback**
Multi-step operations commit part of a logical mutation (e.g., DB row created while file write/child row/external state fails, or `tx` handle ignored by helper) leaving orphaned or half-initialized state without compensating cleanup.

**Concurrent write races, lost updates, and deadlock bugs**
Non-atomic read-modify-write sequences overwrite concurrent edits, counter updates drift under parallelism, missing `SELECT FOR UPDATE`/optimistic version checks permit double consumption, or inconsistent table lock ordering deadlocks concurrent workflows.

**Cache invalidation, stale read, and key-collision defects**
Updates, deletes, bulk operations, or TTL/serialization changes omit cache invalidation; cache keys omit crucial dimensions (locale, flags, pagination params, filters, schema version); stale cached negatives mask newly created data.

## Query, migration, and storage defect classes (subagent_type: `general`)

**Query semantics, NULL, join-multiplication, and collation/timezone bugs**
`NOT IN` with `NULL`, outer-join row multiplication inflating counts/sums, implicit type coercion, case/Unicode collation mismatches, `OFFSET/LIMIT` drift without deterministic tie-breakers, or timezone-naive timestamps distort query results.

**Schema migration, backfill, dual-read/write, and rollback breakage**
Migrations fail on non-empty tables, lock/drop columns still read by rolling-deploy old code, backfill scripts omit idempotency or resume state, or down-migrations destroy data or fail to reverse constraints.

**Soft-delete, cascade, tombstone, and unique-constraint conflicts**
Queries forget `deleted_at IS NULL` (leaking or mutating deleted items), cascades orphan child records, or unique constraints block re-creating a soft-deleted name/key.

**File and blob atomicity, encoding, path, and partial-write corruption**
Writing directly to target files instead of temp-file + flush + atomic rename leaves truncated/corrupt files on crash; path/filename sanitization strips valid characters or collides; missing file-locking corrupts concurrent local writes.

## Universal moves (apply across the above)

- Trace one entity across create → read → update → bulk-update → export → soft-delete → restore → hard-delete, checking primary store, cache, search, and disk files at each step.
- Inject a simulated failure at step `k` of every multi-step write to observe what survives uncommitted/uncleaned.
- Run forward + down migrations against dummy seed fixtures containing NULLs, edge strings, and existing relationships.
- Prefer a `real_env_test` against an ephemeral scratch DB/file store with real ORM/SQL queries over mocked repository tests, and write `virtual_test` harnesses for step-2-of-3 write fault injection, concurrent parallel updates to the same row/key, and vN-1→HEAD upgrade/rollback checks (see [TESTING-AND-HARNESSES.md](TESTING-AND-HARNESSES.md)).

## Validation rules (apply before reporting ANY finding here)

1. Identify the persistence boundary, exact read/write paths, violated atomicity/invariant, and concrete resulting corruption, stale read, or failure.
2. Confirm ORM hooks, database constraints, or middleware retries do not prevent the inconsistency.
3. Reproduce locally against ephemeral scratch DBs/files or deterministic mock fault injection without touching shared stores.
4. Keep engine-specific runtime behavior or hosted storage constraints as `needs_validation` when not reproducible locally.
