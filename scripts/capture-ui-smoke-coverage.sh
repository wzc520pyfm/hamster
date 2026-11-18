#!/usr/bin/env bash
# Orchestrate honest UI smoke captures for missing design-table states.
# Keeps e4d4b73 shots; writes NEW files under docs/evidence/ui-smoke/.
# Not a design-gate pass.
set -euo pipefail

export PATH="${HOME}/.nvm/versions/node/v24.22.3/bin:${PATH}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_BASE="${API_BASE:-http://127.0.0.1:8080}"
# Must match HAMSTER_CORS_ORIGIN (localhost, not 127.0.0.1).
CLIENT_BASE="${CLIENT_BASE:-http://localhost:3000}"
OUT="$ROOT/docs/evidence/ui-smoke"
INTERNAL_SECRET="${HAMSTER_INTERNAL_SECRET:-dev-internal-secret}"
export CLIENT_BASE API_BASE
mkdir -p "$OUT"

log() { printf '[capture] %s\n' "$*"; }

shot() {
  local name="$1"; shift
  if ! node "$ROOT/scripts/ui-smoke-coverage.mjs" shot "$name" "$@"; then
    log "WARN: shot failed: $name $*"
    return 1
  fi
  return 0
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

wait_control_status() {
  local task="$1" want="$2" tries="${3:-40}"
  local i st
  for i in $(seq 1 "$tries"); do
    st="$(api GET "/api/tasks/$task" | python3 -c 'import json,sys; d=json.load(sys.stdin); c=d.get("controls") or []; print(c[-1]["status"] if c else "")')"
    if [[ "$st" == "$want" ]]; then
      echo "$st"
      return 0
    fi
    sleep 0.5
  done
  echo "$st"
  return 1
}

eve_pids() {
  pgrep -f '/workspace/agent/.output/server/index.mjs|/workspace/agent/node_modules/.bin/eve start' || true
}

restart_api() {
  local secret="$1"
  local pid
  pid="$(pgrep -f '/workspace/api.*node index.js|node index.js' | head -1 || true)"
  # Prefer cwd-based
  for p in $(pgrep -f 'node index.js' || true); do
    if [[ "$(readlink -f /proc/$p/cwd 2>/dev/null || true)" == "/workspace/api" ]]; then
      pid="$p"
      break
    fi
  done
  if [[ -n "${pid:-}" ]]; then
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
  cd /workspace/api
  DATABASE_URL="${DATABASE_URL:-postgres://hamster:changeme@127.0.0.1:5432/hamster}" \
  HAMSTER_INTERNAL_SECRET="$secret" \
  HAMSTER_APPROVAL_TTL_SECONDS="${HAMSTER_APPROVAL_TTL_SECONDS:-600}" \
  HAMSTER_CORS_ORIGIN=http://localhost:3000 \
  HAMSTER_AGENT_USERNAME=hamster \
  HAMSTER_AGENT_PASSWORD=dev-agent-password \
  EVE_API_URL=http://127.0.0.1:8081 \
  PORT=8080 \
  nohup node index.js > /tmp/api.log 2>&1 &
  sleep 1
  api GET /api/health >/dev/null
  log "api restarted with INTERNAL_SECRET length=${#secret}"
}

# ---------------------------------------------------------------------------
log "reset DB for clean coverage conversation"
sudo -u postgres psql -d hamster -c \
  "TRUNCATE conversations, messages, tasks, task_events, task_controls, assets, asset_snapshots, approvals, audit_log RESTART IDENTITY CASCADE;" \
  >/dev/null
sudo -u postgres psql -d hamster -c "ALTER TABLE IF EXISTS metrics_weekly_bak RENAME TO metrics_weekly;" >/dev/null 2>&1 || true

CONV="$(api GET /api/conversations/current | python3 -c 'import json,sys; print(json.load(sys.stdin)["conversationId"])')"
log "conversation=$CONV"

# ===========================================================================
# 1) Queued — INSERT is queued while createSession hangs under SIGSTOP eve
# ===========================================================================
log "=== Queued ==="
EVE_MAIN="$(pgrep -f '/workspace/agent/.output/server/index.mjs' | head -1)"
if [[ -z "$EVE_MAIN" ]]; then
  log "SKIP Queued: eve server pid not found"
else
  kill -STOP "$EVE_MAIN"
  log "SIGSTOP eve pid=$EVE_MAIN"
  # Fire create in background; it will hang in createSession
  api POST "/api/conversations/$CONV/messages" \
    '{"text":"start task: Capture queued status dashboard"}' > /tmp/queued-create.json &
  CREATE_PID=$!
  QUEUED_TASK=""
  for i in $(seq 1 30); do
    QUEUED_TASK="$(api GET "/api/conversations/$CONV/timeline" | python3 -c '
import json,sys
d=json.load(sys.stdin)
for t in d.get("tasks") or []:
  if t.get("status")=="queued":
    print(t["taskId"]); break
')"
    if [[ -n "$QUEUED_TASK" ]]; then
      break
    fi
    sleep 0.4
  done
  if [[ -n "$QUEUED_TASK" ]]; then
    log "queued task=$QUEUED_TASK"
    if shot queued --url / --locale en --wait-text Queued --out "$OUT/task-queued.png"; then
      to_webp "$OUT/task-queued.png" "$OUT/task-queued.webp"
    fi
  else
    log "SKIP Queued: never observed queued via timeline while spawn hung"
  fi
  kill "$CREATE_PID" 2>/dev/null || true
  wait "$CREATE_PID" 2>/dev/null || true
  kill -CONT "$EVE_MAIN" 2>/dev/null || true
  sleep 2
  if [[ -n "$QUEUED_TASK" ]]; then
    api POST "/api/tasks/$QUEUED_TASK/cancel" '{}' >/dev/null || true
  fi
fi

# ===========================================================================
# 2) Running + Waiting for approval + pending Needs approval
# ===========================================================================
log "=== Running / Waiting / Needs approval ==="
START="$(api POST "/api/conversations/$CONV/messages" '{"text":"start task: Build weekly metrics dashboard"}')"
TASK_RUN="$(printf '%s' "$START" | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["taskId"])')"
log "task=$TASK_RUN"
# Running window: checkpoints delay
if wait_task_status "$TASK_RUN" running 15 >/dev/null; then
  if shot running --url / --locale en --wait-text Running --scroll-text "Build weekly metrics dashboard" --out "$OUT/task-running.png"; then
    to_webp "$OUT/task-running.png" "$OUT/task-running.webp"
  fi
else
  log "NOTE: Running window missed for $TASK_RUN"
fi

wait_task_status "$TASK_RUN" waiting_for_approval 60 >/dev/null
shot waiting --url / --locale en --wait-text "Waiting for approval" --scroll-text "Build weekly metrics dashboard" --out "$OUT/task-waiting-for-approval.png" \
  && to_webp "$OUT/task-waiting-for-approval.png" "$OUT/task-waiting-for-approval.webp"

shot pending-appr --url /approvals --locale en --wait-text "Needs approval" --out "$OUT/approval-pending-needs-approval.png" \
  && to_webp "$OUT/approval-pending-needs-approval.png" "$OUT/approval-pending-needs-approval.webp"

shot waiting-zh --url / --locale zh --wait-text "等待审批" --out "$OUT/zh-task-waiting-for-approval.png" \
  && to_webp "$OUT/zh-task-waiting-for-approval.png" "$OUT/zh-task-waiting-for-approval.webp"
shot pending-zh --url /approvals --locale zh --wait-text "需要批准" --out "$OUT/zh-approval-pending-needs-approval.png" \
  && to_webp "$OUT/zh-approval-pending-needs-approval.png" "$OUT/zh-approval-pending-needs-approval.webp"

shot pending-narrow --url /approvals --locale en --width 390 --height 844 --wait-text "Needs approval" --out "$OUT/narrow-approval-pending-needs-approval.png" \
  && to_webp "$OUT/narrow-approval-pending-needs-approval.png" "$OUT/narrow-approval-pending-needs-approval.webp"

# ===========================================================================
# 3) Control: Pending apply (deliver ok, acknowledge blocked via API secret)
# ===========================================================================
log "=== Control Pending apply ==="
# Keep eve; restart API with mismatched internal secret so acknowledge_control fails.
restart_api "blocked-for-pending-apply-capture"
STEER_PA="$(api POST "/api/tasks/$TASK_RUN/steer" '{"message":"Prefer a denser KPI strip for this task only"}')"
echo "$STEER_PA" > /tmp/steer-pending-apply.json
log "steer pending_apply response: $STEER_PA"
if wait_control_status "$TASK_RUN" pending_apply 20 >/dev/null; then
  shot ctrl-pa --url / --locale en --wait-text "Pending apply" --scroll-text "Pending apply" --out "$OUT/control-pending-apply.png" && \
  to_webp "$OUT/control-pending-apply.png" "$OUT/control-pending-apply.webp"
  shot ctrl-pa-zh --url / --locale zh --wait-text "待应用" --out "$OUT/zh-control-pending-apply.png" && \
  to_webp "$OUT/zh-control-pending-apply.png" "$OUT/zh-control-pending-apply.webp"
else
  log "SKIP Pending apply: control status=$(api GET /api/tasks/$TASK_RUN | python3 -c 'import json,sys; c=json.load(sys.stdin).get("controls") or []; print(c[-1] if c else None)')"
fi
# Restore API secret
restart_api "$INTERNAL_SECRET"

# ===========================================================================
# 4) Control: Applied (normal steer + acknowledge)
# ===========================================================================
log "=== Control Applied ==="
# Task may still be running after invalidated approval; start fresh sibling if needed
START2="$(api POST "/api/conversations/$CONV/messages" '{"text":"start task: Compose ops summary dashboard"}')"
TASK2="$(printf '%s' "$START2" | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["taskId"])')"
wait_task_status "$TASK2" waiting_for_approval 60 >/dev/null || wait_task_status "$TASK2" running 30 >/dev/null || true
STEER_AP="$(api POST "/api/tasks/$TASK2/steer" '{"message":"Emphasize exceptions for this task only"}')"
echo "$STEER_AP" > /tmp/steer-applied.json
if wait_control_status "$TASK2" applied 40 >/dev/null; then
  shot ctrl-ap --url / --locale en --wait-text Applied --scroll-text Applied --out "$OUT/control-applied.png" && \
  to_webp "$OUT/control-applied.png" "$OUT/control-applied.webp"
  shot ctrl-ap-zh --url / --locale zh --wait-text "已应用" --out "$OUT/zh-control-applied.png" && \
  to_webp "$OUT/zh-control-applied.png" "$OUT/zh-control-applied.webp"
else
  log "SKIP Applied: $(api GET /api/tasks/$TASK2 | python3 -c 'import json,sys; c=json.load(sys.stdin).get("controls") or []; print(c[-1] if c else None)')"
fi

# ===========================================================================
# 5) Control: Received (eve unreachable → deliver fails)
# ===========================================================================
log "=== Control Received ==="
START3="$(api POST "/api/conversations/$CONV/messages" '{"text":"start task: Incident response board"}')"
TASK3="$(printf '%s' "$START3" | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["taskId"])')"
wait_task_status "$TASK3" waiting_for_approval 60 >/dev/null || wait_task_status "$TASK3" running 20 >/dev/null || true
EVE_MAIN="$(pgrep -f '/workspace/agent/.output/server/index.mjs' | head -1)"
if [[ -n "$EVE_MAIN" ]]; then
  kill -STOP "$EVE_MAIN"
  STEER_R="$(api POST "/api/tasks/$TASK3/steer" '{"message":"Hold publish for this task only"}' || true)"
  echo "$STEER_R" > /tmp/steer-received.json
  # sendMessage may hang under STOP — use timeout
  if ! printf '%s' "$STEER_R" | grep -q receipt; then
    # hung? try with curl max-time while stopped
    STEER_R="$(curl -sS --max-time 3 -X POST "$API_BASE/api/tasks/$TASK3/steer" \
      -H 'content-type: application/json' -d '{"message":"Hold publish for this task only"}' || true)"
    echo "$STEER_R" > /tmp/steer-received.json
  fi
  # If still hung with no response, CONT briefly won't help until curl returns.
  # Prefer: CONT after ensuring control row exists as received via direct check.
  sleep 1
  # Force-complete hung curl by CONT then re-steer after ensuring prior control
  kill -CONT "$EVE_MAIN" 2>/dev/null || true
  sleep 1
  # Re-do Received with a hard failure path: stop eve TCP by killing server briefly
fi

# More reliable Received: kill eve server so sendMessage throws quickly
log "Received via eve stop (sendMessage fails)"
# Find npm/eve wrappers
EVE_PIDS="$(eve_pids)"
if [[ -n "$EVE_PIDS" ]]; then
  # Start task 4 while eve up
  START4="$(api POST "/api/conversations/$CONV/messages" '{"text":"start task: Received receipt capture"}')"
  TASK4="$(printf '%s' "$START4" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("task",{}).get("taskId",""))')"
  if [[ -n "$TASK4" ]]; then
    wait_task_status "$TASK4" running 20 >/dev/null || true
    # Stop eve processes
    for p in $EVE_PIDS; do kill -STOP "$p" 2>/dev/null || true; done
    # Use short curl timeout — under STOP connect may hang; also try stopping network by CONT+kill
    for p in $EVE_PIDS; do kill -CONT "$p" 2>/dev/null || true; done
    for p in $EVE_PIDS; do kill "$p" 2>/dev/null || true; done
    sleep 1
    STEER_R="$(api POST "/api/tasks/$TASK4/steer" '{"message":"Pause side effects for this task only"}')"
    echo "$STEER_R" > /tmp/steer-received2.json
    log "steer received response: $STEER_R"
    if wait_control_status "$TASK4" received 10 >/dev/null; then
      # Client still up; restart eve later for other shots
      shot ctrl-r --url / --locale en --wait-text Received --scroll-text Received --out "$OUT/control-received.png" && \
      to_webp "$OUT/control-received.png" "$OUT/control-received.webp"
      shot ctrl-r-zh --url / --locale zh --wait-text "已收到" --out "$OUT/zh-control-received.png" && \
      to_webp "$OUT/zh-control-received.png" "$OUT/zh-control-received.webp"
    else
      log "SKIP Received: $(api GET /api/tasks/$TASK4 | python3 -c 'import json,sys; c=json.load(sys.stdin).get("controls") or []; print(c[-1] if c else None)')"
    fi
  fi
  # Restart eve
  log "restarting eve"
  cd /workspace/agent
  HAMSTER_INTERNAL_SECRET="$INTERNAL_SECRET" \
  HAMSTER_STEP_DELAY_MS=2000 \
  nohup npx eve start --host 127.0.0.1 --port 8081 > /tmp/eve.log 2>&1 &
  sleep 4
fi

# ===========================================================================
# 6) Succeeded — approve publish on a fresh task
# ===========================================================================
log "=== Succeeded ==="
START5="$(api POST "/api/conversations/$CONV/messages" '{"text":"start task: Succeeded capture dashboard"}')"
TASK5="$(printf '%s' "$START5" | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["taskId"])')"
wait_task_status "$TASK5" waiting_for_approval 60 >/dev/null
APPR5="$(api GET /api/approvals | TASK5="$TASK5" python3 -c 'import json,sys,os
tid=os.environ["TASK5"]
for a in json.load(sys.stdin):
  if a.get("taskId")==tid and a.get("status")=="pending":
    print(a["id"]); break
')"
log "approve $APPR5 for $TASK5"
api POST "/api/approvals/$APPR5/approve" '{"decidedBy":"local-user"}' >/dev/null
wait_task_status "$TASK5" succeeded 40 >/dev/null
ASSET5="$(api GET "/api/tasks/$TASK5" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("assetId") or "")')"
shot succeeded --url / --locale en --wait-text Succeeded --scroll-text "Succeeded capture dashboard" --out "$OUT/task-succeeded.png" && \
to_webp "$OUT/task-succeeded.png" "$OUT/task-succeeded.webp"
shot succeeded-zh --url / --locale zh --wait-text "已成功" --out "$OUT/zh-task-succeeded.png" && \
to_webp "$OUT/zh-task-succeeded.png" "$OUT/zh-task-succeeded.webp"

# ===========================================================================
# 7) Cancelled
# ===========================================================================
log "=== Cancelled ==="
START6="$(api POST "/api/conversations/$CONV/messages" '{"text":"start task: Cancelled capture dashboard"}')"
TASK6="$(printf '%s' "$START6" | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["taskId"])')"
wait_task_status "$TASK6" running 20 >/dev/null || true
api POST "/api/tasks/$TASK6/cancel" '{}' >/dev/null
wait_task_status "$TASK6" cancelled 20 >/dev/null
shot cancelled --url / --locale en --wait-text Cancelled --scroll-text "Cancelled capture dashboard" --out "$OUT/task-cancelled.png" && \
to_webp "$OUT/task-cancelled.png" "$OUT/task-cancelled.webp"
shot cancelled-zh --url / --locale zh --wait-text "已取消" --out "$OUT/zh-task-cancelled.png" && \
to_webp "$OUT/zh-task-cancelled.png" "$OUT/zh-task-cancelled.webp"

# Narrow conversation showing a terminal badge
shot narrow-conv --url / --locale en --width 390 --height 844 --wait-text Cancelled --out "$OUT/narrow-conversation.png" && \
to_webp "$OUT/narrow-conversation.png" "$OUT/narrow-conversation.webp"

# ===========================================================================
# 8) Dashboard refresh_failed + Retry (honest forced named-query outage)
# ===========================================================================
log "=== Dashboard refresh_failed ==="
if [[ -z "${ASSET5:-}" ]]; then
  ASSET5="$(api GET /api/assets | python3 -c 'import json,sys; a=json.load(sys.stdin); print(a[0]["assetId"] if a else "")')"
fi
if [[ -n "$ASSET5" ]]; then
  sudo -u postgres psql -d hamster -c 'ALTER TABLE metrics_weekly RENAME TO metrics_weekly_bak;' >/dev/null
  api POST "/api/assets/$ASSET5/refresh" '{}' >/dev/null || true
  FRESH="$(api GET "/api/assets/$ASSET5" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("freshness"))')"
  log "freshness=$FRESH asset=$ASSET5"
  shot dash-fail --url "/assets/$ASSET5" --locale en --wait-text "Refresh failed — still showing last success" --out "$OUT/dashboard-refresh-failed-retry.png" && \
  to_webp "$OUT/dashboard-refresh-failed-retry.png" "$OUT/dashboard-refresh-failed-retry.webp"
  shot dash-fail-zh --url "/assets/$ASSET5" --locale zh --wait-text "刷新失败，仍保留上次成功结果" --out "$OUT/zh-dashboard-refresh-failed-retry.png" && \
  to_webp "$OUT/zh-dashboard-refresh-failed-retry.png" "$OUT/zh-dashboard-refresh-failed-retry.webp"
  shot dash-fail-narrow --url "/assets/$ASSET5" --locale en --width 390 --height 844 --wait-text "Refresh failed — still showing last success" --out "$OUT/narrow-dashboard-refresh-failed-retry.png" && \
  to_webp "$OUT/narrow-dashboard-refresh-failed-retry.png" "$OUT/narrow-dashboard-refresh-failed-retry.webp"
  sudo -u postgres psql -d hamster -c 'ALTER TABLE metrics_weekly_bak RENAME TO metrics_weekly;' >/dev/null
else
  log "SKIP refresh_failed: no asset"
fi

log "DONE captures. Listing:"
ls -la "$OUT"/*.webp