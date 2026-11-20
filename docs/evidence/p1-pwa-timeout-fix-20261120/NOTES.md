# P1 — controllerchange timeout must not reload (2026-11-20)

Does not claim prior P1 SHAs passed. VM unit evidence for production `pwaUpdateCore.ts`.

## MUST FIX

`applyPwaUpdate` previously awaited a wait that resolved on **timeout** and then **reloaded anyway**.

## Fix

- `waitForControllerChange` returns `{ ok:false, reason:'timeout' }` and removes the listener
- `applyPwaUpdate` reloads **only** when wait `ok:true`
- Timeout preserves the page; banner shows EN/ZH retry copy
- Apply attempts are serialized to avoid retry races

## Commands

```
node --experimental-strip-types --test client/src/lib/pwaUpdate.test.mjs
```

Includes: `production waitForControllerChange timeout: NEVER reload (MUST FIX)`.

## Gaps

Lifecycle Chromium evidence for MIME/offline/EN-ZH samples may land in a follow-up artifact if deferred to keep this timeout fix landed first.
