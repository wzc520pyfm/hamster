# Release process (0.x)

Early Hamster cuts are intentional `0.x` tags. Breaking changes are allowed. Do not wait on a ProductBot freeze or a live-model gate for exploratory tags.

## Cut a release

1. Ensure `main` has the commits you want (merge the release PR if needed).
2. Bump every package version together: `api/`, `agent/`, `client/`, `electron/` `package.json` (and lockfiles when they embed the root package version).
3. Add a `CHANGELOG.md` section for `X.Y.Z`.
4. Merge to `main`.
5. Tag and push:

```bash
git checkout main
git pull origin main
git tag -a vX.Y.Z -m "Hamster vX.Y.Z"
git push origin vX.Y.Z
```

6. GitHub Actions workflow **Release** (`.github/workflows/release.yml`) creates a GitHub Release from the tag (prerelease while still on `0.x`).

## Manual fallback

If the workflow is unavailable:

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file CHANGELOG.md --prerelease
```

## Verification policy for 0.x

- Preferred: `./scripts/verify-p0.sh` against Compose or the local Postgres + agent + api loop.
- Acceptable for early tags: offline unit suites (`agent` / `api` / `client` / `electron` test scripts) when Compose cannot run on the release host.
- Live-model path remains optional; fixture NOTE is expected when no provider key is set.
- Do not invent live-model evidence.

## Later automation

Once this flow is stable, extend the workflow to:

- run unit tests on `main` / PRs
- optionally run Compose contract on a Docker-capable runner
- create the tag from a version bump commit (release-please or a thin custom job)
