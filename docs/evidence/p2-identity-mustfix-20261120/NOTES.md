# P2 identity MUST-FIX evidence (2026-11-20)

Parent tip before this work: `74e157b9327f0fab50845094094db6dfdd1ecb90`.
Independent review: no acceptance of 74e; findings A–E confirmed.

## Safety: ephemeral Postgres only

HTTP harness **has no default DATABASE_URL** and refuses shared/`db:5432`/`hamster_p2_test`.

```
eval "$(api/scripts/start-ephemeral-pg.sh)"
node --test api/src/isolatedReuse.http.test.js
api/scripts/stop-ephemeral-pg.sh
```

Recorded in `ephemeral-pg.json`: initdb command, pg_ctl start, version, PID, port, dataDir.
This run used PostgreSQL 16.15 on `127.0.0.1:55976` (not 5432).

## Real Eve protocol vs wrapper

Public Eve health is `{ ok, status, workflowId }` (no targetId/instanceId). Session rejects unknown body fields.
Production fix: `agent/lib/isolatedIdentityGateway.mjs` wraps `npx eve start`, augments health, enforces `x-hamster-*` on session.
Broker create overrides container CMD to that gateway. Control-plane agent keeps plain `eve start`.

Gateway bootstrap (real Eve health shape, not API fake): `node --test agent/lib/isolatedIdentityGateway.test.mjs`

API HTTP fakes are **gateway-shaped** for contract tests — labeled as such; not worker bootstrap proof.

## NATURAL vs SEED

- **NATURAL**: `postMessage` → pending ticket → `POST /api/approvals/:id/approve` → authorize consume → start → managed → reuse 0 tickets / 0 starts
- **SEED**: SQL stamps `approved` then `/internal/policy/check` — explicitly labeled; not a natural approve chain

## Commands / first logs

See `http-ephemeral-pg.txt`, `unit-and-gateway.txt`, `ephemeral-pg.json` in this folder.
No box live stack / no desktop stop-rm / no faces 5/6.
