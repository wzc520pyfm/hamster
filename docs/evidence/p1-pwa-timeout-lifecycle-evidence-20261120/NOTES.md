# P1 PWA timeout lifecycle evidence (2026-11-20)

VM only. Not box/phone. Does not claim 1233857 passed.
New directory (does not overwrite unit-only `p1-pwa-timeout-fix-20261120`).

Timeout / late-controller / no_waiting recovery: unit TAP in sibling commit
(`pwaUpdate.test.mjs`) — this lifecycle run captures MIME / Not now / offline /
EN-ZH banner screenshots from real Chromium against real builds.

## Result

pass=true

- `missing_old_asset_is_404_not_html`: ok=true
- `old_140487b_installed`: ok=true
- `retained_old_page_fetches_old_js_mime_before_reload`: ok=true
- `natural_online_reopen_acquires_new_js_and_banner`: ok=true
- `not_now_defers_activation_old_js_fetch_ok`: ok=true
- `banner_en_sample_isolated_vm`: ok=true
- `banner_zh_sample_isolated_vm`: ok=true
- `continuity_before_explicit_reload`: ok=true
- `old_js_fetch_mime_immediately_before_reload_click`: ok=true
- `explicit_reload_after_controllerchange`: ok=true
- `offline_launch_react_html_and_bundle`: ok=true
- `reconnect`: ok=true
- `successive_deploy_real_built_assets`: ok=true



## Boundaries

- `reg.update()` used only as labeled test accelerator on retained page — not automatic discovery proof.
- Legacy old-client migration limitations remain explicit where banner timing is soft.
