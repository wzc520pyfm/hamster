# Hamster (provisional name)

This is a bounded P0 exploration, not a product release. "Hamster" is a provisional name. The trademark has not been searched, and this repository is not a public launch.

P0 checks whether a self-hosted control plane, a React web client, independent task lifecycles, persistent OpenUI pages, and fail-closed approvals can be built on a replaceable execution engine. Eve (`eve@1.0.2`) is evaluated first. This is not the first public version, and it is not authorization to publish or to promote the project.

## What is in this tree

| Piece | Path | Role |
| --- | --- | --- |
| Control plane | `api/` | Conversations, tasks (Line A), assets (Line B), approvals, policy |
| Eve worker | `agent/` | Self-hosted `eve start` process; scripted fixture model by default |
| React client | `client/` | Three demo surfaces: main conversation + task cards, Dashboard, approvals |
| Compose | `docker-compose.yml` | `db` + `agent` + `api` + `client` |
| Evidence | `docs/p0-report.md` | Hard-constraint pass/fail with how it was tested |

## Self-hosting (Compose)

Requirements: Docker with Compose v2, and nothing else for the scripted demo path.

```bash
cp .env.example .env   # optional overrides; defaults are placeholders only
docker compose up --build
```

Then open `http://localhost:3000`. The browser talks to the API at `http://localhost:8080` (`VITE_API_BASE_URL`).

Default placeholder env values (overridable; not real secrets):

- `HAMSTER_DB_PASSWORD=changeme`
- `HAMSTER_SECRET_KEY=super-secret-change-me`
- `HAMSTER_INTERNAL_SECRET=dev-internal-secret`
- `HAMSTER_AGENT_PASSWORD=dev-agent-password`

No Vercel project, no hosted eve service, and no OpenUI commercial Dashboard/Gateway are required. The loop completes on a single host.

### Model keys

If no model provider key is configured, the agent uses eve's deterministic fixture model (`mockModel`). It drives the demo tool sequence honestly and does not invent task progress or approvals. Progress questions typed as `progress` are answered by the control plane from persisted events.

To use a real model later:

```bash
# in .env / Compose environment for the agent service
HAMSTER_MODEL_ID=anthropic/claude-…   # or another provider string eve accepts
# plus the provider credentials your chosen model needs
```

Without those credentials, leave `HAMSTER_MODEL_ID` empty.

### Demo loop (English UI; switch EN | 中文 in the shell)

1. In the main conversation, send `start task: Build weekly metrics dashboard`.
2. Ask an unrelated follow-up — the worker keeps running; input stays available.
3. Use the Task card: `Check progress`, `Steer this task`, `Cancel this task`.
4. When a Dashboard exists, open it from the card or **Dashboards** — both use `/assets/:assetId`.
5. When `publish_dashboard` needs approval, decide from the card or **Approvals**. Ignoring it expires with `Expired — not approved, so it did not run`.

## Local verification without Compose

Postgres + Node 24+ can run the same loop:

```bash
# db, then:
cd agent && npm install && npx eve build && PORT=8081 HAMSTER_API_URL=http://127.0.0.1:8080 npx eve start --host 127.0.0.1 --port 8081
cd api && npm install && DATABASE_URL=postgres://hamster:changeme@127.0.0.1:5432/hamster EVE_API_URL=http://127.0.0.1:8081 node index.js
cd client && npm install && VITE_API_BASE_URL=http://localhost:8080 npm run build && npm run preview -- --port 3000
./scripts/verify-p0.sh
```

## Status

P0 implementation of the three demo surfaces and hard-constraint checks is documented in `docs/p0-report.md`. Eve is the engine under test for this private exploration. Hermes was not started because eve met the hard constraints in verification.

## License

MIT. See `LICENSE`.
