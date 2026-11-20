# Gateway main()→spawnEve bootstrap (2026-11-21)

Production entry: `node lib/isolatedIdentityGateway.mjs` (isMain) which **itself**
calls `spawnEve()` then listens. Not a separately-launched Eve + server-only gateway.
Not a fetchUpstream shape stub.

pass=true
fixtureOnly=true (empty HAMSTER_MODEL_ID; labeled hamster-fixture / mockModel)



## Steps

- `spawn_production_gateway_main`: ok=true\n- `gateway_main_listening`: ok=true\n- `gateway_augmented_health_via_main`: ok=true\n- `session_without_identity_rejected`: ok=true\n- `session_with_identity_via_main_spawned_eve`: ok=true

## Summary

```json
{
  "gatewayEntry": "/agent/repos/hamster/agent/lib/isolatedIdentityGateway.mjs",
  "command": "/home/ubuntu/.nvm/versions/node/v24.22.3/bin/node /agent/repos/hamster/agent/lib/isolatedIdentityGateway.mjs",
  "nodeExecutable": "/home/ubuntu/.nvm/versions/node/v24.22.3/bin/node",
  "nodeVersion": "v24.22.3",
  "evePackage": "eve@1.0.2",
  "eveSpawn": "npx eve start (via gateway spawnEve)",
  "gatewayPid": 20389,
  "evePid": 20397,
  "gatewayPort": 46395,
  "upstreamPort": 46545,
  "fixtureOnly": true
}
```
