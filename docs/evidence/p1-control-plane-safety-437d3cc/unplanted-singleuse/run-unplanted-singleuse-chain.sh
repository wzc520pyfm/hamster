#!/usr/bin/env bash
# Unplanted single-use + params_hash chain against a REAL isolated API+DB+eve mockModel worker.
#
# Required chain (no planted approved ticket, no production-policy change):
#   1) production worker issues pending ticket
#   2) real POST /api/approvals/:id/approve
#   3) BEFORE first consumption: wrong params → DENY; same ticket still unconsumed
#   4) EXACT params → first ALLOW; returned ticketId == that ticket
#   5) EXACT params again → DENY
#
# Race mitigation (documented, not a policy change):
#   While the worker-issued ticket is still pending, this script holds
#   SELECT … FOR UPDATE on that approvals row so settle/approve UPDATEs cannot
#   flip status to approved until after the worker's first authorize() attempt.
#   That attempt therefore sees pending → no_valid_ticket.
#   After COMMIT, approve completes; eve is SIGSTOP'd so it cannot later consume.
#   Exact pause/resume timestamps are recorded in timing.jsonl + chain.log.
#
# Required env:
#   API_BASE DB_CMD HAMSTER_INTERNAL_SECRET EVE_PID REPORT_DIR LOCK_DATABASE_URL
set -euo pipefail

API_BASE="${API_BASE:?}"
DB_CMD="${DB_CMD:?}"
INTERNAL_SECRET="${HAMSTER_INTERNAL_SECRET:?}"
REPORT_DIR="${REPORT_DIR:?}"
EVE_PID="${EVE_PID:?}"
LOCK_DATABASE_URL="${LOCK_DATABASE_URL:?}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$REPORT_DIR"
LOG="$REPORT_DIR/chain.log"
TIMING="$REPORT_DIR/timing.jsonl"
: >"$LOG"
: >"$TIMING"

ts() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }
log() { printf '%s %s\n' "$(ts)" "$*" | tee -a "$LOG"; }
timing() {
  printf '{"ts":"%s",%s}\n' "$(ts)" "$1" >>"$TIMING"
  log "TIMING $1"
}

db() { $DB_CMD -v ON_ERROR_STOP=1 "$@"; }

snap_ticket() {
  local label="$1" id="$2"
  local out="$REPORT_DIR/db-${label}.txt"
  {
    echo "=== DB snapshot label=${label} ticket=${id} at $(ts) ==="
    db -c "SELECT id, task_id, action, status, params_hash,
                   consumed_at IS NOT NULL AS consumed,
                   consumed_at, decided_at, expires_at,
                   params::text AS params_json
            FROM approvals WHERE id='${id}';"
    db -c "SELECT id, status, asset_id, updated_at FROM tasks WHERE id=(SELECT task_id FROM approvals WHERE id='${id}');"
  } | tee "$out"
}

raw_curl() {
  local label="$1" method="$2" url="$3" data="${4:-}"
  local body="$REPORT_DIR/${label}.body.json"
  local meta="$REPORT_DIR/${label}.meta.txt"
  local hdr="$REPORT_DIR/${label}.headers.txt"
  local code
  if [[ -n "$data" ]]; then
    printf '%s\n' "$data" >"$REPORT_DIR/${label}.request.json"
    code=$(curl -sS -m 60 -X "$method" "$url" \
      -H 'content-type: application/json' \
      -H "x-hamster-internal-secret: ${INTERNAL_SECRET}" \
      -d "$data" \
      -D "$hdr" \
      -o "$body" \
      -w '%{http_code}')
  else
    : >"$REPORT_DIR/${label}.request.json"
    code=$(curl -sS -m 60 -X "$method" "$url" \
      -H "x-hamster-internal-secret: ${INTERNAL_SECRET}" \
      -D "$hdr" \
      -o "$body" \
      -w '%{http_code}')
  fi
  {
    echo "label=$label"
    echo "method=$method"
    echo "url=$url"
    echo "http_code=$code"
    echo "wall_ts=$(ts)"
  } | tee "$meta"
  log "HTTP $label → $code"
  printf '%s' "$code"
}

policy_check() {
  local label="$1" task="$2" params_json="$3"
  raw_curl "$label" POST "$API_BASE/internal/policy/check" \
    "{\"taskId\":\"${task}\",\"action\":\"publish_dashboard\",\"params\":${params_json}}" >/dev/null
}

log "=== unplanted single-use chain start ==="
log "API_BASE=$API_BASE EVE_PID=$EVE_PID"
timing "\"event\":\"start\",\"eve_pid\":${EVE_PID}"

if [[ ! -d "/proc/${EVE_PID}" ]]; then
  log "FAIL: EVE_PID ${EVE_PID} not running"
  exit 2
fi
log "eve_initial_state=$(awk '{print $3}' "/proc/${EVE_PID}/stat")"

# 1) Create task
raw_curl 01-conversation GET "$API_BASE/api/conversations/current" >/dev/null
CONV_ID=$(python3 -c 'import json; print(json.load(open("'"$REPORT_DIR"'/01-conversation.body.json"))["conversationId"])')
log "conversationId=$CONV_ID"

START_PAYLOAD='{"text":"start task: Unplanted single-use exact-params chain"}'
raw_curl 02-task-create POST "$API_BASE/api/conversations/${CONV_ID}/messages" "$START_PAYLOAD" >/dev/null
TASK_ID=$(python3 -c 'import json; d=json.load(open("'"$REPORT_DIR"'/02-task-create.body.json")); print(d.get("task",{}).get("taskId",""))')
RUNTIME=$(python3 -c 'import json; d=json.load(open("'"$REPORT_DIR"'/02-task-create.body.json")); print(d.get("task",{}).get("runtimeSessionId") or "")')
log "taskId=$TASK_ID runtimeSessionId=$RUNTIME"
if [[ -z "$TASK_ID" || -z "$RUNTIME" ]]; then
  log "FAIL: task/runtime missing"
  exit 3
fi

APPR=""
ASSET=""
POLL_I=0
for i in $(seq 1 90); do
  POLL_I=$i
  label=$(printf '03-task-poll-%02d' "$i")
  raw_curl "$label" GET "$API_BASE/api/tasks/${TASK_ID}" >/dev/null
  eval "$(python3 - "$REPORT_DIR/$label.body.json" "$REPORT_DIR" <<'PY'
import json, sys
path, report = sys.argv[1], sys.argv[2]
d=json.load(open(path))
ap=d.get("approvals") or []
pending=[a for a in ap if a.get("status")=="pending"]
print(f'STATUS={d.get("status")!r}')
print(f'ASSET={d.get("assetId") or ""}')
print(f'APPR={pending[0]["id"] if pending else ""}')
if pending:
  open(report+"/pending-ticket.json","w").write(json.dumps(pending[0], indent=2))
  open(report+"/exact-params.json","w").write(json.dumps(pending[0].get("params") or {}))
PY
)"
  log "poll#$i status=$STATUS asset=$ASSET appr=$APPR"
  if [[ -n "$APPR" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$APPR" ]]; then
  log "FAIL: worker never issued pending ticket"
  timing '"event":"fail","reason":"no_pending_ticket"'
  echo '{"pass":false,"reason":"no_pending_ticket"}' >"$REPORT_DIR/result.json"
  exit 4
fi

cp "$REPORT_DIR/$(printf '03-task-poll-%02d.body.json' "$POLL_I")" "$REPORT_DIR/03-task-waiting.body.json"
PARAMS_JSON=$(cat "$REPORT_DIR/exact-params.json")
python3 -c 'import json; p=json.load(open("'"$REPORT_DIR"'/exact-params.json")); p["channel"]="wrong-channel"; open("'"$REPORT_DIR"'/wrong-params.json","w").write(json.dumps(p))'
WRONG_JSON=$(cat "$REPORT_DIR/wrong-params.json")
timing "\"event\":\"pending_issued\",\"ticketId\":\"${APPR}\",\"taskId\":\"${TASK_ID}\""
snap_ticket 04-pending-before-lock "$APPR"

# 2) Lock row
READY_FILE="$REPORT_DIR/lock-ready.txt"
LOCK_LOG="$REPORT_DIR/lock-helper.log"
# Artifact/fuse mounts may not support fifo — keep the command pipe on local tmpfs.
LOCK_CMD_PIPE="${LOCK_CMD_PIPE:-/tmp/hamster-su1-lock-cmd.$$.pipe}"
rm -f "$READY_FILE" "$LOCK_CMD_PIPE"
mkfifo "$LOCK_CMD_PIPE"
export LOCK_DATABASE_URL
python3 "$SCRIPT_DIR/lock-helper.py" "$APPR" "$READY_FILE" \
  <"$LOCK_CMD_PIPE" >"$LOCK_LOG" 2>&1 &
LOCK_HELPER_PID=$!
# Keep writer FD open for COMMIT (and so helper's fifo open succeeds)
exec 9>"$LOCK_CMD_PIPE"

for _ in $(seq 1 50); do
  if [[ -f "$READY_FILE" ]]; then
    break
  fi
  sleep 0.1
done
if [[ ! -f "$READY_FILE" ]]; then
  log "FAIL: lock helper did not signal READY"
  exec 9>&-
  kill "$LOCK_HELPER_PID" 2>/dev/null || true
  exit 5
fi
log "lock_ready=$(cat "$READY_FILE")"
timing "\"event\":\"row_locked\",\"ticketId\":\"${APPR}\",\"lock_helper_pid\":${LOCK_HELPER_PID}"
snap_ticket 06-pending-while-locked "$APPR"

# 3) Approve in background
timing "\"event\":\"approve_http_start\",\"ticketId\":\"${APPR}\""
printf '%s\n' '{"decidedBy":"unplanted-singleuse-chain"}' >"$REPORT_DIR/07-approve.request.json"
(
  code=$(curl -sS -m 90 -X POST "$API_BASE/api/approvals/${APPR}/approve" \
    -H 'content-type: application/json' \
    -d '{"decidedBy":"unplanted-singleuse-chain"}' \
    -D "$REPORT_DIR/07-approve.headers.txt" \
    -o "$REPORT_DIR/07-approve.body.json" \
    -w '%{http_code}')
  {
    echo "http_code=$code"
    echo "wall_end=$(ts)"
  } >"$REPORT_DIR/07-approve.meta.txt"
  echo "$code" >"$REPORT_DIR/07-approve.code"
) &
APPROVE_PID=$!
log "approve_bg_pid=$APPROVE_PID"

# Stagger wait: let answerInteraction + authorize run under pending lock (~2s)
sleep 2
timing '"event":"pre_commit_after_stagger_wait"'
snap_ticket 08-still-pending-before-commit "$APPR"
if [[ -f "$REPORT_DIR/07-approve.code" ]]; then
  log "NOTE: approve returned before commit code=$(cat "$REPORT_DIR/07-approve.code")"
fi

# 4) COMMIT + SIGSTOP
timing "\"event\":\"commit_lock_and_sigstop\",\"eve_pid\":${EVE_PID}"
printf 'COMMIT\n' >&9
sleep 0.05
if kill -STOP "$EVE_PID" 2>/dev/null; then
  STOP_TS=$(ts)
  timing "\"event\":\"sigstop\",\"eve_pid\":${EVE_PID},\"at\":\"${STOP_TS}\""
  log "SIGSTOP eve pid=$EVE_PID at $STOP_TS state=$(awk '{print $3}' /proc/$EVE_PID/stat 2>/dev/null || echo gone)"
else
  log "WARN: SIGSTOP failed"
  timing '"event":"sigstop_failed"'
fi

wait "$APPROVE_PID" || true
wait "$LOCK_HELPER_PID" || true
exec 9>&-
APPROVE_CODE=$(cat "$REPORT_DIR/07-approve.code" 2>/dev/null || echo missing)
log "approve_http_code=$APPROVE_CODE"
timing "\"event\":\"approve_http_done\",\"http_code\":\"${APPROVE_CODE}\""
snap_ticket 09-after-approve "$APPR"

if [[ "$APPROVE_CODE" != "200" ]]; then
  log "FAIL: approve http $APPROVE_CODE"
  kill -CONT "$EVE_PID" 2>/dev/null || true
  echo "{\"pass\":false,\"reason\":\"approve_http_${APPROVE_CODE}\",\"ticketId\":\"$APPR\"}" >"$REPORT_DIR/result.json"
  exit 6
fi

STATUS_LINE=$(db -At -c "SELECT status||'|'||COALESCE(consumed_at::text,'NULL') FROM approvals WHERE id='${APPR}';" | tee "$REPORT_DIR/09-status-line.txt")
log "post_approve_state=$STATUS_LINE"
if [[ "$STATUS_LINE" != approved\|NULL ]]; then
  log "FAIL: expected approved|NULL got $STATUS_LINE"
  timing "\"event\":\"fail\",\"reason\":\"post_approve_state\",\"state\":\"${STATUS_LINE}\""
  kill -CONT "$EVE_PID" 2>/dev/null || true
  echo "{\"pass\":false,\"reason\":\"post_approve_state\",\"state\":\"$STATUS_LINE\",\"ticketId\":\"$APPR\",\"note\":\"If consumed, worker won race before SIGSTOP; not a planted PASS\"}" >"$REPORT_DIR/result.json"
  exit 7
fi

# 5) Wrong params
timing '"event":"wrong_params_check"'
policy_check 10-policy-wrong "$TASK_ID" "$WRONG_JSON"
snap_ticket 11-after-wrong "$APPR"
AFTER_WRONG=$(db -At -c "SELECT status||'|'||COALESCE(consumed_at::text,'NULL') FROM approvals WHERE id='${APPR}';" | tee "$REPORT_DIR/11-status-line.txt")
log "wrong_body=$(cat "$REPORT_DIR/10-policy-wrong.body.json") after_wrong=$AFTER_WRONG"

# 6) Exact first
timing '"event":"exact_params_first_consume"'
policy_check 12-policy-exact-first "$TASK_ID" "$PARAMS_JSON"
snap_ticket 13-after-first-consume "$APPR"
log "first_body=$(cat "$REPORT_DIR/12-policy-exact-first.body.json")"

# 7) Exact second
timing '"event":"exact_params_second_consume"'
policy_check 14-policy-exact-second "$TASK_ID" "$PARAMS_JSON"
snap_ticket 15-after-second "$APPR"
log "second_body=$(cat "$REPORT_DIR/14-policy-exact-second.body.json")"

python3 - "$REPORT_DIR" "$APPR" "$TASK_ID" "$EVE_PID" "$AFTER_WRONG" <<'PY'
import json, pathlib, sys
report = pathlib.Path(sys.argv[1])
ticket, task, eve_pid, after_wrong = sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5]
wrong = json.loads((report/"10-policy-wrong.body.json").read_text())
first = json.loads((report/"12-policy-exact-first.body.json").read_text())
second = json.loads((report/"14-policy-exact-second.body.json").read_text())
ok_wrong = wrong.get("allow") is False and after_wrong.strip() == "approved|NULL"
ok_first = first.get("allow") is True and first.get("ticketId") == ticket
ok_second = second.get("allow") is False
passed = ok_wrong and ok_first and ok_second
result = {
  "pass": passed,
  "chain": "unplanted-worker-pending->real-approve->wrong-deny-unconsumed->exact-allow-same-ticket->exact-deny",
  "ticketId": ticket,
  "taskId": task,
  "assetId": json.loads((report/"exact-params.json").read_text()).get("assetId"),
  "exactParams": json.loads((report/"exact-params.json").read_text()),
  "approveHttp": (report/"07-approve.code").read_text().strip(),
  "wrong": wrong,
  "afterWrongDb": after_wrong.strip(),
  "first": first,
  "second": second,
  "evePid": eve_pid,
  "stagger": "approvals row FOR UPDATE held across approve answerInteraction; SIGSTOP after COMMIT",
  "plantedApprovedTicket": False,
  "checks": {
    "wrongDenyUnconsumed": ok_wrong,
    "firstAllowSameTicket": ok_first,
    "secondDeny": ok_second,
  },
}
(report/"result.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
raise SystemExit(0 if passed else 8)
PY
VERDICT=$?

if kill -CONT "$EVE_PID" 2>/dev/null; then
  CONT_TS=$(ts)
  timing "\"event\":\"sigcont\",\"eve_pid\":${EVE_PID},\"at\":\"${CONT_TS}\""
  log "SIGCONT eve pid=$EVE_PID at $CONT_TS"
fi

log "=== chain end verdict=$VERDICT ==="
exit "$VERDICT"
