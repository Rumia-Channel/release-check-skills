# Phase 5–6: Structured validation, reporting, and quality gates

The parent owns `audit.json` and `REPORT.md`. Hunters and validators return structured proposals but may not overwrite shared artifacts.

## Before reporting

Read [DATA-CONTRACT.md](DATA-CONTRACT.md) and validate the output with:

```sh
node <skill-dir>/scripts/validate-audit.cjs <output-dir>/audit.json
```

Any validator failure stops an asserted complete result. The validator catches structural and cross-record faults, not factual errors. Verify factual evidence and line/revision references independently. Run it again after any material change to a finding or coverage unit.

Only designate `run.status: complete` if the selected scope and feature inventory were critiqued, all six required axes for every in-scope feature have accounted-for cases, none are `blocked`/`deferred`/`failed`, all confirmed verdicts were independently verified, and no unresolved `needs_validation` remains. This status is relative to the declared feature catalog and scope; do not assert impossibility of other faults. If coverage critic or final independent review did not run, disclose the limitation and mark `incomplete`.

## Report structure

1. **Executive release assessment:** `hold`, `conditional` or `candidate`; exact reviewed BASE/HEAD revisions, dirty-worktree state, scope, profile, sandbox/tool constraints, and remaining risk. Never imply authorization.
2. **Feature catalog:** each feature's purpose and confidence category (`documented`, `inferred`, `unknown`), intent evidence, key contracts and entrypoints.
3. **Coverage:** totals per axis/status, checked platforms/environments, explicitly omitted work, justified inapplicable scenarios, test execution vs source-only review.
4. **Verified findings:** separate confirmed regressions from changes with unknown/intended status. For each give BASE/HEAD comparable evidence, impacted contract, user effect, reproduction, smallest fix, and regression test recommendation.
5. **Needs validation:** exact blocker, observed evidence, safe next test and owner decision needed. No severity for unresolved leads.
6. **Rejected leads:** short rationale when useful to prevent the same misconception from recurring.
7. **Next actions:** ranked by impact and decisiveness, including missing acceptance criteria, missing tests, and high-leverage additional coverage.

Reports are derived from the machine records; prose never upgrades an unresolved finding to confirmed or hides unexecuted checks. A clean run can have zero confirmed regressions while still being incomplete.

## Human decision points

Owners decide product intent when historical evidence conflicts, whether breaking API changes are authorized, whether a migration is acceptable, how much risk can be accepted, and whether to ship. No audit skill can infer those decisions from a passing test alone.

