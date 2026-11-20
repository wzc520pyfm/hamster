# RESULT — `cursor/p1-server-mjs-entry-182b`

## Exact SHAs

| Ref | SHA |
|---|---|
| Verified fresh `main` (base) | `583285679d618fa58abd2d2a537c078fbb4d66a2` |
| Production wiring commit | `ed13bf548ed040d80fb8062f5860fb71150604ca` |
| Candidate tip (evidence) | `18059c86ac6e35680d674adba8d477f53f600ce4` |
| Parent of tip | `ed13bf548ed040d80fb8062f5860fb71150604ca` |
| Old frozen (untouched) | `cursor/p1-pwa-candidate-182b` @ `8b4190359cb1609e8fb3c42a6676c60ea92cf7a1` |
| Dev evidence (untouched) | `feat/p1-deepseek-live-model-20261120` @ `1dba605b1ed0a5ffc2dd54a437bca1349e2e9081` |

Author/committer: **wzc520pyfm**. PR **not** created here.

## Diffstat vs main

See `diffstat-vs-main.txt` (17 files, +1409/−6 including evidence).

Production-only paths: `client/Dockerfile`, `client/package.json`, `client/scripts/entrypoint-parity-node.mjs`, `docker-compose.yml`.

## Single-run identity (combined)

| Field | Value |
|---|---|
| pass | **true** |
| kind | `p1_persist_through_pwa_retry_single_run` |
| origin | `http://127.0.0.1:3298` |
| entry | **`node server.mjs`** (`DIST_DIR`=serve tree, `API_UPSTREAM`→real API) |
| Docker image | **not run** |
| uniqueUserText | `P1-persist-pwa-retry-1795195901858-55cfdcf1` |
| conversationId | `conv_971b67b1-f25a-4178-8f35-6ae749f72b1b` |
| navBaseline | **2** (timeout stayed 2; Retry → 3) |
| builds | idA `0467ed911aa2` → idB `3dcdd67bb9b6` |
| Eve | ACK_STUB_NO_INFERENCE |

## Evidence correction (first; new dir)

`docs/evidence/p1-evidence-correction-20261121b/` (+ artifacts twin):

- Old “nav stays 1” **wrong** → relative baseline unchanged (**2**), Retry **3**
- Prior SHA256SUMS listed self / stale NOTES — **not** claiming whole old bundle hash passed
- Manifest excludes itself; payload re-hashes in `PRIOR-PAYLOAD-HASHES.txt`
- Old continuity/corrected/online dirs **retained unmodified**

## Boundaries / uncovered

- IndependentDocker image CMD still ENVIRONMENT LIMITATION
- No phone/mobile, offline full history, live stack, paid inference, P2/DeepSeek
- Pre-existing `openui/library.tsx` oxlint hooks + no CI ⇒ not “all green”
- Stale FREEZE `d6a7fa4` on old candidate remains historical noise (tip still `8b41903`)
