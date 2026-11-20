# P1 PWA update — review-fix evidence (2026-11-20)

**Does not claim 1233857 passed.** VM isolated-origin only. Phone/box untested.

## Artifacts

- Old: real `140487b` `client` production build (`hamster-pwa-shell-v1`, install skipWaiting, register-only)
- New: current tip production build (stamped deploy id, no install skipWaiting, React `PwaUpdateBanner`)
- Successive: second tip build with React copy-only change → different asset hash + sw stamp

## Result

pass=true

- `old_140487b_installed`: ok=true
- `retained_old_page_after_new_deploy`: ok=true — First-migration retained 140487b page cannot instantly offer the new React banner; old JS never included it.
- `natural_reopen_new_artifact`: ok=true
- `not_now_defers_activation`: ok=true
- `explicit_reload_after_controllerchange`: ok=true
- `offline_launch`: ok=true
- `reconnect`: ok=true
- `successive_deploy_bundle_only_triggers_banner`: ok=true

## Gaps

- Box Chromium / installed phone PWA not run here
- Full conversation UI proof limited to 3 localStorage continuity keys (not a live chat transcript)
- Parent must delegate any box browser work; this agent did not drive box GUI
