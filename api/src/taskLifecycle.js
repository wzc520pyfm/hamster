'use strict';

/**
 * Side-effect-free task create/detail lifecycle used by the control plane.
 * Does not load db.js, events.js, eve.js, or start listen/migrate.
 * Callers inject { query, eve, audit, appendTaskEvent, attach }.
 */

const crypto = require('crypto');

function taskJson(t) {
  return {
    taskId: t.id,
    conversationId: t.conversation_id,
    runtimeSessionId: t.eve_session_id,
    assetId: t.asset_id,
    title: t.title,
    status: t.status,
    controlSeq: t.control_seq,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    cancelRequestedAt: t.cancel_requested_at,
  };
}

/** Same derivation taskDetail uses for TaskCard failureReason. */
function failureReasonFromEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return null;
  const failureEvent = [...events].reverse().find((e) => e.kind === 'failure') ?? null;
  return failureEvent?.message ?? null;
}

/**
 * Safe user-facing spawn failure text. Does not read env secrets.
 * Redacts Bearer/sk-/KEY shapes, Basic credentials, and URL userinfo.
 */
function safeSpawnFailureMessage(err) {
  let text = String(err?.message ?? err ?? 'unknown error');
  text = text.replace(/(Bearer\s+)(\S+)/gi, '$1[redacted]');
  text = text.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]');
  text = text.replace(
    /\b([A-Za-z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Za-z0-9_]*)\s*[:=]\s*["']?[^\s"',}]+/gi,
    '$1=[redacted]',
  );
  text = text.replace(/(Basic\s+)(\S+)/gi, '$1[redacted]');
  // URL userinfo (incl. passwords with '@'): scheme://user:pass@host → scheme://[redacted]@host
  text = text.replace(
    /\b([a-z][a-z0-9+.-]*):\/\/([^\s/]+)@(?=[^/\s])/gi,
    '$1://[redacted]@',
  );
  if (text.length > 500) text = `${text.slice(0, 497)}...`;
  return text;
}

/**
 * @param {{
 *   query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>,
 *   eve: { createSession: (prompt: string) => Promise<{ sessionId: string }> },
 *   audit: (action: string, detail: object) => Promise<void>,
 *   appendTaskEvent: (taskId: string, event: { kind: string, message: string }) => Promise<unknown>,
 *   attach: (key: string, sessionId: string) => void,
 * }} deps
 */
function createTaskLifecycle(deps) {
  const { query, eve, audit, appendTaskEvent, attach } = deps;

  async function taskDetail(taskId) {
    const { rows } = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (rows.length === 0) return null;
    const t = rows[0];
    const [evts, ctrls, apprs] = await Promise.all([
      query(
        'SELECT seq, kind, message, step, total, created_at FROM task_events WHERE task_id = $1 ORDER BY seq ASC',
        [taskId],
      ),
      query(
        'SELECT control_seq, type, payload, status, created_at, applied_at FROM task_controls WHERE task_id = $1 ORDER BY control_seq ASC',
        [taskId],
      ),
      query(
        'SELECT id, action, params, status, expires_at, decided_at, decision_note, consumed_at FROM approvals WHERE task_id = $1 ORDER BY requested_at ASC',
        [taskId],
      ),
    ]);
    return {
      ...taskJson(t),
      events: evts.rows,
      controls: ctrls.rows,
      approvals: apprs.rows,
      // Human-readable failure reason for the Task card (design-table status: Failed).
      failureReason: failureReasonFromEvents(evts.rows),
    };
  }

  async function createTask(conversationId, title, goal) {
    const taskId = `task_${crypto.randomUUID()}`;
    await query(
      'INSERT INTO tasks (id, conversation_id, title, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [taskId, conversationId, title, 'queued'],
    );
    try {
      const { sessionId } = await eve.createSession(
        `[hamster-worker taskId=${taskId} title=${title}] ${goal}`,
      );
      await query('UPDATE tasks SET eve_session_id = $1, status = $2, updated_at = now() WHERE id = $3', [
        sessionId,
        'running',
        taskId,
      ]);
      attach(`task:${taskId}`, sessionId);
      return { task: await taskDetail(taskId) };
    } catch (err) {
      // Minimal fix vs 642ae0e: keep failed + audit + chat spawnError, and append
      // kind=failure so taskDetail.failureReason / TaskCard can render the reason.
      // Persist only redacted text (event + card + audit + chat) — no raw secrets.
      const spawnError = safeSpawnFailureMessage(err);
      await query('UPDATE tasks SET status = $1, updated_at = now() WHERE id = $2', ['failed', taskId]);
      await audit('task_spawn_failed', { taskId, error: spawnError });
      await appendTaskEvent(taskId, { kind: 'failure', message: spawnError });
      return { task: await taskDetail(taskId), spawnError };
    }
  }

  return { taskDetail, createTask, taskJson };
}

module.exports = {
  createTaskLifecycle,
  taskJson,
  failureReasonFromEvents,
  safeSpawnFailureMessage,
};
