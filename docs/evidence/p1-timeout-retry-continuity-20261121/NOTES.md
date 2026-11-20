# P1 timeout → late activation → user Retry continuity (2026-11-21)

Isolated VM `127.0.0.1` only. Not box/phone. Not live origin. No Docker. No paid providers.

pass=true

## Persistence (source-accurate)

- **React-written localStorage:** `hamster.locale`, `hamster.controlBase`
- **Not written by React:** `hamster.conversation.*` (no such setItem in `client/src`)
- **Server-only:** conversationId / timeline / messages (fixture API labelled seed)
- **Offline:** shell + React keys may persist; **full conversation history is not offline-supported**

## ENGINEERING INJECTION

Suppress navigator.serviceWorker controllerchange listeners for ~5.5s so production waitForControllerChange (4s) times out; production PwaUpdateBanner + applyHamsterPwaUpdate still used

## Steps

- `react_wrote_locale_and_controlBase_plus_fixture_conversation_visible`: ok=true
- `update_banner_visible_prod_react`: ok=true
- `banner_en_png`: ok=true
- `banner_zh_png`: ok=true
- `timeout_no_forced_reload_retry_ui`: ok=true
- `late_activation_waiting_gone_controller_is_active`: ok=true
- `user_retry_reloads_preserves_react_persistence_refetches_fixture_conversation`: ok=true
- `offline_shell_react_persist_keys_server_history_not_claimed`: ok=true
- `reconnect_refetches_fixture_conversation`: ok=true

## PNG SHA-256

- `timeout-retry-banner-en-20261121.png`: `4a106f53ea0513b23a4a2050ad6f93b83c374a13bb2b267ae6e2f55e8464f8a1`
- `timeout-retry-banner-zh-20261121.png`: `ea64f01380a229b857814e280e8330cce390c6a5676bb5a4ca0de234923475d3`
- `timeout-retry-state-zh-20261121.png`: `63772a02ef2280d2be661b97d140dceb89ac1676a7c19d035683581fff7c4ad3`

## Timeout / retry observations

See step `timeout_no_forced_reload_retry_ui` in JSON: ENGINEERING_INJECTION suppressedCount, retry copy, same-document URL, React localStorage keys preserved. PNG `timeout-retry-state-zh-20261121.png` captures the retry UI.

## Untested

- Phone / mobile viewport + install prompt path
- Full multi-turn conversation offline history (server-only; not claimed)
- Box browser / live origin SW cache
- Real Docker worker chain / IndependentDocker
