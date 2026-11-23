# Changelog

All notable changes to Hamster are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
for early `0.x` cuts (breaking changes allowed without a major bump).

## [0.1.2] - 2026-11-23

### Added

- Multi-platform release matrix: Linux AppImage, Windows NSIS `.exe`, and macOS `.dmg` built in parallel and attached to one GitHub Release
- `electron` scripts `dist:win`, `dist:mac`, and `dist`

### Notes

- Packages remain unsigned (SmartScreen / Gatekeeper warnings expected)
- macOS CI uses `macos-latest` (Apple Silicon); Intel macOS not built yet

## [0.1.1] - 2026-11-23

### Added

- Release workflow now builds the Linux x64 Electron AppImage and attaches it to the GitHub Release asset list
- `electron` packaging script `npm run dist:linux` (`electron-builder` + fail-closed AppRun)
- Versioned artifact name: `hamster-<version>-linux-x86_64.AppImage`

### Notes

- v0.1.0 had release notes only (no installer). Use v0.1.1+ for downloadable AppImage.
- Still unsigned / no auto-update; Linux x64 only.

## [0.1.0] - 2026-11-23

First exploratory `0.x` cut of the private self-hosted stack. Provisional name; not a public product launch. Eve is not frozen.

### Added

- Self-hosted control plane (`api/`): conversations, tasks, assets, fail-closed approvals, OpenUI validate-then-persist
- Eve worker (`agent/`): fixture/`mockModel` path by default; direct Anthropic / OpenAI / DeepSeek live-model hard-cut when credentials are set
- React web client (`client/`): conversation / task / dashboard surfaces, EN|中文 locale, PWA update reliability, `server.mjs` production entry
- Compose stack (`docker-compose.yml`): `db` + `agent` + `api` + `client`
- Electron private preview slice (`electron/`): frame-bound IPC, AppImage fail-closed launcher
- Contract script `scripts/verify-p0.sh` and historical Compose evidence in `docs/p0-report.md`

### Notes

- Full Compose contract evidence on record: **PASS=24 FAIL=0 NOTE=1** (fixture worker; live model not required for this cut)
- This cloud cut also re-ran offline unit suites (agent / api / client / electron) before tagging; Compose was not re-run in the release environment (no Docker on that host)
- Repo stays private; no npm publish; no Vercel / hosted eve / OpenUI commercial Gateway required

[0.1.2]: https://github.com/wzc520pyfm/hamster/releases/tag/v0.1.2
[0.1.1]: https://github.com/wzc520pyfm/hamster/releases/tag/v0.1.1
[0.1.0]: https://github.com/wzc520pyfm/hamster/releases/tag/v0.1.0
