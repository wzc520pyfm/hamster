# UI smoke screenshots (recapture)

Recaptured after the three design must-fixes (not a design-gate pass).

| File | What changed vs prior smoke |
| --- | --- |
| `conversation.webp` | Task cards use design-table **Failed** (not “halted”). Failure reason is on the Task card, anchored by the human-readable title. Chat uses `Failed: “…” (taskId) — …`. No “Needs review after process gap” beside the lifecycle badge. |
| `approvals.webp` | Card titles are plain language (`Publish this dashboard to shared workspace`), not raw `publish_dashboard` / `unknown_action`. Key params only render when params exist. |
| `dashboard.webp` | Unrelated to the three must-fixes; re-confirmed OpenUI asset still renders. |

Do **not** treat these images as a design-gate pass.
