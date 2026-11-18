#!/usr/bin/env bash
# Hamster P0 contract verification against a running local (or Compose-equivalent) stack.
# This script must FAIL when the contract fails. It does not prove a live-model path;
# leave HAMSTER_MODEL_ID empty to exercise the eve mockModel / fixture worker.
#
# Usage: API_BASE=http://127.0.0.1:8080 ./scripts/verify-p0.sh
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8080}"
INTERNAL_SECRET="${HAMSTER_INTERNAL_SECRET:-dev-internal-secret}"
REPORT_DIR="${REPORT_DIR:-/tmp/hamster-p0-evidence}"
mkdir -p "$REPORT_DIR"
PASS=0
FAIL=0
NOTE=0

log() { printf '%s\n' "$*" | tee -a "$REPORT_DIR/verify.log"; }
pass() { PASS=$((PASS + 1)); log "PASS: $*"; }
fail() { FAIL=$((FAIL + 1)); log "FAIL: $*"; }
note() { NOTE=$((NOTE + 1)); log "NOTE: $*"; }

json_get() {
  local path="$1"
  python3 -c '
import json,sys
doc=json.load(sys.stdin)
cur=doc
for p in sys.argv[1].split("."):
  if not p:
    continue
  cur = cur[int(p)] if isinstance(cur, list) else cur[p]
if isinstance(cur,(dict,list)):
  print(json.dumps(cur))
else:
  print("" if cur is None else cur)
' "$path"
}

req() {
  local method="$1" path="$2" data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -sS -X "$method" "$API_BASE$path" -H 'content-type: application/json' -d "$data"
  else
    curl -sS -X "$method" "$API_BASE$path"
  fi
}

internal() {
  local path="$1" data="$2"
  curl -sS -X POST "$API_BASE$path" \
    -H 'content-type: application/json' \
    -H "x-hamster-internal-secret: $INTERNAL_SECRET" \
    -d "$data"
}

log "=== Hamster P0 verification @ $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
log "API_BASE=$API_BASE"
note "Worker path is eve mockModel/fixture unless HAMSTER_MODEL_ID + provider credentials are set"

# ---------------------------------------------------------------------------
# 1. Health
# ---------------------------------------------------------------------------
health="$(req GET /api/health)"
echo "$health" > "$REPORT_DIR/health.json"
if [[ "$health" == *'"status":"ok"'* ]]; then
  pass "control plane /api/health responds"
else
  fail "control plane /api/health: $health"
fi

conv="$(req GET /api/conversations/current)"
echo "$conv" > "$REPORT_DIR/conversation.json"
CONV_ID="$(printf '%s' "$conv" | json_get conversationId)"
[[ -n "$CONV_ID" ]] && pass "conversationId allocated: $CONV_ID" || fail "no conversationId"

# ---------------------------------------------------------------------------
# 2. Line A — independent ids + follow-up isolation
# ---------------------------------------------------------------------------
start="$(req POST "/api/conversations/$CONV_ID/messages" '{"text":"start task: Build weekly metrics dashboard"}')"
echo "$start" > "$REPORT_DIR/task-created.json"
TASK_ID="$(printf '%s' "$start" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("task",{}).get("taskId",""))')"
STATUS="$(printf '%s' "$start" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("task",{}).get("status",""))')"
RUNTIME="$(printf '%s' "$start" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("task",{}).get("runtimeSessionId") or "")')"
if [[ -n "$TASK_ID" ]]; then
  pass "task created taskId=$TASK_ID status=$STATUS"
else
  fail "task not created: $start"
fi
if [[ -n "$RUNTIME" ]]; then
  pass "runtimeSessionId distinct from taskId: $RUNTIME"
else
  fail "runtimeSessionId missing (eve worker unreachable?)"
fi
if [[ "$TASK_ID" != "$CONV_ID" && "$TASK_ID" != "$RUNTIME" ]]; then
  pass "conversationId / taskId / runtimeSessionId are separate values"
else
  fail "id collision among conversation/task/runtime"
fi

chat="$(req POST "/api/conversations/$CONV_ID/messages" '{"text":"unrelated follow-up: what is the weather metaphorically?"}')"
echo "$chat" > "$REPORT_DIR/followup.json"
task_after="$(req GET "/api/tasks/$TASK_ID")"
echo "$task_after" > "$REPORT_DIR/task-after-followup.json"
status_after="$(printf '%s' "$task_after" | json_get status)"
ctrl_n="$(printf '%s' "$task_after" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("controls") or []))')"
if [[ "$status_after" != "cancelled" && "$ctrl_n" == "0" ]]; then
  pass "ordinary follow-up did not cancel or steer task (status=$status_after, controls=$ctrl_n)"
else
  fail "ordinary follow-up affected worker controls/status status=$status_after controls=$ctrl_n"
fi

progress="$(req POST "/api/conversations/$CONV_ID/messages" '{"text":"progress"}')"
echo "$progress" > "$REPORT_DIR/progress.json"
if printf '%s' "$progress" | grep -q 'events recorded\|No events recorded\|Last persisted event'; then
  pass "progress answered from control-plane persisted state (not model estimate)"
else
  fail "progress reply unexpected: $progress"
fi

# ---------------------------------------------------------------------------
# 3. Wait for asset + approval; steer mid-flight after first event
# ---------------------------------------------------------------------------
STEERED=0
ASSET_ID=""
for i in $(seq 1 50); do
  detail="$(req GET "/api/tasks/$TASK_ID")"
  echo "$detail" > "$REPORT_DIR/task-poll-$i.json"
  ASSET_ID="$(printf '%s' "$detail" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("assetId") or "")')"
  events_n="$(printf '%s' "$detail" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("events") or []))')"
  appr_n="$(printf '%s' "$detail" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("approvals") or []))')"
  ctrl_applied="$(printf '%s' "$detail" | python3 -c 'import json,sys; cs=json.load(sys.stdin).get("controls") or []; print(any(c.get("status")=="applied" and c.get("type")=="steer" for c in cs))')"
  status_now="$(printf '%s' "$detail" | json_get status)"
  log "poll#$i events=$events_n asset=$ASSET_ID approvals=$appr_n steer_applied=$ctrl_applied status=$status_now"
  if [[ "$STEERED" -eq 0 && "$events_n" -ge 1 && "$status_now" == "running" ]]; then
    steer="$(req POST "/api/tasks/$TASK_ID/steer" '{"message":"Prefer conversion over sessions in the summary"}')"
    echo "$steer" > "$REPORT_DIR/steer.json"
    receipt="$(printf '%s' "$steer" | json_get receipt)"
    if [[ "$receipt" == "received" || "$receipt" == "pending_apply" ]]; then
      pass "steer receipt is $receipt (not Applied)"
    else
      fail "unexpected steer receipt: $receipt"
    fi
    STEERED=1
  fi
  if [[ -n "$ASSET_ID" && "$appr_n" -gt 0 ]]; then
    break
  fi
  if [[ -n "$ASSET_ID" && "$status_now" == "waiting_for_approval" ]]; then
    break
  fi
  sleep 2
done

detail="$(req GET "/api/tasks/$TASK_ID")"
events_n="$(printf '%s' "$detail" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("events") or []))')"
if [[ "$events_n" -gt 0 ]]; then
  pass "task has $events_n persisted events (progress source)"
else
  fail "no persisted task events after wait"
fi

steer_status="$(printf '%s' "$detail" | python3 -c 'import json,sys; cs=[c for c in json.load(sys.stdin).get("controls") or [] if c.get("type")=="steer"]; print(cs[-1]["status"] if cs else "")')"
if [[ "$steer_status" == "applied" || "$steer_status" == "pending_apply" || "$steer_status" == "received" ]]; then
  pass "steer control status machine visible as $steer_status"
else
  fail "steer control missing/unexpected: $steer_status"
fi

# ---------------------------------------------------------------------------
# 4. Line B — OpenUI document + refresh contract
# ---------------------------------------------------------------------------
if [[ -z "$ASSET_ID" ]]; then
  fail "no assetId produced by worker within timeout"
else
  pass "assetId created: $ASSET_ID (distinct from task/conversation)"
  asset="$(req GET "/api/assets/$ASSET_ID")"
  echo "$asset" > "$REPORT_DIR/asset.json"
  openui="$(printf '%s' "$asset" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("openui") or "")')"
  layout1="$(printf '%s' "$asset" | json_get layoutVersion)"
  if printf '%s' "$openui" | grep -q 'Query("metrics_weekly"' \
    && printf '%s' "$openui" | grep -q 'root = Stack(' \
    && printf '%s' "$openui" | grep -q 'KpiGrid(metrics.kpis)' \
    && printf '%s' "$openui" | grep -q 'MetricsTable(metrics.rows)'; then
    pass "persisted openui is OpenUI React Lang 1.0 with Query + registered components"
  else
    fail "persisted openui missing required OpenUI Lang shape"
  fi

  refresh_ok="$(req POST "/api/assets/$ASSET_ID/refresh" '{}')"
  echo "$refresh_ok" > "$REPORT_DIR/refresh-ok.json"
  asset2="$(req GET "/api/assets/$ASSET_ID")"
  openui2="$(printf '%s' "$asset2" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("openui") or "")')"
  layout2="$(printf '%s' "$asset2" | json_get layoutVersion)"
  if [[ "$openui2" == "$openui" && "$layout1" == "$layout2" ]]; then
    pass "successful refresh kept identical openui document and layoutVersion=$layout2"
  else
    fail "refresh mutated layout/document"
  fi

  # Force a real named-query failure; assert contract (not a NOTE).
  sudo -u postgres psql -d hamster -c 'ALTER TABLE metrics_weekly RENAME TO metrics_weekly_bak;' >/dev/null
  refresh_fail="$(req POST "/api/assets/$ASSET_ID/refresh" '{}')"
  echo "$refresh_fail" > "$REPORT_DIR/refresh-fail.json"
  asset_fail="$(req GET "/api/assets/$ASSET_ID")"
  echo "$asset_fail" > "$REPORT_DIR/asset-after-refresh-fail.json"
  sudo -u postgres psql -d hamster -c 'ALTER TABLE metrics_weekly_bak RENAME TO metrics_weekly;' >/dev/null

  fail_ok="$(printf '%s' "$refresh_fail" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("ok"))')"
  freshness="$(printf '%s' "$asset_fail" | json_get freshness)"
  openui_fail="$(printf '%s' "$asset_fail" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("openui") or "")')"
  has_data="$(printf '%s' "$asset_fail" | python3 -c 'import json,sys; d=json.load(sys.stdin).get("data") or {}; print(bool(d.get("kpis") or d.get("rows")))')"
  last_success="$(printf '%s' "$asset_fail" | json_get lastSuccessAt)"
  if [[ "$fail_ok" == "False" || "$fail_ok" == "false" ]] \
    && [[ "$freshness" == "refresh_failed" ]] \
    && [[ "$openui_fail" == "$openui" ]] \
    && [[ "$has_data" == "True" ]] \
    && [[ -n "$last_success" && "$last_success" != "None" ]]; then
    pass "forced refresh failure: freshness=refresh_failed, openui unchanged, last success data retained"
  else
    fail "forced refresh failure contract broken ok=$fail_ok freshness=$freshness has_data=$has_data last_success=$last_success"
  fi
fi

# ---------------------------------------------------------------------------
# 5. Approvals — fail-closed + real expiry + invalidate on cancel
# ---------------------------------------------------------------------------
pending="$(req GET '/api/approvals?status=pending')"
echo "$pending" > "$REPORT_DIR/approvals-pending.json"
APPR_ID="$(printf '%s' "$pending" | python3 -c 'import json,sys; a=json.load(sys.stdin); print(a[0]["id"] if a else "")')"
if [[ -n "$APPR_ID" ]]; then
  pass "pending approval ticket exists: $APPR_ID"
else
  fail "no pending approval (publish_dashboard may not have paused)"
fi

deny_pol="$(internal /internal/policy/check "{\"taskId\":\"$TASK_ID\",\"action\":\"publish_dashboard\",\"params\":{\"assetId\":\"${ASSET_ID:-missing}\",\"channel\":\"wrong\"}}")"
echo "$deny_pol" > "$REPORT_DIR/policy-deny.json"
allow="$(printf '%s' "$deny_pol" | json_get allow)"
if [[ "$allow" == "False" || "$allow" == "false" ]]; then
  pass "policy denies publish without matching approved ticket (omit-approval fail-closed)"
else
  fail "policy unexpectedly allowed publish: $deny_pol"
fi

unknown_pol="$(internal /internal/policy/check "{\"taskId\":\"$TASK_ID\",\"action\":\"launch_missiles\",\"params\":{}}")"
echo "$unknown_pol" > "$REPORT_DIR/policy-unknown.json"
if [[ "$(printf '%s' "$unknown_pol" | json_get allow)" == "False" || "$(printf '%s' "$unknown_pol" | json_get allow)" == "false" ]]; then
  pass "policy denies unknown actions"
else
  fail "policy allowed unknown action"
fi

# Real expiry: insert a pending ticket already past expires_at, wait for sweeper.
EXPIRY_NOTE='Expired — not approved, so it did not run'
EXPIRY_ID="appr_expiry_$(python3 -c 'import uuid; print(uuid.uuid4().hex[:8])')"
if [[ -n "$TASK_ID" ]]; then
  sudo -u postgres psql -d hamster -v ON_ERROR_STOP=1 -c \
    "INSERT INTO approvals (id, task_id, action, params, params_hash, status, expires_at)
     VALUES ('$EXPIRY_ID', '$TASK_ID', 'publish_dashboard', '{\"assetId\":\"${ASSET_ID:-none}\",\"channel\":\"shared workspace\"}'::jsonb, 'expiry-demo-hash', 'pending', now() - interval '2 seconds');" \
    >/dev/null
  published_before="$(printf '%s' "$(req GET "/api/assets/${ASSET_ID:-none}")" | python3 -c 'import json,sys; 
try:
 d=json.load(sys.stdin); print(d.get("publishedAt"))
except Exception:
 print("")' 2>/dev/null || true)"
  expired=0
  for _ in $(seq 1 20); do
    sleep 2
    row="$(req GET /api/approvals | python3 -c 'import json,sys; rows=json.load(sys.stdin); print(next((json.dumps(a) for a in rows if a.get("id")==sys.argv[1]), ""))' "$EXPIRY_ID")"
    if [[ -n "$row" ]]; then
      st="$(printf '%s' "$row" | json_get status)"
      note_txt="$(printf '%s' "$row" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("decisionNote") or "")')"
      if [[ "$st" == "expired" && "$note_txt" == "$EXPIRY_NOTE" ]]; then
        expired=1
        echo "$row" > "$REPORT_DIR/approval-expired.json"
        break
      fi
    fi
  done
  if [[ "$expired" -eq 1 ]]; then
    pass "real approval expiry asserted status=expired with exact copy"
  else
    fail "approval did not expire with exact copy within timeout"
  fi
  # Action must not have run via this expired ticket: publish still requires consume-once approved ticket.
  expire_pol="$(internal /internal/policy/check "{\"taskId\":\"$TASK_ID\",\"action\":\"publish_dashboard\",\"params\":{\"assetId\":\"${ASSET_ID:-none}\",\"channel\":\"shared workspace\"}}")"
  echo "$expire_pol" > "$REPORT_DIR/policy-after-expiry.json"
  if [[ "$(printf '%s' "$expire_pol" | json_get allow)" == "False" || "$(printf '%s' "$expire_pol" | json_get allow)" == "false" ]]; then
    pass "expired ticket cannot authorize publish (action did not run)"
  else
    fail "expired/missing ticket still authorized publish: $expire_pol"
  fi
fi

# Sibling + cancel must invalidate unused pending tickets (count must be > 0 when pending existed).
start2="$(req POST "/api/conversations/$CONV_ID/messages" '{"text":"start task: Sibling task that must survive cancel of the first"}')"
TASK2="$(printf '%s' "$start2" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("task",{}).get("taskId",""))')"
echo "$start2" > "$REPORT_DIR/task2-created.json"

pending_before="$(printf '%s' "$(req GET "/api/tasks/$TASK_ID")" | python3 -c 'import json,sys; ap=json.load(sys.stdin).get("approvals") or []; print(sum(1 for a in ap if a.get("status")=="pending"))')"
cancel="$(req POST "/api/tasks/$TASK_ID/cancel" '{}')"
echo "$cancel" > "$REPORT_DIR/cancel.json"
detail1="$(req GET "/api/tasks/$TASK_ID")"
detail2="$(req GET "/api/tasks/$TASK2")"
st1="$(printf '%s' "$detail1" | json_get status)"
st2="$(printf '%s' "$detail2" | json_get status)"
inv="$(printf '%s' "$detail1" | python3 -c 'import json,sys; ap=json.load(sys.stdin).get("approvals") or []; print(sum(1 for a in ap if a.get("status")=="invalidated"))')"
inv_api="$(printf '%s' "$cancel" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("invalidatedApprovals", 0))')"

if [[ "$st1" == "cancelled" ]]; then
  pass "cancel set task1 to cancelled"
else
  fail "cancel did not cancel task1: $st1"
fi
if [[ "$st2" != "cancelled" ]]; then
  pass "cancel did not harm sibling task2 (status=$st2)"
else
  fail "cancel harmed sibling task2"
fi

cancelled_pol="$(internal /internal/policy/check "{\"taskId\":\"$TASK_ID\",\"action\":\"record_task_event\",\"params\":{\"kind\":\"note\",\"step\":null}}")"
if [[ "$(printf '%s' "$cancelled_pol" | json_get allow)" == "False" || "$(printf '%s' "$cancelled_pol" | json_get allow)" == "false" ]]; then
  pass "cancelled task is denied new tool calls at policy layer"
else
  fail "cancelled task still allowed tools: $cancelled_pol"
fi

if [[ "$pending_before" -gt 0 ]]; then
  if [[ "$inv" -gt 0 && "$inv_api" -gt 0 ]]; then
    pass "cancel invalidated unused approvals (pending_before=$pending_before invalidated=$inv api=$inv_api)"
  else
    fail "cancel did not invalidate unused tickets pending_before=$pending_before invalidated=$inv api=$inv_api"
  fi
else
  # Ensure the path still works by planting a pending ticket then cancelling a fresh task.
  note "task1 had no pending left at cancel time; planting explicit pending on sibling path"
  plant_id="appr_plant_$(python3 -c 'import uuid; print(uuid.uuid4().hex[:8])')"
  sudo -u postgres psql -d hamster -c \
    "INSERT INTO approvals (id, task_id, action, params, params_hash, status, expires_at)
     VALUES ('$plant_id', '$TASK2', 'publish_dashboard', '{}'::jsonb, 'plant', 'pending', now() + interval '10 minutes');" \
    >/dev/null
  cancel2="$(req POST "/api/tasks/$TASK2/cancel" '{}')"
  echo "$cancel2" > "$REPORT_DIR/cancel2.json"
  inv2="$(printf '%s' "$cancel2" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("invalidatedApprovals", 0))')"
  if [[ "$inv2" -gt 0 ]]; then
    pass "cancel invalidated planted unused approval (invalidatedApprovals=$inv2)"
  else
    fail "cancel failed to invalidate planted unused approval: $cancel2"
  fi
fi

# Secrets placeholders
grep -R --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.eve --exclude-dir=.output \
  --exclude='*.svg' --exclude='*.lock' -nE '\b(sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|xoxb-[0-9]+-|ghp_[a-zA-Z0-9]{20,})\b' \
  /workspace > /tmp/secret-scan.txt 2>/dev/null || true
if [[ -s /tmp/secret-scan.txt ]]; then
  fail "possible real secrets in tree: $(head -5 /tmp/secret-scan.txt)"
else
  pass "no obvious real secret material committed"
fi

log "=== summary: PASS=$PASS FAIL=$FAIL NOTE=$NOTE ==="
echo "$PASS" > "$REPORT_DIR/pass.count"
echo "$FAIL" > "$REPORT_DIR/fail.count"
[[ "$FAIL" -eq 0 ]]
