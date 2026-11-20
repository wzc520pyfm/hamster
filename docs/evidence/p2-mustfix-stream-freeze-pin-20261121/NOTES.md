# P2 MUST FIX — stream / frozen identity / pin digestA (2026-11-21)

Parent tip: `1623bfaefc3374fa9faac520149819ce240657ab`.

Three independently confirmed fixes on `feat/p1-deepseek-live-model-20261120`.

## 1) Incremental gateway streaming

`agent/lib/isolatedIdentityGateway.mjs` no longer `await upstream.arrayBuffer()`.
Session proxies write headers immediately and pipe NDJSON chunks with backpressure;
client abort cancels upstream. Regression:
`incremental NDJSON stream: first headers/event before end; cancel cleans upstream`
in `agent/lib/isolatedIdentityGateway.test.mjs` (identity protection preserved).

## 2) Frozen session/task identity (never rebind A→B)

Schema: `tasks.eve_instance_id|eve_container_id|eve_image_id` persisted at session create
(reuse + approve→start). Steer / cancel / approval-answer / reattach / streams use
`identityForTask` (ORIGINAL frozen columns). Missing legacy identity → 409 fail closed.
HTTP NATURAL: managed replaced with B; ops still send frozen A; B headers 409 on stream.

## 3) Stopped managed restart pins approved digestA

`broker.start({ expectedImageId })` restarts when container digest === approved A even if
mutable tag now inspects as B. Image change to B → `managed_image_digest_changed_requires_approval`
(no stop/rm/adopt). Create path still uses complete immutable tag digest + pre/post verify.

## Real gateway main→spawnEve

`/opt/cursor/artifacts/p2-gateway-main-spawn-eve-20261121/bootstrap-main-spawn.json`
Production entry `node lib/isolatedIdentityGateway.mjs` itself `spawnEve()` → health + session.
Fixture-only (`HAMSTER_MODEL_ID` empty). Eve 1.0.2 / Node 24.22.3. Not fetchUpstream stub;
not separately-launched Eve + server-only gateway.

## DB

Wholly separate `initdb` via `start-ephemeral-pg.sh`. Live `SHOW data_directory` + marker
matched before TRUNCATE. NATURAL approve vs SEED SQL labeled in HTTP suite.

## Commands

```
node --test api/src/isolatedReuse.test.js api/src/isolation.test.js
node --test agent/lib/isolatedIdentityGateway.test.mjs
eval "$(api/scripts/start-ephemeral-pg.sh)"
node --test api/src/isolatedReuse.http.test.js
api/scripts/stop-ephemeral-pg.sh
node24 agent/scripts/real-eve-gateway-main-bootstrap.mjs
```

## Boundaries (untested / mock)

- No docker daemon → broker create/restart vs real Docker not exercised (unit fakes).
- No box / live desktop / faces 5–6 / paid providers.
- HTTP Eve is gateway-shaped fake for API contract; main-spawn bootstrap is real Eve.
- Full multi-turn conversation continuity across A→B desktop replacement not claimed.
- Mobile not in scope.
