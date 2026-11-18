#!/usr/bin/env bash
# Recapture after narrow-shell must-fixes. Does NOT overwrite 2f65210 failure shots.
# Not a design-gate pass.
set -euo pipefail

export PATH="${HOME}/.nvm/versions/node/v24.22.3/bin:${PATH}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_BASE="${API_BASE:-http://127.0.0.1:8080}"
CLIENT_BASE="${CLIENT_BASE:-http://localhost:3000}"
OUT="$ROOT/docs/evidence/ui-smoke"
export CLIENT_BASE API_BASE
mkdir -p "$OUT"

log() { printf '[shellfix] %s\n' "$*"; }

shot() {
  local name="$1"; shift
  node "$ROOT/scripts/ui-smoke-coverage.mjs" shot "$name" "$@"
}

to_webp() {
  local png="$1" webp="$2"
  ffmpeg -y -loglevel error -i "$png" -c:v libwebp -quality 90 "$webp"
  rm -f "$png"
  log "wrote $webp"
}

api() {
  local method="$1" path="$2" data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -sS -X "$method" "$API_BASE$path" -H 'content-type: application/json' -d "$data"
  else
    curl -sS -X "$method" "$API_BASE$path"
  fi
}

wait_task_status() {
  local task="$1" want="$2" tries="${3:-60}"
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

CONV="$(api GET /api/conversations/current | python3 -c 'import json,sys; print(json.load(sys.stdin)["conversationId"])')"
log "conversation=$CONV"

# Prefer existing refresh_failed asset; else force one from a fresh asset.
ASSET="$(api GET /api/assets | python3 -c '
import json,sys
assets=json.load(sys.stdin)
for a in assets:
  if a.get("freshness")=="refresh_failed":
    print(a["assetId"]); break
')"
if [[ -z "$ASSET" ]]; then
  ASSET="$(api GET /api/assets | python3 -c 'import json,sys; a=json.load(sys.stdin); print(a[0]["assetId"] if a else "")')"
  log "forcing refresh_failed on $ASSET"
  sudo -u postgres psql -d hamster -c 'ALTER TABLE metrics_weekly RENAME TO metrics_weekly_bak;' >/dev/null
  api POST "/api/assets/$ASSET/refresh" '{}' >/dev/null || true
  RESTORED=0
else
  log "using existing refresh_failed asset=$ASSET"
  RESTORED=1
fi

FRESH="$(api GET "/api/assets/$ASSET" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("freshness"))')"
log "freshness=$FRESH"
if [[ "$FRESH" != "refresh_failed" ]]; then
  log "WARN: expected refresh_failed, got $FRESH — forcing"
  sudo -u postgres psql -d hamster -c 'ALTER TABLE metrics_weekly RENAME TO metrics_weekly_bak;' >/dev/null || true
  api POST "/api/assets/$ASSET/refresh" '{}' >/dev/null || true
  RESTORED=0
fi

# --- Required: EN + ZH narrow dashboard refresh-failed (new filenames) ---
shot dash-en-n --url "/assets/$ASSET" --locale en --width 390 --height 844 \
  --wait-text "Refresh failed — still showing last success" \
  --out "$OUT/narrow-dashboard-refresh-failed-retry-shellfix.png"
to_webp "$OUT/narrow-dashboard-refresh-failed-retry-shellfix.png" \
  "$OUT/narrow-dashboard-refresh-failed-retry-shellfix.webp"

shot dash-zh-n --url "/assets/$ASSET" --locale zh --width 390 --height 844 \
  --wait-text "刷新失败，仍保留上次成功结果" \
  --out "$OUT/zh-narrow-dashboard-refresh-failed-retry-shellfix.png"
to_webp "$OUT/zh-narrow-dashboard-refresh-failed-retry-shellfix.png" \
  "$OUT/zh-narrow-dashboard-refresh-failed-retry-shellfix.webp"

# Always restore named-query table if we (or a prior step) left it renamed.
sudo -u postgres psql -d hamster -c "DO \$\$ BEGIN IF to_regclass('public.metrics_weekly_bak') IS NOT NULL AND to_regclass('public.metrics_weekly') IS NULL THEN EXECUTE 'ALTER TABLE metrics_weekly_bak RENAME TO metrics_weekly'; END IF; END \$\$;" >/dev/null

# --- Required: EN + ZH narrow conversation (full composer placeholder) ---
shot conv-en-n --url / --locale en --width 390 --height 844 \
  --wait-placeholder "Message Hamster… Use “start task: …” to dispatch." \
  --out "$OUT/narrow-conversation-shellfix.png"
to_webp "$OUT/narrow-conversation-shellfix.png" "$OUT/narrow-conversation-shellfix.webp"

shot conv-zh-n --url / --locale zh --width 390 --height 844 \
  --wait-placeholder "给 Hamster 发消息… 用 “start task: …” 派发任务。" \
  --out "$OUT/zh-narrow-conversation-shellfix.png"
to_webp "$OUT/zh-narrow-conversation-shellfix.png" "$OUT/zh-narrow-conversation-shellfix.webp"

# Assert placeholders are fully present (attribute) after shots
node - <<'NODE'
const { chromium } = require('/workspace/client/node_modules/playwright')
const checks = [
  { locale: 'en', want: 'Message Hamster… Use “start task: …” to dispatch.' },
  { locale: 'zh', want: '给 Hamster 发消息… 用 “start task: …” 派发任务。' },
]
;(async () => {
  const browser = await chromium.launch({ headless: true })
  for (const c of checks) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' })
    if (c.locale === 'zh') await page.getByTestId('locale-zh').locator('visible=true').first().click()
    await page.waitForTimeout(300)
    const ph = await page.locator('textarea').getAttribute('placeholder')
    if (ph !== c.want) {
      console.error('PLACEHOLDER MISMATCH', c.locale, ph)
      process.exit(1)
    }
    console.log('placeholder OK', c.locale)
    await page.close()
  }
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
NODE

# --- Fix: complete ZH Cancelled badge (replace defective crop) ---
shot cancelled-zh --url / --locale zh --width 1280 --height 900 \
  --wait-text "已取消" --scroll-text "Cancelled capture dashboard" \
  --out "$OUT/zh-task-cancelled.png"
to_webp "$OUT/zh-task-cancelled.png" "$OUT/zh-task-cancelled.webp"

# --- Fix: honest ZH Failed (was duplicate of succeeded) ---
shot failed-zh --url / --locale zh --width 1280 --height 900 \
  --wait-text "已失败" --scroll-text "Incident response board" \
  --out "$OUT/zh-task-failed.png"
to_webp "$OUT/zh-task-failed.png" "$OUT/zh-task-failed.webp"

# --- Cheap: narrow pending approval EN+ZH if we can create one ---
log "=== pending approval for narrow ==="
START="$(api POST "/api/conversations/$CONV/messages" '{"text":"start task: Shellfix pending approval board"}')"
TASK="$(printf '%s' "$START" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("task",{}).get("taskId",""))' || true)"
if [[ -n "$TASK" ]] && wait_task_status "$TASK" waiting_for_approval 90 >/dev/null; then
  shot appr-en-n --url /approvals --locale en --width 390 --height 844 \
    --wait-text "Needs approval" \
    --out "$OUT/narrow-approval-pending-shellfix.png"
  to_webp "$OUT/narrow-approval-pending-shellfix.png" "$OUT/narrow-approval-pending-shellfix.webp"
  shot appr-zh-n --url /approvals --locale zh --width 390 --height 844 \
    --wait-text "需要批准" \
    --out "$OUT/zh-narrow-approval-pending-shellfix.png"
  to_webp "$OUT/zh-narrow-approval-pending-shellfix.png" "$OUT/zh-narrow-approval-pending-shellfix.webp"

  # Optional: Approved for this action only / 仅批准此次动作
  APPR="$(api GET /api/approvals | TASK="$TASK" python3 -c '
import json,sys,os
tid=os.environ["TASK"]
for a in json.load(sys.stdin):
  if a.get("taskId")==tid and a.get("status")=="pending":
    print(a["id"]); break
')"
  if [[ -n "$APPR" ]]; then
    api POST "/api/approvals/$APPR/approve" '{"decidedBy":"local-user"}' >/dev/null || true
    shot approved-en --url /approvals --locale en --width 1280 --height 900 \
      --wait-text "Approved for this action only" --scroll-text "Approved for this action only" \
      --out "$OUT/approval-approved-this-action-only.png" || true
    if [[ -f "$OUT/approval-approved-this-action-only.png" ]]; then
      to_webp "$OUT/approval-approved-this-action-only.png" "$OUT/approval-approved-this-action-only.webp"
    fi
    shot approved-zh --url /approvals --locale zh --width 1280 --height 900 \
      --wait-text "仅批准此次动作" --scroll-text "仅批准此次动作" \
      --out "$OUT/zh-approval-approved-this-action-only.png" || true
    if [[ -f "$OUT/zh-approval-approved-this-action-only.png" ]]; then
      to_webp "$OUT/zh-approval-approved-this-action-only.png" "$OUT/zh-approval-approved-this-action-only.webp"
    fi
  fi
else
  log "SKIP narrow pending approval (task=$TASK)"
fi

# --- Optional: Chinese closed approval copy (expired / denied / invalidated) ---
shot expired-zh --url /approvals --locale zh --width 1280 --height 900 \
  --wait-text "已过期，未获批准，动作未执行" --scroll-text "已过期，未获批准，动作未执行" \
  --out "$OUT/zh-approval-expired.png" || true
if [[ -f "$OUT/zh-approval-expired.png" ]]; then
  to_webp "$OUT/zh-approval-expired.png" "$OUT/zh-approval-expired.webp"
fi

shot invalidated-zh --url /approvals --locale zh --width 1280 --height 900 \
  --wait-text "已失效，请重新审批" --scroll-text "已失效，请重新审批" \
  --out "$OUT/zh-approval-invalidated.png" || true
if [[ -f "$OUT/zh-approval-invalidated.png" ]]; then
  to_webp "$OUT/zh-approval-invalidated.png" "$OUT/zh-approval-invalidated.webp"
fi

# Denied: create pending then deny if none exists
HAS_DENIED="$(api GET /api/approvals | python3 -c 'import json,sys; print(any(a.get("status")=="denied" for a in json.load(sys.stdin)))')"
if [[ "$HAS_DENIED" != "True" ]]; then
  log "creating deny for 已拒绝 shot"
  START2="$(api POST "/api/conversations/$CONV/messages" '{"text":"start task: Shellfix deny board"}')"
  TASK2="$(printf '%s' "$START2" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("task",{}).get("taskId",""))' || true)"
  if [[ -n "$TASK2" ]] && wait_task_status "$TASK2" waiting_for_approval 90 >/dev/null; then
    APPR2="$(api GET /api/approvals | TASK2="$TASK2" python3 -c '
import json,sys,os
tid=os.environ["TASK2"]
for a in json.load(sys.stdin):
  if a.get("taskId")==tid and a.get("status")=="pending":
    print(a["id"]); break
')"
    if [[ -n "$APPR2" ]]; then
      api POST "/api/approvals/$APPR2/deny" '{"decidedBy":"local-user"}' >/dev/null || true
    fi
  fi
fi
shot denied-zh --url /approvals --locale zh --width 1280 --height 900 \
  --wait-text "已拒绝" --scroll-text "已拒绝" \
  --out "$OUT/zh-approval-denied.png" || true
if [[ -f "$OUT/zh-approval-denied.png" ]]; then
  to_webp "$OUT/zh-approval-denied.png" "$OUT/zh-approval-denied.webp"
fi

log "DONE. New/updated webp:"
ls -la "$OUT"/*shellfix*.webp "$OUT"/zh-task-cancelled.webp "$OUT"/zh-task-failed.webp \
  "$OUT"/approval-approved-this-action-only.webp "$OUT"/zh-approval-*.webp 2>/dev/null || true

# Integrity: failed must not equal succeeded
python3 - <<'PY'
import hashlib, pathlib
out = pathlib.Path("/workspace/docs/evidence/ui-smoke")
pairs = [
  ("zh-task-failed.webp", "zh-task-succeeded.webp"),
]
for a,b in pairs:
  pa, pb = out/a, out/b
  if pa.exists() and pb.exists():
    ha = hashlib.md5(pa.read_bytes()).hexdigest()
    hb = hashlib.md5(pb.read_bytes()).hexdigest()
    print(f"{a} md5={ha}")
    print(f"{b} md5={hb}")
    print("DUPLICATE" if ha==hb else "distinct OK")
PY
