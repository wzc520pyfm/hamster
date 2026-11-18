# UI smoke screenshots — narrow shell must-fix recapture

**Not a design-gate pass.** Eve is not frozen. Repo stays private. No merge.

Kept prior evidence:

- From `e4d4b73` (copy must-fixes): `conversation.webp`, `approvals.webp`, `dashboard.webp`.
- From `2f65210` (coverage expansion): desktop/task/control shots, plus the **failure-documenting** narrow set `narrow-dashboard-refresh-failed-retry.webp` (truncated freshness / squeezed column). Those files are intentionally retained and were **not** overwritten.

Product fixes in this pass (narrow shell only; desktop aside unchanged at `md+`):

1. Freshness badges may wrap; words are not clipped or ellipsized. Dashboard header keeps full freshness copy, full timestamp, and **Retry** / **重试** in the 390×844 viewport.
2. Below `md`, the left nav collapses to a top-bar **Menu** / **菜单** drawer so the main column uses the full width. Composer uses a wrapping textarea so the full design-table placeholder stays visible.

Capture helpers: `scripts/capture-ui-smoke-shellfix.sh`, `scripts/ui-smoke-coverage.mjs` (Playwright via `http://localhost:3000`).

## Captured this pass (new or repaired filenames)

| File | State |
| --- | --- |
| `narrow-dashboard-refresh-failed-retry-shellfix.webp` | EN 390×844: full **Refresh failed — still showing last success**, full timestamp, visible **Retry**, last-success layout retained; Menu drawer shell |
| `zh-narrow-dashboard-refresh-failed-retry-shellfix.webp` | ZH 390×844: full **刷新失败，仍保留上次成功结果**, full timestamp, visible **重试**, last-success layout retained |
| `narrow-conversation-shellfix.webp` | EN 390×844 conversation; full composer placeholder **Message Hamster… Use “start task: …” to dispatch.** |
| `zh-narrow-conversation-shellfix.webp` | ZH 390×844; full **给 Hamster 发消息… 用 “start task: …” 派发任务。** |
| `narrow-approval-pending-shellfix.webp` | EN 390×844 pending: **Needs approval** |
| `zh-narrow-approval-pending-shellfix.webp` | ZH 390×844 pending: **需要批准** |
| `zh-task-cancelled.webp` | **Repaired** — complete **已取消** badge + title (prior crop was defective) |
| `zh-task-failed.webp` | **Repaired** — honest **已失败** (prior file was a byte-identical duplicate of `zh-task-succeeded.webp`) |
| `approval-approved-this-action-only.webp` | Optional: **Approved for this action only** |
| `zh-approval-approved-this-action-only.webp` | Optional: **仅批准此次动作** |
| `zh-approval-expired.webp` | Optional: **已过期，未获批准，动作未执行** |
| `zh-approval-denied.webp` | Optional: **已拒绝** |
| `zh-approval-invalidated.webp` | Optional: **已失效，请重新审批** |

## Still unverified

| State | Why |
| --- | --- |
| Dashboard freshness **Stale — still showing last success** / ZH **仍显示上次成功结果** | Schema + UI support `freshness=stale`, but no product path sets it. Not faked. |
| ZH **Queued** / **Running** | Ephemeral windows; not re-held in this pass. Leave unverified. |

## Notes

- `narrow-dashboard-refresh-failed-retry.webp` from `2f65210` remains as the pre-fix failure record; use `*-shellfix.webp` for the corrected narrow behavior.
- No design-table status words were synonym-rewritten. No Line A/B, approval, or lease contract changes. No Hermes. No eve freeze claim.
- Do **not** treat this folder or CI/CodeRabbit as a design-gate pass.
