## Summary

Wire the **default client production static server** to `node server.mjs` instead of `serve -s dist`, so no-cache `index.html`/`sw.js`, missing `/assets/*` → 404, SPA fallback, and same-origin `/api` proxy are the image/Compose default — not only optional `npm run start:prod`.

Base: verified fresh `main` `583285679d618fa58abd2d2a537c078fbb4d66a2` (PWA foundation #4).

## Production diff (minimal)

- `client/Dockerfile`: `COPY server.mjs`; `CMD ["node","server.mjs"]`; drop global `serve`; empty default `VITE_API_BASE_URL`; `PORT`/`DIST_DIR`/`API_UPSTREAM`
- `docker-compose.yml` client: build-arg empty `VITE_API_BASE_URL`; runtime `API_UPSTREAM=http://api:8080`
- `client/scripts/entrypoint-parity-node.mjs` + npm script (Node entry contract tests)

## Evidence (separate commit; not product features)

- `docs/evidence/p1-evidence-correction-20261121b/` — corrects prior “nav stays 1” (actual baseline **2** → timeout **2** → Retry **3**) and SHA256SUMS self-hash / stale NOTES; old bundles retained, not overwritten
- `docs/evidence/p1-persist-through-pwa-retry-20261121/` — **one** isolated run: real API + new ephemeral PG → unique composer message → A→B update + ENGINEERING_INJECTION (controllerchange **notification** suppress only) → timeout → explicit Retry → **same** conversationId + text restored on PROD React via **`node server.mjs`**
- Eve: **ACK_STUB_NO_INFERENCE** (no paid inference)

## Checks run

- `npm run test:server-safejoin` pass
- `npm run test:pwa` 18/18 pass
- `npm run build` pass
- `npm run test:entrypoint-parity` pass (**Node entry**, not Docker image)
- Combined persist-through-PWA-retry harness pass

## Not in this PR / not claimed

- No PR submission by this agent (Hamster Bot handles separately)
- No Docker **image** build/CMD proof (IndependentDocker unavailable)
- No phone/mobile, offline full history, live box/stack, P2/DeepSeek
- Does not alter frozen `cursor/p1-pwa-candidate-182b` @ `8b41903…` or dev evidence `1dba605…`
- Prior separate persist vs timeout runs on `1dba605` remain valid as separate checks — not cross-run data continuity

## Test plan

- [ ] Review Dockerfile/compose wiring only
- [ ] Re-run `cd client && npm run test:entrypoint-parity` after `npm run build`
- [ ] Optional later: IndependentDocker image CMD parity (out of scope here)
