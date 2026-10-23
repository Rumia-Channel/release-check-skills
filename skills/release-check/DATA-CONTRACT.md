# audit.json v1 — machine-readable contract

The full audit uses one canonical JSON file. The bundled `scripts/validate-audit.cjs` validates required fields, unique IDs, cross-links, coverage obligations, state consistency, evidence revision checks, and confirmation gates. JSON validation alone does **not** prove behavioral correctness.

Example shape (illustrative only; this is **incomplete** and is not an all-axes completed audit):

```json
{
  "schema_version": 1,
  "run": {
    "target": "owner/repo",
    "base_ref": "BASE_COMMIT_SHA_OR_NULL",
    "head_ref": "HEAD_COMMIT_SHA",
    "profile": "standard",
    "scope": ["package or service"],
    "status": "incomplete",
    "execution": "sandboxed_tested",
    "limitations": ["Two platforms not tested"]
  },
  "features": [
    {
      "id": "cli-export",
      "name": "CLI export",
      "purpose": "Export records as JSON",
      "intent_status": "documented",
      "intent_evidence": [{"ref": "docs/cli.md", "detail": "Defines export"}],
      "entrypoints": ["bin/export"],
      "contracts": ["Valid input produces a JSON document"],
      "status": "in_scope",
      "exclusion_reason": null
    }
  ],
  "coverage": [
    {
      "id": "cli-export::primary::json",
      "feature_id": "cli-export",
      "axis": "primary",
      "case_id": "json",
      "status": "covered",
      "base_result": "pass",
      "head_result": "pass",
      "evidence": [
        {"revision": "base", "kind": "test", "ref": "local:fixtures/export-base", "observation": "Assertion passed"},
        {"revision": "head", "kind": "test", "ref": "local:fixtures/export-head", "observation": "Assertion passed"}
      ],
      "reason": null
    }
  ],
  "findings": []
}
```

## Conventions

- Refs in evidence are repository-relative paths or well-identified sanitized local artifacts, never credentials or host-secret paths. Evidence includes revision (`base`, `head`, or `context`) and method (`source`, `test`, `runtime`).
- Every `in_scope` feature has at least one coverage case for each of six axes: `primary`, `boundary`, `error`, `integration`, `compatibility`, `lifecycle`. `not_applicable` must provide a precise reason.
- `coverage.id` is exactly `feature_id::axis::case_id`; case IDs are stable ASCII identifiers. Multiple cases within an axis are encouraged.
- For coverage `covered`, HEAD must pass based on actual test/runtime evidence. For `failed`, HEAD must fail based on actual test/runtime evidence. Only executed checks produce pass/fail. A `blocked`/`deferred`/`out_of_scope`/`not_applicable` case requires a nonempty reason and no reported executed HEAD result.
- `base_ref: null` forbids BASE pass/fail and `confirmed_regression`/`confirmed_change`. The environment and version comparability must additionally be checked by the agent; a validator cannot infer it.
- Finding verdicts are `confirmed_regression`, `confirmed_change`, `needs_validation`, and `rejected`; each links to cataloged features and coverage cases.
- A confirmed finding requires evidence, a discoverer, a distinct independent verifier, and no blockers. Regression additionally requires a linked coverage case where BASE passes and HEAD fails with matching observed checks; `impact` and `severity` are required only for regression.
- `confirmed_change` must not automatically imply acceptance; intention is `intended` only when corroborated, otherwise `unknown`.
- An unresolved finding must have an explicit `blockers` array and no severity; a rejected finding gives a specific rejection reason in `blockers` or `explanation`.
- Completed runs may contain `not_applicable` cases with reasons; they cannot contain unresolved or failed units, or needs-validation findings. Even then, completeness is only relative to the audited catalog.
- Add explanatory prose to `run.limitations`; when incomplete, it must not be empty.

Finding form:

```json
{
  "id": "export-regression",
  "feature_id": "cli-export",
  "coverage_ids": ["cli-export::primary::json"],
  "verdict": "confirmed_regression",
  "title": "Export rejects valid input",
  "expected": "BASE and public contract accept input",
  "observed": "HEAD rejects the same input",
  "intent_classification": "unintended",
  "impact": "Supported callers cannot export data",
  "severity": "high",
  "evidence": [
    {"revision":"base","kind":"test","ref":"local:base-case","observation":"Pass"},
    {"revision":"head","kind":"test","ref":"local:head-case","observation":"Fail"}
  ],
  "blockers": [],
  "discovery_agent": "hunter-1",
  "verifier_agent": "verifier-1"
}
```

Use `intent_classification: unknown`, `impact: null`, `severity: null`, and `verifier_agent: null` when a lead cannot be established. Keep every evidence item non-secret and reproducible.

