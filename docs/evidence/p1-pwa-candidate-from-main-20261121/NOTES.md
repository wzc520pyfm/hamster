# P1 PWA candidate from fresh remote main (2026-11-21)

Private branch materials only. **No PR created by this agent.**

## Run commands (verification)

```bash
cd /tmp/hamster-p1-pwa-candidate-182b   # or after push: checkout cursor/p1-pwa-candidate-182b
cd client
npm run test:pwa
node --test server.safejoin.test.mjs
npm run build
# optional: npm run test:pwa-lifecycle   # long Chromium lifecycle; VM evidence already at 1623bfa folders
```

## CI limitation

No `.github/workflows` in this repository — cannot run GitHub Actions without creating a PR
or adding workflows. Local unit/type/build recorded instead.

## Development branch untouched

`feat/p1-deepseek-live-model-20261120` left intact (separate worktree).
