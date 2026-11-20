# docker-probe.txt provenance (source / edit note)

## Fact

Commit `a312901` first landed `docker-probe.txt` with timestamp **`2026-11-20T16:41:11Z`** and a short raw-ish body (DOCKER_HOST unset, `docker: absent`, `ls` sock error).

Commit `52df087` **replaced** that file contents with an expanded **edited summary** and changed the header timestamp to **`2026-11-20T16:41:00Z`** (not a re-probe; no new Docker/2375/live probing).

## Preserved original

Exact blob from `a312901` is copied beside this note as:

- `docker-probe.original-a312901.txt`

Current `docker-probe.txt` remains the `52df087` edited summary (left as historical tip content; not silently rewritten again).

## What is NOT claimed

- No fabricated historical raw command dump beyond what `a312901` already stored.
- No re-run of the old probe claiming the original `16:41:11Z` or `16:41:00Z` wall clock.
- IndependentDocker remains **ENVIRONMENT LIMITATION**; no Docker/:2375/box/privileged retry.

## Git

```
git show a312901:docs/evidence/p2-docker-env-and-cancel-precision-20261121/docker-probe.txt
git show 52df087:docs/evidence/p2-docker-env-and-cancel-precision-20261121/docker-probe.txt
```
