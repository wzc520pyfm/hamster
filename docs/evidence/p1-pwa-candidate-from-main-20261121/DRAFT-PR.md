# DRAFT ONLY — do not submit / create PR from this agent

Hamster Bot / owner handles PR submission and merge approval separately.
This file is materials only.

## Title

`P1: PWA update reliability (deferred activate, timeout no-reload, already_controlling retry)`

## Body

### Summary

Isolates independently reviewed **P1 PWA production** fixes through `1623bfa` onto current `main`:

- Service worker defers activate until explicit user **Reload** (`SKIP_WAITING`)
- `updateViaCache: 'none'`; per-deploy SW stamp from hashed assets
- Controller-change wait with **4s timeout that never reloads**; EN/ZH Retry copy
- Late activation recovery via `already_controlling` on Retry
- Shell cache hygiene + reject HTML-poisoned asset cache entries
- Prod `server.mjs` safe static responses (`sw.js` no-cache; `/assets/*` 404 not SPA)

### Base

`main` @ see `FREEZE.txt` `baseFullSha`

### Source provenance

File/symbol port from tip `1623bfaefc3374fa9faac520149819ce240657ab` PWA paths only (not wholesale feature-branch cherry-pick). Surgical wiring into main Shell/messages/main/vite/package/index.

### Explicitly out of scope

P2 identity/target/session/broker/DB/Docker; DeepSeek; Electron/ConnectGate; Run-target UI; InstallPrompt; offline conversation history feature; post-1623bfa continuity harnesses (supporting evidence only).

### Test plan

- [x] `cd client && npm run test:pwa` (18 pass)
- [x] `cd client && node --test server.safejoin.test.mjs`
- [x] `cd client && npm run build` (stamp logged)
- [ ] Owner/Hamster Bot: open PR when ready; CI if/when configured (none in-repo today)
- [ ] Mobile / full conversation / live origin / Docker — **not covered**

### Boundaries (uncovered)

Phone/mobile installed PWA; full multi-turn conversation offline history; live origin SW cache; IndependentDocker.
