# P1 PWA gaps A–F evidence (2026-11-20)

VM only. Not box/phone. Does not claim 1233857 passed.

## Result

pass=true

- `missing_old_asset_is_404_not_html`: ok=true
- `old_140487b_installed`: ok=true
- `retained_old_assets_safe_before_reload`: ok=true
- `natural_reopen_new_artifact`: ok=true
- `not_now_defers_activation_keeps_old_cache`: ok=true
- `continuity_before_explicit_reload`: ok=true
- `old_assets_still_present_immediately_before_reload_click`: ok=true
- `explicit_reload_after_controllerchange`: ok=true
- `offline_launch`: ok=true
- `reconnect`: ok=true
- `successive_deploy_real_built_assets`: ok=true



## Covered gaps

- A retained old hashed assets present before Reload
- B missing /assets/*.js → 404 not HTML
- C every step has explicit ok boolean
- D asset paths derived from real dist builds
- E (unit) main.tsx registers SW for ConnectGate
- F (unit) tests import production pwaUpdateCore.ts
