# P2 — healthy isolated desktop reuse (2026-11-20)

Private engineering evidence. **Not** live-stack / box acceptance. Does not modify P1 PWA evidence.

## Problem

`createTask` always minted `create_isolated_desktop` even when the named isolated desktop was already running and HTTP-healthy.

## Fix (fail closed)

Server-only gate in `api/src/isolation.js`:

1. `probeIsolatedDesktop` must report `ok` (docker Running)
2. `checkIsolatedDesktopHealthOnce` must return HTTP ok
3. Only then `planIsolatedCreateTask` skips the create/start ticket and spawns the session
4. Client running claims are ignored; reuse never calls `broker.start`
5. `not_started` / unavailable / unhealthy ⇒ still mint create/start ticket
6. Tool / cross-target / create-vs-publish hash separation unchanged

Wired in `api/index.js` for `createTask`, isolated `retry`, and switch-to-isolated `target`.

## Commands

```
cd api && node --test src/isolatedReuse.test.js
cd api && node --test src/isolatedReuse.test.js src/isolation.test.js src/policy.test.js src/readiness.test.js src/startFailed.test.js
```

## Not tested here

- Live box API / desktop container / Docker stack
- Full HTTP createTask against a real Postgres + broker
- Phone / Electron GUI

## Security regression covered in unit fixtures

- create ticket params/hash ≠ publish_dashboard
- cross-target + missing targetId fail closed
- electron `main.js` still `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, `setWindowOpenHandler`
