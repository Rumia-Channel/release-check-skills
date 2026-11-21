# CLI, Library, and Packaging Malfunction Hunting

#### When to use this file

Reach for this file when the target ships a CLI tool, reusable library/SDK, plugin/extension host, or distributable package (npm, PyPI, Cargo, Go module, binary archive). Use alongside `DEFECT-CLASSES.md` and `CONFIG-BUILD-AND-LIFECYCLE.md`.

## Core discipline (include in every agent prompt for this domain)

```text
- Verify what actually gets BUILT and PACKAGED, not just what runs via `src/` in dev mode.
  Check entry bins, `exports`/`main`/`types`, included/excluded files, and runtime deps.
- For CLIs, inspect flag parsing, env/config precedence, stdin/TTY vs pipe detection,
  stdout/stderr separation, signal handling, and exact non-zero exit codes.
- For libraries/SDKs, check caller invariants: null/empty inputs, re-entrancy, resource
  disposal, type definitions vs runtime types, error classes, and semver compatibility.
- Use `confirmed_defect` / `confirmed_regression` only with bounded local pack/build/CLI
  checks; use `needs_validation` for target OS/registry environments unavailable locally.
```

## CLI contract and platform defect classes (subagent_type: `general`)

**Flag, argument, environment, and config precedence or unwired-option bugs**
Documented CLI flags (`--no-*` negations, `-o`, `--config`, `--quiet`, `--dry-run`, `--force`), env vars, or config files are ignored, overridden by wrong precedence, misparsed when positional args contain hyphens/spaces, or drift between `--help` and parser definitions.

**Exit code, stdout/stderr separation, TTY, and machine-output defects**
Failed CLI commands exit `0` (breaking CI scripts), write human spinners/logs/warnings to `stdout` when `--json`/`--format=json` is requested, hang reading `stdin` when run non-interactively without a TTY, or fail to clean up on `Ctrl-C`.

**Cross-platform path, line-ending, encoding, permission, and quoting defects**
Hardcoded `/` separators, assumptions about case-sensitive filesystems, unquoted paths with spaces passed to shells, CRLF vs LF mismatches, non-UTF-8/BOM handling failures, or missing executable bits/shebangs break Windows, macOS, or Linux execution.

## Packaging, exports, and library contract defect classes (subagent_type: `general`)

**Public export, module-format, type-definition, and semver breakage**
`package.json` `exports` (ESM vs CJS dual-package hazards), TypeScript `.d.ts` signatures, Python `__all__`/`pyproject.toml` entrypoints, or Rust/Go public exports disagree with runtime implementations, break tree-shaking/imports, or silently break backward compatibility.

**Packaging, manifest, dependency-classification, and dev-vs-built drift**
Runtime imports rely on `devDependencies` (failing in clean user installs), `.npmignore`/manifest excludes templates/migrations/schemas/assets needed at runtime, or source edits leave generated/compiled artifacts stale.

**Plugin, hook, and extension loading or lifecycle-ordering failures**
Plugin discovery fails on symlinks/paths, hooks mutate shared objects unexpectedly, lifecycle methods (`init`, `ready`, `teardown`) run out of order or swallow plugin load errors silently, or older plugin API versions crash hosts without version negotiation.

**Library global state, re-entrancy, resource disposal, and error-contract bugs**
Mutating caller-passed objects/arrays, relying on module-level singletons across independent client instances, leaking handles when `close()`/`dispose()` fails or isn't idempotent, or throwing untyped/inconsistent errors contradicting documented error contracts.

## Universal moves (apply across the above)

- Run or inspect the dry-run package manifest / build output (`dist/`, wheel contents, bin wrappers) and compare against source imports and asset reads.
- Check every flag in CLI `--help` / docs against actual usage in command handlers.
- Test CLI invocation under piped stdin (`< /dev/null`), `--json`, failing inputs, and paths containing spaces or relative/non-existent directories inside scratch.
- Execute a `real_env_test` invoking the built CLI binary or importing the packed library from a neutral `scratch/consumer/` directory, plus a `virtual_test` A/B differential probe toggling every documented flag/option ON vs OFF and asserting exit codes and stdout/stderr purity (see [TESTING-AND-HARNESSES.md](TESTING-AND-HARNESSES.md)).

## Validation rules (apply before reporting ANY finding here)

1. Name the CLI flag, exported API, package field, or platform assumption, expected contract, source path, and broken runtime/import/exit behavior.
2. Verify whether package-manager resolution or bundler shims resolve the mismatch before reporting.
3. Reproduce with bounded local invocations against scratch artifacts/tarballs/CLI runs without fetching network packages.
4. Keep unobservable target OS/architecture behaviors or live package-registry publication facts as `needs_validation`.
