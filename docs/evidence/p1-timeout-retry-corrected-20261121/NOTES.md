# P1 timeout→Retry CORRECTED claims (2026-11-21)

Preserves prior evidence at `docs/evidence/p1-timeout-retry-continuity-20261121/` (unchanged).

pass=true

## ENGINEERING_INJECTION (corrected)

Suppresses `controllerchange` **notification** to wrapped listeners so production
`waitForControllerChange` (4s) times out. **Does not** delay actual SW activation.
No harness `SKIP_WAITING` after timeout — production Reload already posted it;
activation observed unaided. `actualControllerChangeAt` recorded via unwrapped `origAdd`.

## Navigation / bundle B

- Same document (nonce) through timeout + retry UI (nav count stays 1)
- Explicit user Retry → exactly one new main-frame navigation
- After Retry: visible `bundle-B-evidence-20261121`, asset JS contains marker, sw build = idB

## PNG SHA-256

- `corrected-banner-en-20261121.png`: `204fbe03c618fb32f29346c07ca009bd7d70254dd7f12d70755fef23dc3b9870`
- `corrected-banner-zh-20261121.png`: `91a440906c3b9adba24fcadd3494098b292c8487c564cdd3837107420c563c60`
- `corrected-timeout-retry-state-zh-20261121.png`: `489cba31b326d8cd7d86460bc2d07f42d1b3d5573d3596961c53ee73ad3b438c`

## Untested

- Phone / mobile
- Full offline conversation history (PRODUCT BOUNDARY — locale/controlBase only)
- Docker / live origin
