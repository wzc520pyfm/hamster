# P2 — managed same-instance reuse (identity + provenance)

Local isolated-desktop architecture only. Fake broker + fake health + real Postgres HTTP.
Never touches box live desktop / does not docker stop/rm live containers.

## Identity constraints (reuse)

Reuse of `create_isolated_desktop` is allowed only when **all** hold:

1. **Managed provenance** row in `isolated_desktop_managed` written only after a successful Hamster approve → start → ready → session chain (never silent adopt of an external same-name runtime).
2. **Probe identity** matches managed: `containerId`, `instanceId`, allowlisted `configImage` / image, `hamster.managed=approved` labels when present.
3. **Health bind**: `GET …/eve/v1/health` JSON `{ ok:true, targetId, instanceId }` must match managed instance + isolated target (plain 2xx / name match is insufficient).
4. **Session boundary TOCTOU**: recheck probe+health against the frozen identity before `createSession`; mismatch → mint create/start ticket (fail closed).

## Negative results (fake env only)

| Scenario | Expected |
|---|---|
| External same-name + 2xx, no managed row | mint create ticket |
| Wrong allowlisted image on probe | mint create ticket |
| Spoofed health `instanceId` | mint create ticket |
| Identity swap between verify and session | mint create ticket |
| Broker start vs unmanaged name collision | `unmanaged_or_foreign_container_present` (no stop/rm) |

## Authorize HTTP chain

`POST /api/approvals/:id/approve` for `create_isolated_desktop`:

1. Consume ticket once via `policy.authorize`
2. `broker.start` with new `instanceId` + managed labels (fail closed on foreign same-name)
3. Health wait with identity bind
4. Probe+health recheck at session boundary
5. `createSession` on isolated URL
6. Upsert `isolated_desktop_managed`
7. Stamp “Approved for this action only”

Subsequent createTask with matching managed identity reuses (0 tickets, 0 `broker.start`).

## Commands

```
DATABASE_URL=postgres://hamster:changeme@127.0.0.1:5432/hamster_p2_test \
  node --test api/src/isolatedReuse.http.test.js api/src/isolatedReuse.test.js \
    api/src/isolation.test.js api/src/readiness.test.js api/src/startFailed.test.js
```

See `unit-and-http.txt` in this folder.
