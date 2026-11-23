# Release process (0.x)

Early Hamster cuts are intentional `0.x` tags. Breaking changes are allowed. Do not wait on a ProductBot freeze or a live-model gate for exploratory tags.

Asset coverage is intentionally broad (similar to [cc-switch releases](https://github.com/farion1231/cc-switch/releases)): multiple OS/arch combinations and installer formats in one tag. Signing / updater metadata (`.sig`, `latest.json`) are not wired yet.

The GitHub repository is **public**. macOS packages are **required** for a release (arm64 + Intel).

## What a release includes

| Platform | Runner | Formats | Example asset names |
| --- | --- | --- | --- |
| Linux x64 | `ubuntu-22.04` | AppImage, deb, rpm | `Hamster-vX.Y.Z-Linux-*.AppImage/.deb/.rpm` |
| Linux arm64 | `ubuntu-22.04` (cross-package; fpm is x86-only) | AppImage, deb, rpm | same with arm64 / aarch64 arch token |
| Windows x64 | `windows-2022` | NSIS Setup, Portable | `Hamster-vX.Y.Z-Windows-*-Setup.exe`, `…-Portable.exe` |
| Windows arm64 | `windows-11-arm` | NSIS Setup, Portable | same with arm64 |
| macOS arm64 + Intel | `macos-latest` (both arches in one job) | dmg, zip | `Hamster-vX.Y.Z-macOS-arm64|x64.dmg/.zip` |
| Notes | — | `CHANGELOG.md` + generated PR list | GitHub Release body |
| Compose / source | — | clone the tag | not a separate installer |

CI builds these **in parallel** (matrix). The Release job waits for **all** platforms — **macOS is required** (arm64 + Intel) — then attaches every asset to one GitHub Release.

No auto-update. No code signing / notarization (SmartScreen / Gatekeeper warnings expected).

## Cut a release

1. Ensure `main` has the commits you want (merge the release PR if needed).
2. Bump every package version together: `api/`, `agent/`, `client/`, `electron/` `package.json` (and lockfiles when they embed the root package version). Keep them equal so installer versions match the tag.
3. Add a `CHANGELOG.md` section for `X.Y.Z`.
4. Merge to `main`.
5. Tag and push:

```bash
git checkout main
git pull origin main
git tag -a vX.Y.Z -m "Hamster vX.Y.Z"
git push origin vX.Y.Z
```

6. GitHub Actions workflow **Release** (`.github/workflows/release.yml`) builds the full matrix and uploads all installers.

## Local packaging (optional smoke)

```bash
cd electron
npm ci
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:linux   # or dist:win / dist:mac
ls dist/
```

## Verification policy for 0.x

- Preferred: `./scripts/verify-p0.sh` against Compose or the local Postgres + agent + api loop.
- Acceptable for early tags: offline unit suites when Compose cannot run on the release host.
- Packaging smoke: `electron` unit tests + successful full matrix (Linux / Windows / macOS) in CI.
- Live-model path remains optional; fixture NOTE is expected when no provider key is set.

## Later automation

- unit tests on `main` / PRs
- Compose contract on a Docker-capable runner
- tag-from-version-bump (release-please)
- code signing / notarization / updater metadata when keys exist
