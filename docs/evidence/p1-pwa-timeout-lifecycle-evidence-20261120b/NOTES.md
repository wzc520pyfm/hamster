# P1 PWA timeout lifecycle evidence (2026-11-20b)

VM only. Not box/phone. Does not claim 1233857 passed.
New directory (does not overwrite `p1-pwa-timeout-lifecycle-evidence-20261120`).

Timeout / late-controller / no_waiting→already_controlling recovery: unit TAP
(`pwaUpdate.test.mjs`) — this lifecycle run captures MIME / Not now / offline
**React module execution+render** / EN-ZH banner screenshots from real Chromium.

**Disclose:** `cache.put` in old-install step is fixture preparation for retained
MIME/offline probes — not natural SW cache-first proof.

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
- `offline_react_module_execution_and_render`: ok=true
- `reconnect`: ok=true
- `successive_deploy_real_built_assets`: ok=true



## PNG artifacts (readable originals)

| File | SHA-256 | Attachment |
|------|---------|------------|
| `banner-en-react-visible-20261120b.png` | `f4ceb25777cf1919e58f396863e97d543aceb331ce6e53f6055043d7e9174cd3` | [/opt/cursor/artifacts/p1-pwa-timeout-lifecycle-evidence-20261120b/banner-en-react-visible-20261120b.png](/opt/cursor/artifacts/p1-pwa-timeout-lifecycle-evidence-20261120b/banner-en-react-visible-20261120b.png) |
| `banner-zh-react-visible-20261120b.png` | `b20e2e05caac439a3652496c864d60c409812ddc5f30e35d483197b1e0825311` | [/opt/cursor/artifacts/p1-pwa-timeout-lifecycle-evidence-20261120b/banner-zh-react-visible-20261120b.png](/opt/cursor/artifacts/p1-pwa-timeout-lifecycle-evidence-20261120b/banner-zh-react-visible-20261120b.png) |

Verified `file(1)`: PNG image data, 1280x720. New filenames (no overwrite of prior `banner-en.png` / `banner-zh.png`).

## Boundaries

- `reg.update()` used only as labeled test accelerator on retained page — not automatic discovery proof.
- Legacy old-client migration limitations remain explicit where banner timing is soft.
- Offline step asserts `#root` children (React executed), not fetch-only.
- Timeout→late activation→`no_waiting` recovery is unit-tested as `already_controlling` (no reinsert waiting / no forced reload).
