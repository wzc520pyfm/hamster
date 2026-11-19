#!/usr/bin/env bash
# Recapture closed-state approval footers after approvalDecisionCopy() locales.
# Exact design-table wording only. Not a design-gate pass. Does not fake Stale.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_BASE="${API_BASE:-http://127.0.0.1:8080}"
# Must match HAMSTER_CORS_ORIGIN (default http://localhost:3000).
CLIENT_BASE="${CLIENT_BASE:-http://localhost:3000}"
OUT="$ROOT/docs/evidence/ui-smoke"
DB_CMD="${DB_CMD:-sudo docker compose exec -T db psql -U hamster -d hamster}"
export CLIENT_BASE API_BASE ROOT
mkdir -p "$OUT"
cd "$ROOT"

log() { printf '[approval-footers] %s\n' "$*"; }

api() {
  local method="$1" path="$2" data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -sS -X "$method" "$API_BASE$path" -H 'content-type: application/json' -d "$data"
  else
    curl -sS -X "$method" "$API_BASE$path"
  fi
}

wait_task_status() {
  local task="$1" want="$2" tries="${3:-90}"
  local i st
  for i in $(seq 1 "$tries"); do
    st="$(api GET "/api/tasks/$task" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))')"
    if [[ "$st" == "$want" ]]; then
      echo "$st"
      return 0
    fi
    sleep 1
  done
  echo "$st"
  return 1
}

pending_for_task() {
  local task="$1"
  api GET /api/approvals | TASK="$task" python3 -c '
import json,sys,os
tid=os.environ["TASK"]
for a in json.load(sys.stdin):
  if a.get("taskId")==tid and a.get("status")=="pending":
    print(a["id"]); break
'
}

CONV="$(api GET /api/conversations/current | python3 -c 'import json,sys; print(json.load(sys.stdin)["conversationId"])')"
log "conversation=$CONV"

# --- Ensure Approved for this action only ---
HAS_APPROVED="$(api GET /api/approvals | python3 -c 'import json,sys; print(any(a.get("status")=="approved" for a in json.load(sys.stdin)))')"
if [[ "$HAS_APPROVED" != "True" ]]; then
  log "creating approved ticket"
  START="$(api POST "/api/conversations/$CONV/messages" '{"text":"start task: Footer approved board"}')"
  TASK="$(printf '%s' "$START" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("task",{}).get("taskId",""))')"
  wait_task_status "$TASK" waiting_for_approval >/dev/null
  APPR="$(pending_for_task "$TASK")"
  api POST "/api/approvals/$APPR/approve" '{"decidedBy":"local-user"}' >/dev/null
fi

# --- Ensure Denied ---
HAS_DENIED="$(api GET /api/approvals | python3 -c 'import json,sys; print(any(a.get("status")=="denied" for a in json.load(sys.stdin)))')"
if [[ "$HAS_DENIED" != "True" ]]; then
  log "creating denied ticket"
  START="$(api POST "/api/conversations/$CONV/messages" '{"text":"start task: Footer denied board"}')"
  TASK="$(printf '%s' "$START" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("task",{}).get("taskId",""))')"
  wait_task_status "$TASK" waiting_for_approval >/dev/null
  APPR="$(pending_for_task "$TASK")"
  api POST "/api/approvals/$APPR/deny" '{"decidedBy":"local-user"}' >/dev/null
fi

# --- Ensure Expired (real sweeper / insert path) ---
HAS_EXPIRED="$(api GET /api/approvals | python3 -c 'import json,sys; print(any(a.get("status")=="expired" for a in json.load(sys.stdin)))')"
if [[ "$HAS_EXPIRED" != "True" ]]; then
  log "planting expired ticket"
  TASK_ANY="$(api GET /api/approvals | python3 -c 'import json,sys; a=json.load(sys.stdin); print(a[0]["taskId"] if a else "")')"
  if [[ -z "$TASK_ANY" ]]; then
    START="$(api POST "/api/conversations/$CONV/messages" '{"text":"start task: Footer expiry board"}')"
    TASK_ANY="$(printf '%s' "$START" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("task",{}).get("taskId",""))')"
    wait_task_status "$TASK_ANY" waiting_for_approval >/dev/null || true
  fi
  EXPIRY_ID="appr_footer_expiry_$(python3 -c 'import uuid; print(uuid.uuid4().hex[:8])')"
  $DB_CMD -v ON_ERROR_STOP=1 -c \
    "INSERT INTO approvals (id, task_id, action, params, params_hash, status, expires_at)
     VALUES ('$EXPIRY_ID', '$TASK_ANY', 'publish_dashboard', '{\"assetId\":\"none\",\"channel\":\"shared workspace\"}'::jsonb, 'footer-expiry-hash', 'pending', now() - interval '2 seconds');" \
    >/dev/null
  # Periodic sweeper runs every 15s inside the API process.
  for i in $(seq 1 20); do
    HAS_EXPIRED="$(api GET /api/approvals | python3 -c 'import json,sys; print(any(a.get("status")=="expired" for a in json.load(sys.stdin)))')"
    [[ "$HAS_EXPIRED" == "True" ]] && break
    sleep 1
  done
fi

# --- Ensure Invalidated ---
HAS_INV="$(api GET /api/approvals | python3 -c 'import json,sys; print(any(a.get("status")=="invalidated" for a in json.load(sys.stdin)))')"
if [[ "$HAS_INV" != "True" ]]; then
  log "creating invalidated ticket via cancel"
  START="$(api POST "/api/conversations/$CONV/messages" '{"text":"start task: Footer invalidate board"}')"
  TASK="$(printf '%s' "$START" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("task",{}).get("taskId",""))')"
  wait_task_status "$TASK" waiting_for_approval >/dev/null
  api POST "/api/tasks/$TASK/cancel" '{"requestedBy":"local-user"}' >/dev/null
fi

log "approval status mix:"
api GET /api/approvals | python3 -c 'import json,sys; from collections import Counter; print(Counter(a.get("status") for a in json.load(sys.stdin)))'

# Per-card clips so EN/ZH closed states are distinct files (not identical full-page shots).
node --input-type=module <<'NODE'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

const root = process.env.ROOT || process.cwd()
const require = createRequire(path.join(root, 'client/package.json'))
const { chromium } = require('playwright')
const OUT = path.join(root, 'docs/evidence/ui-smoke')
const CLIENT_BASE = process.env.CLIENT_BASE || 'http://localhost:3000'
const shots = [
  { locale: 'en', text: 'Approved for this action only', out: 'approval-approved-this-action-only.webp' },
  { locale: 'en', text: 'Denied', out: 'approval-denied.webp' },
  { locale: 'en', text: 'Expired — not approved, so it did not run', out: 'approval-expired.webp' },
  { locale: 'en', text: 'Invalidated — approve again', out: 'approval-invalidated.webp' },
  { locale: 'zh', text: '仅批准此次动作', out: 'zh-approval-approved-this-action-only.webp' },
  { locale: 'zh', text: '已拒绝', out: 'zh-approval-denied.webp' },
  { locale: 'zh', text: '已过期，未获批准，动作未执行', out: 'zh-approval-expired.webp' },
  { locale: 'zh', text: '已失效，请重新审批', out: 'zh-approval-invalidated.webp' },
]
const browser = await chromium.launch({ headless: true })
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(CLIENT_BASE + '/approvals', { waitUntil: 'networkidle' })
  const id = s.locale === 'zh' ? 'locale-zh' : 'locale-en'
  const visible = page.getByTestId(id).locator('visible=true')
  if ((await visible.count()) > 0) await visible.first().click()
  await page.waitForTimeout(400)
  const article = page.locator('article').filter({ hasText: s.text }).first()
  await article.waitFor({ state: 'visible', timeout: 20000 })
  await article.scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  const png = path.join(OUT, s.out.replace(/\.webp$/, '.png'))
  await article.screenshot({ path: png, type: 'png' })
  await page.close()
  const webp = path.join(OUT, s.out)
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '90', webp], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr || 'ffmpeg failed for ' + s.out)
  fs.unlinkSync(png)
  console.log('[approval-footers] wrote', webp)
}
await browser.close()
NODE

log "DONE closed-state footer recaptures"
ls -la "$OUT"/approval-approved-this-action-only.webp "$OUT"/approval-denied.webp \
  "$OUT"/approval-expired.webp "$OUT"/approval-invalidated.webp \
  "$OUT"/zh-approval-approved-this-action-only.webp "$OUT"/zh-approval-denied.webp \
  "$OUT"/zh-approval-expired.webp "$OUT"/zh-approval-invalidated.webp
