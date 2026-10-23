# release-check-skills

A repository-oriented agent skill for **feature-intent reconstruction, behavioral verification, and regression audits**. It is inspired by the coverage-led, independently verified workflow in [Cloudflare security-audit-skill](https://github.com/cloudflare/security-audit-skill), but is designed for release correctness rather than vulnerability hunting.

## What it answers

- **What exists?** Enumerate externally meaningful features, entrypoints, invariants, and dependencies.
- **Why does it exist?** Reconstruct intended behavior from specifications, tests, history, and source; distinguish documented intent from inference or unknown intent.
- **Does it work?** Verify positive, boundary, error, integration, compatibility, and lifecycle behaviors with evidence, not assumptions.
- **What broke?** Compare an explicit baseline against a target revision; separate proven regressions, observable behavior changes, unresolved leads, and disproven leads.
- **What is not checked?** Publish a coverage ledger and exact blockers, exclusions, and execution constraints.

The skill **does not automatically change project files, run untrusted code, publish releases, or claim that a passing test suite proves absence of regression**.

## Installation

For agents supporting the Skills CLI:

```sh
npx skills add https://github.com/Rumia-Channel/release-check-skills --skill release-check
```

Or copy `skills/release-check/` into the skill directory supported by your agent.

## Example requests

- "Map the features in this repository and explain each feature's intended behavior."
- "Check whether this codebase's features work, and show the unverified areas."
- "Audit regressions from release v1.2.0 to HEAD; produce a coverage ledger and release report."
- "Check whether this PR breaks existing functionality without changing source files."

A plain question invokes **guidance mode**, with no artifacts or broad execution by default. An explicit comprehensive release/regression audit invokes **full mode**.

## Full-audit output

The parent agent writes into a separate output directory, by default `~/release-check-skills/<repo>/run-<N>/`:

| Artifact | Purpose |
| --- | --- |
| `audit.json` | Machine-readable run metadata, feature catalog, coverage ledger, verified findings |
| `REPORT.md` | Release decision support, feature purpose, evidence, failures, and gaps |
| `EVIDENCE/` | Optional narrowly scoped, non-secret, trusted-promoted test evidence |

The skill provides the zero-dependency Node validator:

```sh
node skills/release-check/scripts/validate-audit.cjs /path/to/audit.json
node --test skills/release-check/scripts/validate-audit.test.cjs
```

The validator checks shape and cross-references, not the truth of empirical claims. Always review the evidence.

## Requirements / safety

- A code-capable agent able to read the target repository and (for a full audit) retain structured output.
- Node.js 18 or newer for the bundled validator and tests.
- **An OS-enforced sandbox** before running repository-controlled build scripts, tests, binaries, fixtures, or package hooks: no external network, allowlisted environment, read-only target (or disposable copy), scratch-only writes, and resource/time limits.
- A baseline revision is required to **confirm** a regression. Without one, the skill can map intent and check current behavior but must mark historical comparisons unavailable.
- Parallel delegated agents are recommended for independent verification; where unavailable, record the verification gap rather than asserting independence.

No network access is necessary for the validator; it has no third-party dependencies.

## Limits of the claim

A "complete" audit means **all cataloged, in-scope features have all required coverage axes accounted for and verified**, not that every possible feature or fault has been discovered. Unobserved runtime, unknown business intent, unenumerated interfaces, and unsupported platforms remain uncertainties. A release recommendation remains a decision for the project owner.

License: BSD-2-Clause (see [LICENSE](LICENSE)).

