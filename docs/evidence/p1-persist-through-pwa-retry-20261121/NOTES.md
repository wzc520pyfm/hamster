# P1 single-run: online persist through PWA timeout→Retry (2026-11-21)

pass=true

## Run identity

- kind: `p1_persist_through_pwa_retry_single_run`
- production entry: **`node server.mjs`** (Node default startup contract)
- Docker image/CMD: **NOT run** (IndependentDocker unavailable)
- uniqueUserText: `P1-persist-pwa-retry-1795195901858-55cfdcf1`
- conversationId: `conv_971b67b1-f25a-4178-8f35-6ae749f72b1b`
- Eve: **ACK_STUB_NO_INFERENCE**

## What this proves (one run)

1. Real API + new ephemeral PG (live data_directory + marker)
2. PROD React composer persists unique user message in DB
3. A→B update; ENGINEERING_INJECTION suppresses controllerchange **notification** only
4. Timeout → retry UI; relative nav baseline unchanged; then explicit Retry → baseline+1
5. After Reload: **same** conversationId + unique user text restored; bundle B marker visible

## Not claimed

- Phone/mobile, offline full history, live box, Docker image, paid inference
- Continuity of data from earlier **separate** persist vs timeout evidence runs

## Nav wording

Baseline is observed count (often 2). Timeout keeps baseline. Retry = baseline+1. Never “stays 1”.
