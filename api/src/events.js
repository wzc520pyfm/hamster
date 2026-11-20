'use strict';

// Fact handlers for eve sessions followed by this control plane.
// All handlers are idempotent: on boot we re-attach followers and eve replays
// the recorded stream from the beginning.

const { query } = require('./db');
const eve = require('./eve');
const { paramsHash } = require('./policy');

const EXPIRY_NOTE = 'Expired — not approved, so it did not run';

// Same-session tool approvals omit origin.call; the tool name/input live on the
// preceding call.requested fact keyed by subject.callId. Subagent relays still
// carry origin.call. Cache both so tickets get the real action for policy match
// and so the React client can map to plain-language titles (never show raw ids).
const callBySessionAndId = new Map(); // `${sessionId}:${callId}` -> { name, input }

function callCacheKey(sessionId, callId) {
  return `${sessionId}:${callId}`;
}

function rememberCallRequested(sessionId, fact) {
  const data = fact.data ?? {};
  const callId = data.callId;
  const name = data.capability?.name;
  if (!callId || !name) return;
  const input =
    data.input && typeof data.input === 'object' && !Array.isArray(data.input) ? data.input : {};
  callBySessionAndId.set(callCacheKey(sessionId, callId), { name: String(name), input });
}

function resolveApprovalCall(sessionId, data) {
  const originCall = data.origin?.call ?? null;
  if (originCall?.name && String(originCall.name).trim()) {
    const input =
      originCall.input && typeof originCall.input === 'object' && !Array.isArray(originCall.input)
        ? originCall.input
        : {};
    return { name: String(originCall.name).trim(), input };
  }
  const callId = data.subject?.callId;
  if (callId) {
    const cached = callBySessionAndId.get(callCacheKey(sessionId, callId));
    if (cached?.name) return cached;
  }
  return { name: 'unknown_action', input: {} };
}

async function findTaskBySession(sessionId) {
  const { rows } = await query('SELECT * FROM tasks WHERE eve_session_id = $1', [sessionId]);
  return rows[0] ?? null;
}

async function findConversationBySession(sessionId) {
  const { rows } = await query('SELECT * FROM conversations WHERE eve_session_id = $1', [sessionId]);
  return rows[0] ?? null;
}

// Upsert a ticket for a pending eve approval. Params come from the call site the
// worker attempted (origin.call.input or call.requested.input), so authorization
// stays bound to exactly what was asked, never to a later natural-language echo.
async function handleApprovalOpened(fact, sessionId) {
  const data = fact.data ?? {};
  if (data.request?.kind !== 'approval') return;
  const task = await findTaskBySession(sessionId);
  if (!task) {
    console.log('[events] approval opened on non-task session; not bound to a ticket', sessionId);
    return;
  }
  const resolved = resolveApprovalCall(sessionId, data);
  // Machine id for policy matching; React maps to plain-language card titles.
  const action = resolved.name || 'unknown_action';
  const params = resolved.input ?? {};
  const approvalId = `appr_${data.interactionId}`;
  const ttlSeconds = Number(process.env.HAMSTER_APPROVAL_TTL_SECONDS ?? '600');

  // Bind the ticket to the task's execution target at issue time. approvals.target_id
  // is always written; params.targetId is always set so authorize can fail closed if missing.
  const boundTargetId = task.target_id;
  if (!boundTargetId) {
    console.warn('[events] approval opened but task has no target_id; refusing ticket', task.id);
    return;
  }
  const ticketParams =
    params && typeof params === 'object' && !Array.isArray(params)
      ? { ...params, targetId: boundTargetId }
      : { targetId: boundTargetId };
  // Worker-supplied targetId must match the task; otherwise fail closed (no ticket).
  if (
    params &&
    typeof params === 'object' &&
    typeof params.targetId === 'string' &&
    params.targetId.trim() &&
    params.targetId.trim() !== boundTargetId
  ) {
    console.warn('[events] approval targetId mismatch; refusing ticket', {
      taskId: task.id,
      taskTarget: boundTargetId,
      paramsTarget: params.targetId,
    });
    return;
  }
  const ticketHash = paramsHash(ticketParams);
  await query(
    `INSERT INTO approvals (id, task_id, action, params, params_hash, status,
                            target_id, eve_interaction_id, eve_session_id, expires_at)
     VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8, now() + ($9 || ' seconds')::interval)
     ON CONFLICT (eve_interaction_id) DO NOTHING`,
    [
      approvalId,
      task.id,
      action,
      JSON.stringify(ticketParams),
      ticketHash,
      boundTargetId,
      data.interactionId,
      sessionId,
      String(ttlSeconds),
    ]
  );
  await query(
    `UPDATE tasks SET status = 'waiting_for_approval', updated_at = now()
      WHERE id = $1 AND status NOT IN ('cancelled','succeeded','failed')`,
    [task.id]
  );
  await audit('approval_ticket_created', {
    taskId: task.id,
    approvalId,
    interactionId: data.interactionId,
    action,
  });
}

async function handleApprovalSettled(fact) {
  const data = fact.data ?? {};
  const interactionId = data.interactionId;
  if (!interactionId) return;
  // If this control plane initiated the settle (user clicked approve/deny), the
  // ticket is no longer pending and nothing changes. Otherwise align unknown settles.
  if (data.outcome === 'accepted') {
    await query(
      `UPDATE approvals SET status = 'approved', decided_at = COALESCE(decided_at, now()), decided_by = COALESCE(decided_by, 'eve')
        WHERE eve_interaction_id = $1 AND status = 'pending'`,
      [interactionId]
    );
  } else {
    await query(
      `UPDATE approvals
          SET status = CASE WHEN status = 'pending' THEN 'denied' ELSE status END,
              decided_at = COALESCE(decided_at, now()),
              decision_note = COALESCE(decision_note, 'Settled without approval (' || $2 || ')')
        WHERE eve_interaction_id = $1 AND status = 'pending'`,
      [interactionId, String(data.outcome ?? 'unknown')]
    );
  }
}

async function handleContentCompleted(fact, key, sessionId) {
  const data = fact.data ?? {};
  if (data.kind !== 'text' || (data.phase ?? 'reply') !== 'reply') return;
  const partId = data.partId;
  const text = typeof data.value === 'string' ? data.value : String(data.value ?? '');
  if (!text.trim()) return;

  if (key.startsWith('conv:')) {
    const conversation = await findConversationBySession(sessionId);
    if (!conversation) return;
    await query(
      `INSERT INTO messages (conversation_id, role, content, meta)
       VALUES ($1, 'assistant', $2, $3)
       ON CONFLICT DO NOTHING`,
      [
        conversation.id,
        text,
        JSON.stringify({ partId, source: 'eve', kind: 'chat-reply' }),
      ]
    );
    return;
  }

  const task = await findTaskBySession(sessionId);
  if (task) {
    // Task-scoped replies are persisted as conversation messages pointing at the
    // taskId, deduped by partId via the unique index — safe to re-fold on restart.
    await query(
      `INSERT INTO messages (conversation_id, role, content, meta)
       VALUES ($1, 'assistant', $2, $3)
       ON CONFLICT DO NOTHING`,
      [
        task.conversation_id,
        text,
        JSON.stringify({ partId, taskId: task.id, source: 'eve', kind: 'task-reply' }),
      ]
    );
  }
}

async function handleTurnSettled(fact, sessionId) {
  const data = fact.data ?? {};
  const task = await findTaskBySession(sessionId);
  if (!task) return;
  const outcome = data.outcome;
  if (outcome === 'completed') {
    await query(
      `UPDATE tasks SET status = 'succeeded', updated_at = now()
        WHERE id = $1 AND status NOT IN ('cancelled','failed')`,
      [task.id]
    );
  } else if (outcome === 'failed') {
    await query(
      `UPDATE tasks SET status = 'failed', updated_at = now()
        WHERE id = $1 AND status NOT IN ('cancelled')`,
      [task.id]
    );
    await appendTaskEvent(task.id, { kind: 'failure', message: `Turn failed (${data.error ?? 'unknown'})` });
  }
  // 'cancelled': the product cancel path owns the terminal state and its audit trail.
}

async function handleSessionEnded(fact, sessionId) {
  const task = await findTaskBySession(sessionId);
  if (!task) return;
  const outcome = fact.data?.outcome;
  if (outcome === 'failed') {
    await query(
      `UPDATE tasks SET status = 'failed', updated_at = now()
        WHERE id = $1 AND status NOT IN ('cancelled')`,
      [task.id]
    );
  }
}

const seenDemoteKeys = new Map();
async function appendTaskEvent(taskId, { kind, message, step = null, total = null, dedupeKey = null }) {
  if (dedupeKey) {
    const seen = seenDemoteKeys.get(taskId) ?? new Set();
    if (seen.has(dedupeKey)) return null;
    seen.add(dedupeKey);
    seenDemoteKeys.set(taskId, seen);
  }
  const { rows } = await query(
    `INSERT INTO task_events (task_id, seq, kind, message, step, total)
     SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3, $4, $5 FROM task_events WHERE task_id = $1
     ON CONFLICT (task_id, seq) DO NOTHING
     RETURNING *`,
    [taskId, kind, message, step, total]
  );
  return rows[0] ?? null;
}

async function audit(action, detail, actor = 'system') {
  await query('INSERT INTO audit_log (actor, action, detail) VALUES ($1, $2, $3)', [
    actor,
    action,
    JSON.stringify(detail ?? {}),
  ]);
}

async function handleFact(key, sessionId, fact) {
  switch (fact?.type) {
    case 'call.requested':
      rememberCallRequested(sessionId, fact);
      return undefined;
    case 'interaction.opened':
      return handleApprovalOpened(fact, sessionId);
    case 'interaction.settled':
      return handleApprovalSettled(fact);
    case 'content.completed':
      return handleContentCompleted(fact, key, sessionId);
    case 'turn.settled':
      return handleTurnSettled(fact, sessionId);
    case 'session.ended':
      return handleSessionEnded(fact, sessionId);
    default:
      return undefined;
  }
}

module.exports = {
  handleFact,
  appendTaskEvent,
  audit,
  EXPIRY_NOTE,
  attach: (key, sessionId, opts = {}) =>
    eve.attachFollower(key, sessionId, (fact) => handleFact(key, sessionId, fact), opts),
};
