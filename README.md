# Hamster (provisional name)

This is a bounded P0 exploration, not a product release. "Hamster" is a provisional name. The trademark has not been searched, and this repository is not a public launch.

P0 checks whether a self-hosted control plane, a React web client, independent task lifecycles, persistent OpenUI React Lang 1.0 pages, and fail-closed approvals can be built on a replaceable execution engine. Eve (`eve@1.0.2`) is evaluated first under a **fixture / mockModel path** when no live model key is set. This is not the first public version, and it is not authorization to publish or to promote the project. **Eve is not frozen.**

## What is in this tree

| Piece | Path | Role |
| --- | --- | --- |
| Control plane | `api/` | Conversations, tasks (Line A), assets (Line B), approvals, policy, OpenUI validate-then-persist |
| Eve worker | `agent/` | Self-hosted `eve start`; scripted fixture model by default |
| React client | `client/` | Three demo surfaces; OpenUI via `@openuidev/react-lang` |
| Compose | `docker-compose.yml` | `db` + `agent` + `api` + `client` |
| Evidence | `docs/p0-report.md` | Honest pass/fail notes (fixture-limited) |

## Self-hosting (Compose)

Requirements: Docker with Compose v2 for the scripted demo path.

On this verification host, passwordless `sudo docker` works (the `docker` CLI as the
`box` user cannot reach the docker socket). A user without docker.sock access needs to
run Compose with sudo or be in the docker group.

```bash
cp .env.example .env   # optional overrides; defaults are placeholders only
sudo docker compose up --build
```

Then open `http://localhost:3000` (API at `http://localhost:8080` via `VITE_API_BASE_URL`).

Default placeholder env values (overridable; not real secrets):

- `HAMSTER_DB_PASSWORD=changeme`
- `HAMSTER_SECRET_KEY=super-secret-change-me`
- `HAMSTER_INTERNAL_SECRET=dev-internal-secret`
- `HAMSTER_AGENT_PASSWORD=dev-agent-password`

No Vercel project, no hosted eve service, and no OpenUI commercial Dashboard/Gateway are required.

For the optional live-model path, the agent service alone receives `HAMSTER_MODEL_ID`, `HAMSTER_MODEL_PROVIDER`, `ANTHROPIC_API_KEY`, and `OPENAI_API_KEY` from the host `.env`; the api, client, and db services do not receive provider secrets.

### Model keys

If no model provider key is configured, the agent uses eve's deterministic fixture model (`mockModel`). It drives the demo tool sequence and does not invent task progress or approvals. Typed `progress` is answered by the control plane from persisted events.

To use a live (direct vendor) model later, set the **native** model id and the matching direct provider key:

```bash
# optional live model later — native model id, no provider prefix
HAMSTER_MODEL_ID=claude-sonnet-5
HAMSTER_MODEL_PROVIDER=anthropic   # or "openai"
ANTHROPIC_API_KEY=sk-ant-...        # or OPENAI_API_KEY=sk-... for openai
```

- `HAMSTER_MODEL_ID` must be a **native** provider model id (e.g. `claude-sonnet-5`, the eve helper default for Anthropic). Provider-qualified strings such as `anthropic/claude-…` are not part of this path.
- With `HAMSTER_MODEL_PROVIDER` unset, the agent selects the provider from the first matching key: `ANTHROPIC_API_KEY` → Anthropic, `OPENAI_API_KEY` → OpenAI.
- The agent passes the resolved model instance through eve's official direct callers (`import { anthropic } from "eve/models/anthropic"` / `import { openai } from "eve/models/openai"`), which call the provider directly and do **not** go through the Vercel AI Gateway.
- If `HAMSTER_MODEL_ID` is set but no provider can be determined, the agent fails with a clear error instead of falling back to the Gateway.
- Leave `HAMSTER_MODEL_ID` empty for the fixture path.

### Demo loop

1. Send `start task: Build weekly metrics dashboard`.
2. Ask an unrelated follow-up — the worker keeps running.
3. Use the Task card: `Check progress`, `Steer this task`, `Cancel this task`.
4. Open the Dashboard from the card or **Dashboards** — both use `/assets/:assetId` and render the persisted OpenUI document.
5. Approvals use `Deny` / `Approve this action` only. Ignoring a ticket expires with `Expired — not approved, so it did not run`.

Shell language switch: **EN | 中文** (same layout; fixed status words from the design table).

## Local verification without Compose

Postgres + Node 24+ can run the same loop (also what the latest contract evidence used):

```bash
cd agent && npm install && npx eve build && PORT=8081 HAMSTER_API_URL=http://127.0.0.1:8080 npx eve start --host 127.0.0.1 --port 8081
cd api && npm install && DATABASE_URL=postgres://hamster:changeme@127.0.0.1:5432/hamster EVE_API_URL=http://127.0.0.1:8081 node index.js
cd client && npm install && VITE_API_BASE_URL=http://localhost:8080 npm run build && npm run preview -- --port 3000
./scripts/verify-p0.sh
```

## Status

See `docs/p0-report.md`. Contract checks and OpenUI Renderer wiring are documented there with fixture limitations called out. This is still exploratory P0.

## License

MIT. See `LICENSE`.
