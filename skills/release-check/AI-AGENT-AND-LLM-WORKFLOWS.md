# AI Agent and LLM Workflow Malfunction Hunting

#### When to use this file

Reach for this file when the target implements LLM calls, prompt templates, structured-output parsing, RAG retrieval/indexing, agent tool-calling loops, persistent agent memory, or MCP clients/servers. Use alongside `DEFECT-CLASSES.md` and `ASYNC-JOBS-AND-INTEGRATIONS.md`.

## Core discipline (include in every agent prompt for this domain)

```text
- Treat model outputs, tool arguments, streaming tokens, and retrieval responses as unreliable
  data that can fail, truncate, drift in schema, or loop forever—test code handling of those
  failures without needing live paid LLM API calls.
- Trace prompt construction, tool-schema -> dispatcher -> handler wiring, token/context
  budgeting, fallback/retry logic, cancellation, and RAG index synchronization end-to-end.
- Check whether mock model responses in tests bypass real JSON parsing, tool-name routing,
  error recovery, or streaming chunk assembly.
- Never call live paid model endpoints during verification; use deterministic fake/mock
  provider streams inside the sandbox, and mark live model quality/behavior `needs_validation`.
```

## Prompt, output, and tool-wiring defect classes (subagent_type: `general`)

**Tool schema, dispatch, argument-coercion, and silent tool-failure bugs**
Tool JSON schemas advertised to the model diverge from handler parameter names/types/enums; dispatched tool errors are swallowed or serialized in a format the agent loop treats as success; optional arguments fail on `null` vs omitted; parallel tool calls collide on IDs or shared state.

**Prompt assembly, variable-interpolation, role-order, and truncation defects**
Prompt builders leave unresolved `{placeholders}`, drop critical context or history messages when naively truncating to token limits, violate provider role-alternation requirements, or silently miscount tokens/bytes across providers.

**Structured-output parsing, streaming JSON, and fallback/retry failures**
Parsers crash or fall back silently to empty objects on markdown-fenced JSON, partial streaming deltas, multi-line strings, or refusal responses; repair retries mutate or lose fields without re-validating schema invariants.

## Loop, RAG, and protocol defect classes (subagent_type: `general`)

**Agent loop termination, stuck-state, budget, and cancellation bugs**
Agent loops lack max-step/token/cost guards, enter infinite retry loops on repeated tool errors, leave background tool subprocesses running after user abort, or lose session/checkpoint state on crash/resume.

**Retrieval chunking, index synchronization, and empty-context fallback bugs**
Updates/deletes to source documents fail to re-index or purge stale embeddings/chunks; chunkers split mid-code-point or drop metadata; empty retrieval results crash prompt assembly or fabricate empty citations silently.

**MCP and model-provider protocol, capability, and configuration drift**
Provider adapters pass unsupported parameters across model versions, mishandle streaming SSE chunks/keepalives, or MCP client/server implementations disagree on capability negotiation, tool/resource URIs, transport framing, or stdio stderr pollution.

## Universal moves (apply across the above)

- Diff every registered tool schema directly against its runtime dispatcher and downstream handler signature.
- Replay deterministic fake model outputs—truncated JSON, markdown-wrapped JSON, unknown tool names, wrong argument types, tool error returns, and stream aborts—through the real runtime loop in the sandbox.
- Trace document create → update → delete → query through the RAG indexer and retriever.
- Build a `virtual_test` fake local loopback model/MCP server in `scratch/` (listing the provider endpoint in `virtualized_boundaries`) that drives edge token streams, tool-error loops, budget ceilings, and user aborts through the real unmocked prompt builder, JSON parser, and tool dispatcher (see [TESTING-AND-HARNESSES.md](TESTING-AND-HARNESSES.md)).

## Validation rules (apply before reporting ANY finding here)

1. Name the workflow/agent surface, deterministic failure mode (wiring mismatch, parser crash, infinite loop, stale index, protocol error), source trace, and observed malfunction.
2. Confirm provider SDKs or wrapper middleware do not repair or guard the broken path.
3. Reproduce locally using deterministic stubbed model responses and local fixtures inside the sandbox—never hit paid APIs.
4. Keep model-dependent stochastic behavior, live provider outages, or external MCP server drift as `needs_validation`.
