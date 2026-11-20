## Summary

Default client production entry = `node server.mjs` (not `serve -s`). Base: verified `main` `583285679d618fa58abd2d2a537c078fbb4d66a2`.

## Narrow follow-ups (append on candidate)

1. `.env.example` empty `VITE_API_BASE_URL` (same-origin via server.mjs); explicit cross-origin override documented; config regression tests
2. Harness soft-pass removed; negative Node test for missing `controllerchange` observation
3. `assertLiveEphemeralOrThrow` before any business SQL; negative test guarantees zero business queries on mismatch

## Historical combined browser run

Preserved at `docs/evidence/p1-persist-through-pwa-retry-20261121/` (pass=true). **Not re-run** this append.
Boundaries: ENGINEERING_INJECTION notify-only; explicit `reg.update`; ACK_STUB_NO_INFERENCE; no Docker image claim.

## Test plan

- [x] `npm run test:harness-guards`
- [x] `npm run test:server-safejoin`
- [ ] IndependentDocker image CMD (out of scope)
