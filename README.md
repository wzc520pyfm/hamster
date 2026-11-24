# Hamster (provisional name)

This is a bounded P0 exploration, not a product launch. "Hamster" is a provisional name. The trademark has not been searched. The GitHub repository is public for easier CI packaging; that is not a product launch.

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

Then open `http://localhost:3000`. Recommended: leave `VITE_API_BASE_URL` empty so the
browser uses same-origin `/api` via `server.mjs` (`API_UPSTREAM=http://api:8080`).
Set `VITE_API_BASE_URL` only for an explicit cross-origin bake override.

### Electron private preview

GitHub Releases ship unsigned Electron installers that **do not** embed the Compose stack.
Start Compose (or production-style `server.mjs`) first, then open Hamster and enter the
client origin on the Connect gate — same machine: `http://localhost:3000`; another device
on the LAN: `http://<host-lan-ip>:3000` (placeholder example: `http://192.168.1.10:3000`).

Default Compose publishes Postgres (`changeme`), the API (no browser auth on conversation
routes), and the client on the host network. Prefer loopback for everyday use. For LAN
access, bind only what you need (or use an authenticated tunnel) — Electron Connect does
not restrict who else on the network can reach those ports.

On **macOS 15+**, LAN Connect needs **v0.1.11+** macOS installers: they declare
`NSLocalNetworkUsageDescription`, give the app its own Mach-O `LC_UUID`, and
ad-hoc re-sign after that rewrite (v0.1.10 could quit on launch). Prefer
`http://localhost:3000` on the same Mac. For LAN: Allow Hamster under System
Settings → Privacy & Security → Local Network, then **Retry**.

Default placeholder env values (overridable; not real secrets):

- `HAMSTER_DB_PASSWORD=changeme`
- `HAMSTER_SECRET_KEY=super-secret-change-me`
- `HAMSTER_INTERNAL_SECRET=dev-internal-secret`
- `HAMSTER_AGENT_PASSWORD=dev-agent-password`

No Vercel project, no hosted eve service, and no OpenUI commercial Dashboard/Gateway are required.

For the optional live-model path, the agent service alone receives `HAMSTER_MODEL_ID`, `HAMSTER_MODEL_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `DEEPSEEK_API_KEY` from the host `.env`; the api, client, and db services do not receive provider secrets.

### Model keys

If no model provider key is configured, the agent uses eve's deterministic fixture model (`mockModel`). It drives the demo tool sequence and does not invent task progress or approvals. Typed `progress` is answered by the control plane from persisted events.

To use a live (direct vendor) model later, set the **native** model id and the matching direct provider key:

```bash
# optional live model later — native model id, no provider prefix
HAMSTER_MODEL_ID=claude-sonnet-5
HAMSTER_MODEL_PROVIDER=anthropic   # or "openai" or "deepseek"

# DeepSeek (official OpenAI-compatible endpoint https://api.deepseek.com):
HAMSTER_MODEL_ID=deepseek-chat
HAMSTER_MODEL_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-...              # DeepSeek key; passed only to the agent service
```

- `HAMSTER_MODEL_ID` must be a **native** provider model id (e.g. `claude-sonnet-5`, the eve helper default for Anthropic; `deepseek-chat` for DeepSeek). Provider-qualified strings such as `anthropic/claude-…` are not part of this path.
- With `HAMSTER_MODEL_PROVIDER` unset, the agent selects the provider from the first matching key: `ANTHROPIC_API_KEY` → Anthropic, `OPENAI_API_KEY` → OpenAI, `DEEPSEEK_API_KEY` → DeepSeek.
- The agent passes the resolved model instance through eve's official direct callers (`import { anthropic } from "eve/models/anthropic"` / `import { openai } from "eve/models/openai"`), or through the Hamster DeepSeek factory (`import { createDeepSeekModel } from "../lib/deepseek.js"` in the agent), which calls the official DeepSeek OpenAI-compatible endpoint (`https://api.deepseek.com`, Chat Completions) with the DeepSeek key only and labels the provider as `deepseek`. Neither path goes through the Vercel AI Gateway.
- DeepSeek: default native model id when omitted is `deepseek-chat` (matches a recent live check; not an official recommendation). DeepSeek keys must **never** be written into `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`.
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

Postgres + Node 24+ can run the same loop (also what the latest contract evidence used). Start the worker and the control plane, then run the contract script against the API (`API_BASE` defaults to `http://127.0.0.1:8080`; the script does not start the client):

```bash
cd agent && npm install && npx eve build && PORT=8081 HAMSTER_API_URL=http://127.0.0.1:8080 npx eve start --host 127.0.0.1 --port 8081
cd api && npm install && DATABASE_URL=postgres://hamster:changeme@127.0.0.1:5432/hamster EVE_API_URL=http://127.0.0.1:8081 node index.js
./scripts/verify-p0.sh
```

The two client commands below are alternatives. Each serves `http://localhost:3000`. Run only one of them.

**Cross-origin development preview** (`npm run preview` → `vite preview`, not `server.mjs`). The build bakes `VITE_API_BASE_URL=http://localhost:8080`, so the browser calls the API on that other origin. This path does not proxy same-origin `/api`. `client/vite.config.ts` sets preview `host` `0.0.0.0` and `port` `3000`; `--port 3000` matches that port.

```bash
cd client && npm install && VITE_API_BASE_URL=http://localhost:8080 npm run build && npm run preview -- --port 3000
```

**Production-style local verification** (`npm run start:prod` → `node server.mjs`). Build with an empty `VITE_API_BASE_URL` (same default as `client/Dockerfile` and `.env.example`) so the bundle calls same-origin `/api`. `server.mjs` proxies `/api` to `API_UPSTREAM` (default `http://127.0.0.1:8080`; Compose sets `http://api:8080`) and listens on `PORT` (default `3000`, bound to `0.0.0.0`).

```bash
cd client && npm install && VITE_API_BASE_URL= npm run build && API_UPSTREAM=http://127.0.0.1:8080 PORT=3000 npm run start:prod
```

## Status

**v0.1.11** is the current exploratory `0.x` cut (public repo; provisional name). Releases require Linux / Windows / macOS installers — see `CHANGELOG.md` and `docs/release.md`.

Contract checks and OpenUI Renderer wiring are documented in `docs/p0-report.md` with fixture limitations called out. Eve is still not frozen; this is not a public product launch.

## License

MIT. See `LICENSE`.
