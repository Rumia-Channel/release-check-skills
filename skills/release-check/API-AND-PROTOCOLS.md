# API and Protocols Malfunction Hunting

#### When to use this file

Reach for this file when the target exposes or consumes HTTP/REST, GraphQL, gRPC, WebSockets, webhooks, RPC, or custom wire protocols. Use alongside `DEFECT-CLASSES.md` and `STATE-AND-PERSISTENCE.md`.

## Core discipline (include in every agent prompt for this domain)

```text
- Compare documented/generated API contracts (OpenAPI, Protobuf, GraphQL SDL, SDK types,
  README examples) line-by-line against handler parsing, serialization, status codes, and
  error payloads.
- Trace request inputs through middleware, body parsers, DTO validation, domain handlers,
  response serializers, and error formatters—including legacy/alias routes.
- Check empty sets, partial updates (`PATCH` vs `PUT`), null vs omitted fields, extra
  fields, pagination boundaries, timeouts, and disconnects.
- Use `confirmed_defect` / `confirmed_regression` / `confirmed_change` with bounded local
  request/response tests; use `needs_validation` when upstream API gateway, proxy, or live
  external peer behavior is outside repository visibility.
```

## Schema, serialization, and contract defect classes (subagent_type: `general`)

**Request and response schema or serialization drift**
Handlers accept or emit field names, types, enum cases, timestamp formats, numeric precision (64-bit ints in JSON), or nullability rules that contradict OpenAPI/Protobuf/GraphQL/SDK definitions or break documented clients.

**Pagination, cursor, filter, sort, and total-count inconsistencies**
Page boundaries skip or duplicate records when items shift or share sort keys; opaque cursors fail on edge filters; `has_more`/`total` disagrees with returned items; empty/limit=0/over-max page sizes error or dump unbounded rows.

**Status code, error contract, and content-negotiation defects**
Handlers return `200 OK` on validation/business failures, emit HTML/stack traces when callers expect structured JSON error envelopes, mishandle `Accept`/`Content-Type`/charset headers, or drop machine-readable error codes.

## Transport, reliability, and lifecycle defect classes (subagent_type: `general`)

**Idempotency, retry, timeout, and partial-stream disconnect bugs**
Idempotency keys collide, ignore mismatched request payloads, or commit partial work before failing; upstream client timeouts leave downstream handlers mutating state; chunked/streaming/SSE/WebSocket disconnects corrupt partial state or leak handlers.

**Webhook delivery, ordering, replay, and callback handling defects**
Webhook emitters drop retries on transient 5xx, timeout synchronously on caller requests, or send out-of-order events without timestamps/sequences; webhook receivers double-process retries, fail to acknowledge within deadlines, or crash on unknown future event fields.

**API versioning, deprecation, alias, and middleware ordering mismatches**
New middleware (parsing, normalization, rate limit, auth, compression) alters or breaks older API versions, alias routes bypass normalization applied to canonical routes, or version negotiation silently routes to the wrong contract.

## Universal moves (apply across the above)

- Feed identical valid, edge, null/omitted, duplicate-key, and malformed payloads into schema validators and actual route handlers to detect silent coercions or contract mismatches.
- Walk every error/catch middleware path to verify structured error contracts hold across validation errors, domain failures, timeouts, and panics.
- Diff `base_ref` and `head_ref` OpenAPI/Protobuf/GraphQL schemas against handler code for undocumented breaking changes.
- Run a `real_env_test` against the real HTTP/RPC server bound to isolated loopback with full middleware stack enabled (not bare controller unit calls), plus `virtual_test` harnesses for cursor/pagination shifts during live inserts, duplicate idempotency keys with mutated bodies, and mid-stream client disconnects (see [TESTING-AND-HARNESSES.md](TESTING-AND-HARNESSES.md)).

## Validation rules (apply before reporting ANY finding here)

1. Name the route/RPC method, caller expectation + source contract, actual handler path, and divergent status/body/side effect.
2. Confirm middleware, framework serializers, or gateway adapters do not normalize the discrepancy away before response emission.
3. Reproduce with bounded local request/handler invocations against dummy fixtures (isolated loopback if network daemon).
4. Use `needs_validation` with exact blockers when API gateway routing, proxy buffering, or external consumer behavior cannot be observed locally.
