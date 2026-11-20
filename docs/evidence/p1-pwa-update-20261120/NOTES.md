# P1 PWA update reliability — Chromium lifecycle evidence (2026-11-20)

**Not phone acceptance.** Isolated-origin fixture on this agent VM only.
Box live stack / desktop `f2a2d67525a4` was not accessed.

## What ran

```
node client/scripts/pwa-update-lifecycle.mjs
```

Origin: `http://127.0.0.1:44697` (ephemeral loopback; not the box).

## Result

**pass=true**

Steps:
- `old_install`: ok=true
- `old_caches`: ok=true
- `continuity_before`: ok=true
- `update_banner_visible`: ok=true
- `after_user_reload`: ok=true
- `continuity_preserved`: ok=true
- `activate_cleanup`: ok=true
- `offline_launch`: ok=true
- `reconnect`: ok=true



## Covered

- Old fixed `hamster-pwa-shell-v1` install → new `sw.js` (repo `client/public/sw.js` v2 + activate cleanup + SKIP_WAITING)
- `updateViaCache: 'none'` registration; user-controlled Reload (no forced reload)
- Continuity keys preserved (`hamster.locale`, `hamster.controlBase`, conversation demo)
- Offline launch after upgrade still shows NEW_UI
- Reconnect preserves conversation data

## Not covered / not claimed

- Box Chromium / installed PWA on phone
- Full React Shell `PwaUpdateBanner` paint (this fixture mirrors the same SW + UX contract)
- Docker stack / API / agent

## Unit tests

```
node --test client/src/lib/pwaUpdate.test.mjs
```

Raw copy: `/opt/cursor/artifacts/p1-pwa-update-20261120/lifecycle-chromium.json`
