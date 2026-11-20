# Evidence correction — nav baseline + SHA256SUMS hygiene (2026-11-21b)

**New directory only.** Does not edit or overwrite:
- `docs/evidence/p1-timeout-retry-continuity-20261121/`
- `docs/evidence/p1-timeout-retry-corrected-20261121/`
- `docs/evidence/p1-online-conversation-persist-20261121/`
- frozen `cursor/p1-pwa-candidate-182b` @ `8b41903…`
- dev evidence branch `feat/p1-deepseek-live-model-20261120` @ `1dba605…`

## Defects corrected (claims only — old files retained)

### 1. Nav counter wording was wrong

Old corrected NOTES said: *“Same document (nonce) through timeout + retry UI (nav count stays 1)”*.

That is **false** relative to the recorded JSON (`timeout-retry-corrected-20261121.json`):

| Phase | `navCount` | Meaning |
|---|---|---|
| After initial load (`initial_document_stamped`) | **2** | baseline (Playwright/SW often yields 2, not 1) |
| Through timeout + retry UI | **2** | **relative baseline unchanged** |
| After explicit user Retry | **3** | exactly one new main-frame navigation |

**Correct claim:** relative baseline unchanged (**2**); user Retry → **3**. Do not say “stays 1”.

ProductBot acceptance of `1dba605` separated checks (nonce baseline 2 → timeout 2 → Retry 3 / no extra SKIP_WAITING / B React marker; and real API+PG persist) remains valid as **separate runs**. Those runs **cannot** claim the same real conversation data survived a PWA update — that needs a new single isolated combined run (see sibling evidence after wiring candidate).

### 2. Prior SHA256SUMS self-inclusion / stale NOTES

| Bundle | Defect |
|---|---|
| continuity + corrected | `SHA256SUMS.txt` listed **itself** → hash immediately stale; also listed `NOTES.md` |
| online persist | listed hash for `NOTES.md` **stale** vs on-disk NOTES; listed self-hash for `SHA256SUMS.txt` |

**This correction does NOT claim “whole old bundle hash passed.”**  
Only re-verified **payload** files (JSON/PNG/logs) — see `PRIOR-PAYLOAD-HASHES.txt`. Old NOTES / old SHA256SUMS are retained as historical artifacts with known defects.

### 3. Manifest rule for THIS directory

1. Write final notes (`CORRECTED-NOTES.md`, this file) **first**.
2. Write `SHA256SUMS.txt` **excluding itself**.
3. Verify every listed file matches; do not add `SHA256SUMS.txt` to the list.

## Boundaries

- No new browser run in this correction directory alone.
- No paid inference; no live box/stack; no Docker daemon claim.
- Injection precise claim (from corrected JSON, unchanged): ENGINEERING_INJECTION suppresses `controllerchange` **notification** only — not natural late activation; no harness extra `SKIP_WAITING`.
