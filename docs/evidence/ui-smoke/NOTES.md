# UI smoke screenshots — coverage expansion

**Not a design-gate pass.** Eve is not frozen. Repo stays private.

Kept from `e4d4b73` (must-fix set): `conversation.webp`, `approvals.webp`, `dashboard.webp`.

New files below were captured on the fixture / `mockModel` / local-equivalent path after that commit. Capture helpers: `scripts/capture-ui-smoke-coverage.sh`, `scripts/ui-smoke-coverage.mjs` (Playwright via `http://localhost:3000` to match CORS).

## Captured (exact design-table copy)

| File | State |
| --- | --- |
| `approval-pending-needs-approval.webp` | Live pending card: **Needs approval** + **Deny** / **Approve this action** |
| `zh-approval-pending-needs-approval.webp` | Same: **需要批准** |
| `narrow-approval-pending-needs-approval.webp` | Same pending approval, 390×844 |
| `task-queued.webp` | Task card **Queued** (observed while `eve.createSession` hung under SIGSTOP) |
| `task-running.webp` | Task card **Running** |
| `task-waiting-for-approval.webp` | Task card **Waiting for approval** |
| `zh-task-waiting-for-approval.webp` | **等待审批** |
| `task-succeeded.webp` | Task card **Succeeded** (after honest approve → consume publish ticket) |
| `zh-task-succeeded.webp` | **已成功** |
| `task-cancelled.webp` | Task card **Cancelled** |
| `zh-task-cancelled.webp` | **已取消** |
| `zh-task-failed.webp` | **已失败** (Failed already in `conversation.webp`) |
| `control-received.webp` | Steer receipt **Received** (eve down → deliver failed; that task only) |
| `zh-control-received.webp` | **已收到** |
| `control-pending-apply.webp` | Steer receipt **Pending apply** (delivered; acknowledge blocked by mismatched internal secret) |
| `zh-control-pending-apply.webp` | **待应用** |
| `control-applied.webp` | Steer/cancel receipt **Applied** |
| `zh-control-applied.webp` | **已应用** |
| `dashboard-refresh-failed-retry.webp` | **Refresh failed — still showing last success** + **Retry**; layout retained |
| `zh-dashboard-refresh-failed-retry.webp` | **刷新失败，仍保留上次成功结果** + **重试** |
| `narrow-dashboard-refresh-failed-retry.webp` | Same freshness/Retry, narrow viewport |
| `narrow-conversation.webp` | Narrow conversation (Cancelled visible) |

## Still unverified

| State | Why |
| --- | --- |
| Dashboard freshness **Stale — still showing last success** / ZH **仍显示上次成功结果** | Schema + UI support `freshness=stale`, but no control-plane or client path sets it on the fixture / local-equivalent path. Not faked. |
| ZH **Queued** / **Running** | Ephemeral windows; EN captured; ZH not re-held for those flashes in this pass. |
| Pending approval ZH narrow | EN narrow captured; ZH narrow skipped as redundant once ZH desktop pending was verified. |

## Contract note (minimal code change for Succeeded)

Honest **Succeeded** required `publish_dashboard` policy params to match the approval ticket produced from `call.requested` input (including `taskId`). Without that, approve left an unconsumed ticket and the worker got `no_valid_ticket` → Failed. Fix: `agent/agent/tools/publish_dashboard.ts` passes the full call input into `policyCheck`. No status-copy changes. No Hermes. No merge.

Do **not** treat this folder as a design-gate pass.
