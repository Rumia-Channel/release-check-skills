# Native, Desktop, and Systems Malfunction Hunting

#### When to use this file

Reach for this file when the target includes native C/C++/Rust/Go system components, FFI bindings, desktop apps (Electron/Tauri/Qt/native), background daemons, local IPC (Unix sockets, named pipes, stdio, XPC, D-Bus), hardware/OS integrations, or native installers/auto-updaters. Use alongside `DEFECT-CLASSES.md` and `CLI-LIBRARY-AND-PACKAGING.md`.

## Core discipline (include in every agent prompt for this domain)

```text
- Track resource ownership, lifetimes, thread affinity (UI/main thread vs worker threads),
  error propagation across FFI/IPC boundaries, and clean teardown on exit/error.
- Inspect platform-conditional code (`#ifdef`, `cfg(...)`, `process.platform`) for diverging
  implementations where Windows, macOS, or Linux silently drops logic or fails path/encoding rules.
- Check local IPC framing, reconnects, stale socket/PID cleanup after crashes, and partial reads.
- Use bounded local harnesses, sanitizers, or isolated scratch IPC checks where supported; mark
  target-OS/hardware/signed-installer behaviors unavailable locally as `needs_validation`.
```

## Resources, concurrency, and FFI defect classes (subagent_type: `general`)

**Handle, descriptor, memory, and teardown resource leaks**
File descriptors, sockets, child processes, temp files, locks, GPU/native handles, or allocated buffers leak on error paths, timeouts, or repeated open/close cycles, eventually exhausting limits or blocking cleanup/unmount.

**Thread-affinity, lock-order, signal, and shutdown-race bugs**
Worker threads touch UI/main-thread-only APIs, inconsistent mutex ordering causes deadlocks under load, async callbacks fire after object teardown/app quit, or non-signal-safe work inside signal handlers deadlocks or corrupts state.

**FFI and ABI layout, ownership, null/length, and error-propagation mismatches**
Caller and native callee disagree on struct packing/alignment, string encoding (UTF-8 vs UTF-16, NUL termination), buffer length units (bytes vs elements), who frees memory, or panic/exception unwinding across C ABI boundaries.

## IPC, platform, and lifecycle defect classes (subagent_type: `general`)

**Local IPC framing, reconnect, stale-socket, and process-lifecycle bugs**
Short reads/writes on pipes or Unix sockets break message framing; crashed daemons leave stale `.sock`/`.pid` files preventing restart; child helper processes become orphaned zombies when the parent crashes; reconnect loops lose pending requests silently.

**OS, architecture, filesystem-case, locking, and window-lifecycle assumptions**
Code fails on case-insensitive or case-sensitive filesystems, Windows path length/locking (renaming an open file fails!), symlinks, non-ASCII user profile paths, high-DPI/multi-monitor/minimized window states, or single-instance locks.

**Installer, auto-updater, offline-mode, and local state-migration failures**
Auto-updaters fail while files are locked in use, leave half-applied binaries on interrupted download, break when user data schemas change across versions, or hang startup when offline/firewalled.

## Universal moves (apply across the above)

- Build a cross-platform matrix across all `process.platform`/`#[cfg]`/`#ifdef` branches to locate implementations present on one OS and stubbed/broken on another.
- Trace daemon/helper spawn → heartbeat/IPC → crash/kill → restart to verify stale PID/socket recovery and zombie cleanup.
- Inspect every FFI boundary for ownership, error return handling, NULL pointers, and non-ASCII string encoding.
- Run a `real_env_test` inside scratch verifying daemon start → IPC request → abnormal kill → clean restart with stale `.sock`/`.pid` files, plus `virtual_test` harnesses for fragmented short IPC reads, repeated open/close handle-leak loops, and non-ASCII/space-containing scratch paths (see [TESTING-AND-HARNESSES.md](TESTING-AND-HARNESSES.md)).

## Validation rules (apply before reporting ANY finding here)

1. Cite the native/desktop component, exact OS/thread/FFI/IPC invariant broken, source trace, and concrete functional failure (crash, hang, leak, data loss, orphaned process).
2. Verify whether wrappers, sanitizers, or platform runtime guarantees prevent the failure.
3. Reproduce locally inside the sandbox with bounded fixtures/sanitizers when target toolchain and OS match.
4. Mark cross-OS behavior (e.g., Windows/macOS checks while auditing on Linux, or vice versa), hardware, or signed-updater behaviors as `needs_validation`.
