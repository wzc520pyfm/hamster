# P2 identity MUST-FIX evidence (2026-11-20b)

Parent tip before this work: `321c0d3`. Independent review: MUST FIX (1)–(4) + DB live verify + real Eve bootstrap.

## Fixes landed

1. **Create with complete immutable digest** — `docker create` uses `sha256:64hex` Image Id; inspect digest verified before and after start.
2. **Strict digest equality** — `isCompleteImageDigest` + `digestsEqual`; rejects `sha256:`, truncations, wrong digests (no prefix match).
3. **Gateway binds ALL `/eve/v1/session*`** — create, `/existing`, cancel, stream, follow-ups; non-session routes 404 (no unsafe passthrough). API freeze identity on steer / approval-answer / cancel / attach / streams.
4. **Pin managed digestA** — tag retarget to digestB requires new approval; stopped managed restart keeps same instanceId (no auto stop/rm).

## DB harness safety

`assertEphemeralLiveConnection` queries live `SHOW data_directory` + `hamster_ephemeral_marker` token **before TRUNCATE**. Forged env dataDir / token / URL refused. Real temp PG only (`start-ephemeral-pg.sh`).

## Real Eve bootstrap (not fetchUpstream stub)

```
Node24=/home/ubuntu/.nvm/versions/node/v24.22.3/bin/node
$Node24 agent/scripts/real-eve-gateway-bootstrap.mjs
```

pass=true — see `bootstrap.json` / `/opt/cursor/artifacts/p2-real-eve-bootstrap-20261120b/`.
Fixture-only (`HAMSTER_MODEL_ID` empty). Eve `1.0.2` + gateway ports/PIDs recorded.

## Commands

```
node --test api/src/isolatedReuse.test.js api/src/isolation.test.js api/src/ephemeralPgGuard.test.js
node --test agent/lib/isolatedIdentityGateway.test.mjs
eval "$(api/scripts/start-ephemeral-pg.sh)"
node --test api/src/isolatedReuse.http.test.js
api/scripts/stop-ephemeral-pg.sh
```

No box live stack / no desktop stop-rm / no faces 5/6 / no PR.
