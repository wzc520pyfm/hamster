# Release process (0.x)

Early Hamster cuts are intentional `0.x` tags. Breaking changes are allowed. Do not wait on a ProductBot freeze or a live-model gate for exploratory tags.

## What a release includes

| Artifact | Source | Attached to GitHub Release |
| --- | --- | --- |
| Linux x64 AppImage | `electron/` `npm run dist:linux` on `ubuntu-latest` | Yes (`hamster-<version>-linux-*.AppImage`) |
| Windows x64 NSIS | `electron/` `npm run dist:win` on `windows-latest` | Yes (`hamster-<version>-win-*.exe`) |
| macOS DMG | `electron/` `npm run dist:mac` on `macos-latest` | Yes (`hamster-<version>-mac-*.dmg`) |
| Release notes | `CHANGELOG.md` + generated PR list | Yes |
| Compose stack / source | repo at the tag | Clone the tag; not a separate installer |

CI builds the three desktop packages **in parallel** (matrix), then one job attaches all assets to a single GitHub Release.

No auto-update. No code signing (macOS Gatekeeper will warn; Windows SmartScreen may warn).

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

6. GitHub Actions workflow **Release** (`.github/workflows/release.yml`):
   - matrix-builds Linux / Windows / macOS installers
   - creates a GitHub Release from the tag (prerelease while still on `0.x`)
   - uploads all three installers as release assets

## Local packaging (optional smoke)

Build only the current OS target (cross-OS packaging needs the matching runner / tooling):

```bash
cd electron
npm ci
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:linux   # or dist:win / dist:mac
ls dist/
```

## Manual fallback

If the workflow is unavailable, build each platform on its native host (or matching CI runner), then:

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file CHANGELOG.md --prerelease \
  path/to/*.AppImage path/to/*.exe path/to/*.dmg
```

## Verification policy for 0.x

- Preferred: `./scripts/verify-p0.sh` against Compose or the local Postgres + agent + api loop.
- Acceptable for early tags: offline unit suites (`agent` / `api` / `client` / `electron` test scripts) when Compose cannot run on the release host.
- Packaging smoke: `electron` unit tests (includes AppImage fail-closed static checks) + successful matrix `dist:*` jobs in CI.
- Live-model path remains optional; fixture NOTE is expected when no provider key is set.
- Do not invent live-model evidence.

## Later automation

Once this flow is stable, extend the workflow to:

- run unit tests on `main` / PRs
- optionally run Compose contract on a Docker-capable runner
- create the tag from a version bump commit (release-please or a thin custom job)
- optional Intel macOS (`macos-13`) and code signing when certificates exist
