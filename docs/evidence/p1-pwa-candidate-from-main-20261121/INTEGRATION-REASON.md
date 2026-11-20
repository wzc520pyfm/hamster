# P1 PWA candidate — integration reason

## Scope (batch 1)

Independently reviewed **P1 PWA production** final state through `1623bfaefc3374fa9faac520149819ce240657ab`:

- Deferred SW activate until explicit user Reload (`SKIP_WAITING` message only)
- `updateViaCache: 'none'` registration; deploy-id stamp from hashed assets
- Controller wait + **timeout does not reload**; Retry UI (EN/ZH)
- Late activation `already_controlling` retry recovery
- SW shell cache + safe asset responses (reject HTML-poisoned `/assets/*`)
- Prod static server cache-control for `sw.js` / SPA fallback
- Unit tests + lifecycle harness + historical evidence folders through 1623bfa

## Isolation method

Not a wholesale cherry-pick of the feature branch. Taken **file/symbol inventory** from
PWA commits `1233857` → `613e7bd` → `0b9fc14` → `4845ffd` → `321c0d3` → `1623bfa`,
then checked out those paths at tip `1623bfa` onto fresh `origin/main`, with **surgical**
wiring into main’s `Shell.tsx` / `messages.ts` / `main.tsx` / `vite.config.ts` /
`package.json` / `index.html`.

## Explicitly excluded

- All P2 identity / target / session / broker / DB / Docker / Eve gateway
- DeepSeek / live-model packaging
- Electron / ConnectGate / hamsterEnv / same-origin API proxy vite entries
- Run-target / isolated desktop UI
- InstallPrompt (install UX; not required for update banner path)
- Later evidence after 1623bfa (timeout-retry-continuity / corrected / online-persist)
  may be cited as supporting provenance only — **not** in this candidate production diff
- New offline conversation history feature (not requested; product boundary unchanged)

## Dependency check (P1 vs P2)

| Symbol / file | Depends on P2? | Notes |
|---|---|---|
| `pwaUpdateCore.ts` / `pwaUpdate.ts` | No | Pure SW helpers |
| `PwaUpdateBanner.tsx` | No | `Button`, `useLocale`, `pwaUpdate` only |
| `sw.js` / stamp / shell/sw cache | No | |
| `server.mjs` | No | Static + optional `/api` proxy helper; no isolation broker |
| `Shell.tsx` mount | No | Surgical insert of banner only on main Shell |

No P2 import/component required to ship this batch.
