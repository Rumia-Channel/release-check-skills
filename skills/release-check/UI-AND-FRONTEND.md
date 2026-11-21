# UI and Frontend Malfunction Hunting

#### When to use this file

Reach for this file when the target renders a browser UI, SPA, SSR/hydration app, browser extension, or interactive webview where user actions drive client state, forms, routing, async network calls, and browser storage. Use alongside `DEFECT-CLASSES.md` and `API-AND-PROTOCOLS.md`.

## Core discipline (include in every agent prompt for this domain)

```text
- Trace from real user interaction (click, submit, keypress, route transition, refresh,
  back/forward) to state store, network call, optimistic update, error UI, and DOM render.
- Verify real wiring: a UI button or form field that accepts input without mutating backend
  or persisted state (or drops values during serialization) is a hidden malfunction.
- Check loading, empty, error, offline, slow-response, and stale-closure paths as closely
  as happy-path rendering.
- Never trust component unit tests that mock the API client or router without checking the
  real integration contract.
- Use `confirmed_defect` / `confirmed_regression` only with source proof plus bounded local
  component/DOM/browser checks; use `needs_validation` when a specific browser engine,
  third-party script, or deployed CDN/SSR environment cannot be reproduced locally.
```

## State, reactivity, and rendering defect classes (subagent_type: `general`)

**Stale closures and reactive dependency drift**
Callbacks, timers, event listeners, memoized selectors, or effects capture stale props/state due to missing dependencies, wrong keys, or mutated references instead of immutable updates. Confirm user-visible stale state or mis-fired action.

**Async fetch races and failed optimistic rollback**
Rapid filter changes, tab switches, pagination clicks, or edits issue overlapping requests whose responses resolve out of order, overwriting newer state—or optimistic UI updates fail to roll back cleanly when the mutation request rejects.

**SSR, hydration, and client/server rendering mismatch**
Server-rendered markup differs from initial client render due to locale, timezone, random IDs, window/storage reads, or conditional auth state, causing hydration errors, swallowed event listeners, or flickering/missing UI controls.

**Unmount cleanup leaks and render-loop stalls**
Effects, subscriptions, observers, WebSockets, or polling timers survive component unmount or re-trigger infinite state updates on edge props, degrading responsiveness or mutating unmounted state.

## Interaction, routing, and persistence defect classes (subagent_type: `general`)

**Unwired controls and broken loading, empty, or error states**
Visible buttons, toggles, filters, or settings inputs bind to no-ops, drop fields before submit, leave infinite loading spinners when empty/error responses return, or hide actionable errors behind blank screens.

**Form validation, double-submit, and disabled-state defects**
Client validation diverges from server validation, blocks valid Unicode/edge inputs, loses unsaved inputs on error, or fails to guard against Enter-key / double-click duplicate submissions.

**Routing, deep-link, refresh, and navigation-state loss**
Direct URL visits, browser refresh, back/forward navigation, query-param encoding, or redirect-after-login drops parameters, 404s valid client routes, or loses unsaved workflow context.

**Browser storage, cache, and multi-tab state desynchronization**
`localStorage`, `sessionStorage`, IndexedDB, service-worker caches, or query caches persist incompatible schema versions across releases, fail on private-mode/quota errors, or corrupt state across open tabs/account switches.

## Universal moves (apply across the above)

- Inspect every interactive screen across 5 mandatory states: loading, populated, empty, error/offline, and rapid repeat/cancel.
- Diff form fields + client TypeScript/schema types directly against actual backend API payloads and validation errors.
- Check `package.json`, bundler config, and router fallbacks for differences between `dev` server and built production bundle.
- Build targeted `virtual_test` harnesses in `scratch/` (see [TESTING-AND-HARNESSES.md](TESTING-AND-HARNESSES.md)): mount real components with real store/router while virtualizing only the HTTP boundary via a deferred-promise barrier (resolving request #2 before request #1 to prove stale overwrite or broken optimistic rollback) and run a `real_env_test` against the built bundle on an isolated loopback origin when a local headless browser/DOM runner is available.

## Validation rules (apply before reporting ANY finding here)

1. Cite the feature, UI component/entrypoint, user action, broken state/DOM/network path, and concrete user-visible malfunction.
2. Confirm no parent wrapper, error boundary, or backend layer prevents or transparently recovers the defect.
3. For SSR/hydration or browser-storage issues, verify both initial load and reload/migration paths with bounded local checks.
4. Return `confirmed_defect` / `confirmed_regression` only with bounded local proof; use `needs_validation` for unobservable browser-specific rendering or external backend behavior.
