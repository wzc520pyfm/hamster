# P1 online conversation persist — real API + ephemeral PG (2026-11-21)

pass=true

## What

- Truly new temp PG via `start-ephemeral-pg.sh`
- Live `SHOW data_directory` + marker match before SQL
- Real API boot; PROD React UI creates/loads API-generated `conversationId`
- User message text persisted in DB (API-owned message id)
- Online browser refresh recovers same IDs/content

## Model response scope

Paid model inference not used. Local fixture Eve acknowledges sessions/messages without generating assistant content. Proof is API/DB-owned conversationId + user message id/content persistence and online React refresh recovery.

## Offline

Offline empty history remains PRODUCT BOUNDARY — only hamster.locale / hamster.controlBase persist in React localStorage. Not claimed here.

## Run

```
node client/scripts/p1-online-conversation-persist-20261121.mjs
```
