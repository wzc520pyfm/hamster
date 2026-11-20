# P1 proposal: timeout → late controller → user Retry (2026-11-21)

**Conditional evidence / proposal only — not a pass claim.** Parent tip `40738ba`.

## Goal

Prove real browser path:

1. User Reload → `SKIP_WAITING` → **timeout** (no forced reload).
2. Late activation (waiting cleared; new controller already controlling).
3. User **Retry** recovers via `already_controlling` (unit already covers this in `pwaUpdateCore.ts`).
4. Continuity uses **actual Hamster session/conversation storage keys** written by the real React app — not three arbitrary fixture keys alone.
5. Offline continuity = data the app actually persisted (localStorage / Cache Storage from real shell), **not** faked server history served as offline.

## What unit/lifecycle already showed (limited)

- Unit: timeout never reloads; Retry with waiting-gone + matching active controller → `already_controlling`.
- Lifecycle Chromium on isolated VM origin: MIME / Not now / offline `#root` render / EN·ZH banners under `p1-pwa-timeout-lifecycle-evidence-20261120b/`.
- **Gap:** lifecycle continuity still seeds a small fixed key set; does not yet prove timeout→late→Retry in-browser with real conversation rows, and does not claim mobile/full conversation.

## Minimal isolated-origin harness (VM-safe)

| Boundary | Rule |
|----------|------|
| Origin | Ephemeral `http://127.0.0.1:<port>` only — **never** live Hamster origin / CDN / site cache |
| Assets | Real `client` production build (`vite build` + stamped `sw.js`) served by repo `server.mjs` |
| Network | Playwright `context.setOffline` for offline step; no calls to production APIs |
| Data | Drive UI to create/open a conversation so React writes real `hamster.conversation.*` / locale / controlBase; snapshot those keys before timeout and after Retry reload |
| Timeout path | Inject controllable `whenControllerChanges` only in **unit**; for browser, use a slow/blocked activate or SW test hook that times out once, then allow late activate — **without** forced `location.reload` on timeout |
| Parent box browser | **Out of scope for this agent** — parent must delegate/drive box browser if required; this agent may only use isolated VM Playwright |

### Explicit non-claims until evidence exists

- No mobile claim.
- No “full conversation history restored from SW cache” without listing exact keys + screenshot/hash.
- No treating `cache.put` fixture prep as natural SW cache-first (already disclosed).
- No live-origin or shared Service Worker scope pollution.

### Suggested artifact names (new, no overwrite)

- `/opt/cursor/artifacts/p1-timeout-retry-continuity-20261121/`
- `timeout-late-retry.json`, `continuity-keys-before.json`, `continuity-keys-after.json`
- `retry-en.png` / `retry-zh.png` (new filenames)
- `NOTES.md` with pass/fail per step and SHA-256 of PNGs

## Next action gate

Implement/run the harness only after:

1. Agreeing the continuity key allowlist = keys actually written by Shell/ConnectGate in PROD build, and
2. Confirming timeout injection method for Chromium (real SW timing vs test-only registration options) without touching live origin.

Until then this file is the proposal checkpoint — **not** verified success.
