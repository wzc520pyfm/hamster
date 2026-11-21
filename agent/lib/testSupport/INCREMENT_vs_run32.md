# Persistent increment vs run32 (network-deny)

Official run32 evidence (`56501a915bf6cd114f2eb17e5dbec681e71dd36ebd5844d7bdcdcfe7aa80992d`)
did not ship a durable incremental-delta file. This file is that record for the
preload / tls follow-up.

## Relationship

| Artifact | SHA256 |
| --- | --- |
| run31 behavioral tar | `cd047e7e1326e4ca7e96870c33eb3b4c15fddf1bc8ea20b2d99e99c51d7c0c4d` |
| run31 frozen patch (`6cafe2e…`) | `6cafe2e3458e6d3325937e76d76cfdbaedbee522485103b88d332988fa6d4d3a` |
| run32 network-deny tar | `56501a915bf6cd114f2eb17e5dbec681e71dd36ebd5844d7bdcdcfe7aa80992d` |
| baseline | `109ba13dff17ed7b9db58b7eb84d67f4c249b458` |

Production `agent/lib/liveSelection.ts` and `agent/agent/agent.ts` remain
**byte-identical** to run31 (and therefore to run32’s production copies).

## Holes closed (tests-only)

1. **Every test child unguarded without per-file import** — `model.test.ts` had
   no harness import; npm script lacked preload. Fix:  
   `node --import ./lib/testSupport/networkDeny.preload.ts --test …`  
   Preload clears key/proxy env and installs the harness **before** any test or
   provider module evaluates, so captured function aliases cannot bypass the guard.
2. **ESM `import * as https` via `tls.connect`** — http namespace fell through to
   net; https namespace uses `tls.connect`. Fix: hook `tls.connect` and add
   https CJS/default/ESM-namespace sanity (local mocked calls only; no real probe).

## New / changed paths (increment vs run32)

- `agent/lib/testSupport/networkDeny.preload.ts` (new)
- `agent/lib/testSupport/networkDeny.harness.ts` (tls + env clear + install flag)
- `agent/lib/testSupport/networkDeny.harness.test.ts` (httpsNs + tls sanity)
- `agent/lib/liveSelection.behavioral.test.ts` (httpsNs + tls sanity)
- `agent/lib/model.test.ts` (preload-install proof; no local harness import)
- `agent/package.json` (test script `--import` preload)
- `agent/lib/testSupport/INCREMENT_vs_run32.md` (this file)
