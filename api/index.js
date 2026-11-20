'use strict';

// Hamster P0 control plane (self-hosted). Compose: db + api + agent + client.
// This file is the HTTP surface; domain logic lives in src/.

const express = require('express');
const crypto = require('crypto');
const { query, migrate, pool } = require('./src/db');
const namedQueries = require('./src/namedQueries');
const policy = require('./src/policy');
const eve = require('./src/eve');
const events = require('./src/events');
const assets = require('./src/assets');
const isolation = require('./src/isolation');
const readiness = require('./src/readiness');

const PORT = Number(process.env.PORT ?? 8080);
const INTERNAL_SECRET = process.env.HAMSTER_INTERNAL_SECRET ?? 'dev-internal-secret';
const APPROVAL_TTL_SECONDS = Number(process.env.HAMSTER_APPROVAL_TTL_SECONDS ?? '600');
const CORS_ORIGIN = process.env.HAMSTER_CORS_ORIGIN ?? 'http://localhost:3000';
/** Mutable so isolated HTTP tests can inject a fake broker (never the box desktop). */
let BROKER = isolation.createDockerIsolationBroker();
function setIsolationBrokerForTests(broker) {
  BROKER = broker;
}

async function getManagedIsolatedDesktop(targetId = isolation.ISOLATED_DESKTOP_TARGET_ID) {
  const { rows } = await query(
    `SELECT target_id, instance_id, container_id, image_id, config_image, approval_id, task_id
       FROM isolated_desktop_managed WHERE target_id = $1`,
    [targetId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    targetId: row.target_id,
    instanceId: row.instance_id,
    containerId: row.container_id,
    imageId: row.image_id,
    configImage: row.config_image,
    approvalId: row.approval_id,
    taskId: row.task_id,
  };
}

/**
 * CURRENT managed provenance for a target (create/start planning only).
 * NEVER use this to rebind an existing session/task — use identityForTask.
 */
async function identityForTarget(targetId) {
  if (!isolation.isIsolatedDesktopTarget(targetId)) return null;
  return getManagedIsolatedDesktop(targetId);
}

/**
 * ORIGINAL frozen identity persisted on the task at session create.
 * Isolated session ops (steer/cancel/answer/stream/reattach) MUST use this —
 * never the current managed row (session A must not rebind to replacement B).
 * Legacy rows missing frozen columns fail closed.
 */
function frozenIdentityFromTask(task) {
  if (!task) return null;
  const targetId = task.target_id ?? isolation.CONTROL_PLANE_TARGET_ID;
  if (!isolation.isIsolatedDesktopTarget(targetId)) return null;
  const instanceId = task.eve_instance_id;
  const imageId = task.eve_image_id;
  const containerId = task.eve_container_id || null;
  if (!instanceId || !imageId) {
    const err = new Error('isolated_task_frozen_identity_missing');
    err.status = 409;
    throw err;
  }
  if (!isolation.isCompleteImageDigest(imageId)) {
    const err = new Error('isolated_task_frozen_identity_incomplete');
    err.status = 409;
    throw err;
  }
  return {
    targetId,
    instanceId,
    containerId,
    imageId,
  };
}

async function identityForTask(task) {
  return frozenIdentityFromTask(task);
}

async function upsertManagedIsolatedDesktop(record) {
  await query(
    `INSERT INTO isolated_desktop_managed
       (target_id, instance_id, container_id, image_id, config_image, approval_id, task_id, managed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
     ON CONFLICT (target_id) DO UPDATE SET
       instance_id = EXCLUDED.instance_id,
       container_id = EXCLUDED.container_id,
       image_id = EXCLUDED.image_id,
       config_image = EXCLUDED.config_image,
       approval_id = EXCLUDED.approval_id,
       task_id = EXCLUDED.task_id,
       updated_at = now()`,
    [
      record.targetId || isolation.ISOLATED_DESKTOP_TARGET_ID,
      record.instanceId,
      record.containerId,
      record.imageId || '',
      record.configImage || isolation.ALLOWLISTED_IMAGE,
      record.approvalId || null,
      record.taskId || null,
    ],
  );
}

async function verifyIsolatedReuseOrDeny(clientClaim = null) {
  return isolation.verifyHealthyIsolatedDesktopForReuse({
    broker: BROKER,
    clientClaim,
    getManagedInstance: getManagedIsolatedDesktop,
  });
}

/**
 * Session-creation boundary: recheck frozen managed identity; fail closed on swap.
 * @returns {Promise<{ ok: true, identity: object } | { ok: false, reason: string, verified?: object }>}
 */
async function guardIsolatedSessionIdentity(verified) {
  if (!verified?.reuse || !verified.identity) {
    return { ok: false, reason: verified?.reason || 'reuse_denied', verified };
  }
  const recheck = await isolation.recheckManagedIsolatedIdentity({
    broker: BROKER,
    expected: verified.identity,
    getManagedInstance: getManagedIsolatedDesktop,
  });
  if (!recheck.ok) {
    return { ok: false, reason: recheck.reason || 'identity_recheck_failed', verified, recheck };
  }
  return { ok: true, identity: verified.identity, recheck };
}

const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hamster-internal-secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  return next();
});
app.use(express.json({ limit: '1mb' }));

// ------------------------------------------------------------------ helpers

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function requireInternal(req, res, next) {
  if (req.get('x-hamster-internal-secret') !== INTERNAL_SECRET) {
    return res.status(403).json({ error: 'internal secret mismatch' });
  }
  return next();
}

async function defaultConversation() {
  const { rows } = await query('SELECT * FROM conversations ORDER BY created_at ASC LIMIT 1');
  if (rows.length > 0) return rows[0];
  const id = `conv_${crypto.randomUUID()}`;
  const ins = await query(
    'INSERT INTO conversations (id, title) VALUES ($1, $2) RETURNING *',
    [id, 'Main conversation']
  );
  return ins.rows[0];
}

function taskJson(t) {
  return {
    taskId: t.id,
    conversationId: t.conversation_id,
    runtimeSessionId: t.eve_session_id,
    assetId: t.asset_id,
    title: t.title,
    status: t.status,
    // Stable execution target (control plane vs isolated desktop). Isolated desktop is a
    // same-host container id, never the host machine itself.
    targetId: t.target_id ?? isolation.CONTROL_PLANE_TARGET_ID,
    controlSeq: t.control_seq,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    cancelRequestedAt: t.cancel_requested_at,
  };
}

async function taskDetail(taskId) {
  const { rows } = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  if (rows.length === 0) return null;
  const t = rows[0];
  const [evts, ctrls, apprs] = await Promise.all([
    query('SELECT seq, kind, message, step, total, created_at FROM task_events WHERE task_id = $1 ORDER BY seq ASC', [taskId]),
    query('SELECT control_seq, type, payload, status, created_at, applied_at FROM task_controls WHERE task_id = $1 ORDER BY control_seq ASC', [taskId]),
    query('SELECT id, action, params, status, expires_at, decided_at, decision_note, consumed_at FROM approvals WHERE task_id = $1 ORDER BY requested_at ASC', [taskId]),
  ]);
  const failureEvent = [...evts.rows].reverse().find((e) => e.kind === 'failure') ?? null;
  return {
    ...taskJson(t),
    events: evts.rows,
    controls: ctrls.rows,
    approvals: apprs.rows,
    // Human-readable failure reason for the Task card (design-table status: Failed).
    failureReason: failureEvent?.message ?? null,
  };
}

// ------------------------------------------------------------------ health

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ------------------------------------------------------------ conversations

app.get('/api/conversations/current', asyncRoute(async (req, res) => {
  const conv = await defaultConversation();
  res.json({ conversationId: conv.id, title: conv.title, createdAt: conv.created_at });
}));

app.get('/api/conversations/:id/timeline', asyncRoute(async (req, res) => {
  const { id } = req.params;
  const [msgs, tasks, apprs] = await Promise.all([
    query(
      'SELECT id, role, content, meta, created_at FROM messages WHERE conversation_id = $1 ORDER BY id ASC LIMIT 500',
      [id]
    ),
    query('SELECT * FROM tasks WHERE conversation_id = $1 ORDER BY created_at ASC', [id]),
    query(
      `SELECT a.* FROM approvals a JOIN tasks t ON t.id = a.task_id
        WHERE t.conversation_id = $1 ORDER BY a.requested_at ASC`,
      [id]
    ),
  ]);
  const tasksDetailed = await Promise.all(tasks.rows.map((t) => taskDetail(t.id)));
  res.json({
    conversationId: id,
    messages: msgs.rows.map((m) => ({
      id: String(m.id),
      role: m.role,
      content: m.content,
      meta: m.meta,
      createdAt: m.created_at,
    })),
    tasks: tasksDetailed,
    approvals: apprs.rows.map((a) => ({
      id: a.id,
      taskId: a.task_id,
      action: a.action,
      params: a.params,
      status: a.status,
      expiresAt: a.expires_at,
      decidedAt: a.decided_at,
      decisionNote: a.decision_note,
    })),
  });
}));

// Create a task and wake the worker in one step. Idempotency is not required by
// the P0 UI (single click) but a client retry could double-create; acceptable
// for P0, documented.
async function createTask(conversationId, title, goal, targetId) {
  const taskId = `task_${crypto.randomUUID()}`;
  const target = targetId ?? isolation.CONTROL_PLANE_TARGET_ID;
  const ins = await query(
    'INSERT INTO tasks (id, conversation_id, title, status, target_id, goal) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [taskId, conversationId, title, 'queued', target, goal]
  );
  try {
    if (target === isolation.ISOLATED_DESKTOP_TARGET_ID) {
      // Isolated desktop: create/start stays high-risk and ticket-gated unless the
      // control plane verifies a previously managed/approved SAME instance
      // (containerId + image + health/session bind). Name+2xx alone never reuses.
      // Client "running" claims are ignored. Reuse never calls docker create/start.
      const verified = await verifyIsolatedReuseOrDeny(null);
      const plan = isolation.planIsolatedCreateTask({ reuse: verified });
      if (plan.spawnSession && !plan.mintCreateTicket) {
        const guard = await guardIsolatedSessionIdentity(verified);
        if (guard.ok) {
          await events.audit('task_created_isolated_reuse_running', {
            taskId,
            targetId: target,
            probe: verified.probe?.state,
            instanceId: guard.identity?.instanceId,
            containerId: guard.identity?.containerId,
          });
          const { sessionId } = await eve.createSession(
            `[hamster-worker taskId=${taskId} conversationId=${conversationId} targetId=${target} title=${title}] ${goal}`,
            { targetId: target, identity: guard.identity }
          );
          // Persist ORIGINAL frozen identity on the task — later ops must not re-read managed.
          await query(
            `UPDATE tasks SET eve_session_id = $1, status = $2,
               eve_instance_id = $3, eve_container_id = $4, eve_image_id = $5,
               updated_at = now() WHERE id = $6`,
            [
              sessionId,
              'running',
              guard.identity.instanceId,
              guard.identity.containerId || null,
              guard.identity.imageId,
              taskId,
            ],
          );
          events.attach(`task:${taskId}`, sessionId, {
            targetId: target,
            identity: guard.identity,
          });
          return { task: await taskDetail(taskId) };
        }
        // Identity swap / TOCTOU fail closed → mint create/start ticket.
        verified.reason = guard.reason || 'identity_recheck_failed';
      }
      // Selecting Isolated desktop is NOT approval — only this ticket authorizes create/start.
      const approvalId = `appr_${taskId}_create_${crypto.randomUUID()}`;
      const params = isolation.createIsolatedDesktopParams(taskId, target);
      const hash = policy.paramsHash(params);
      await query(
        `INSERT INTO approvals (id, task_id, action, params, params_hash, status, target_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, now() + ($7 || ' seconds')::interval)`,
        [approvalId, taskId, isolation.CREATE_ISOLATED_DESKTOP_ACTION, JSON.stringify(params), hash, target, String(APPROVAL_TTL_SECONDS)]
      );
      await events.audit('task_created_isolated_pending_start', {
        taskId,
        approvalId,
        targetId: target,
        reuseDenied: verified.reason ?? null,
      });
      return { task: await taskDetail(taskId) };
    }
    const { sessionId } = await eve.createSession(
      `[hamster-worker taskId=${taskId} conversationId=${conversationId} targetId=${target} title=${title}] ${goal}`,
      { targetId: target }
    );
    await query('UPDATE tasks SET eve_session_id = $1, status = $2, updated_at = now() WHERE id = $3', [
      sessionId,
      'running',
      taskId,
    ]);
    events.attach(`task:${taskId}`, sessionId, { targetId: target });
    return { task: await taskDetail(taskId) };
  } catch (err) {
    await query('UPDATE tasks SET status = $1, updated_at = now() WHERE id = $2', ['failed', taskId]);
    await events.audit('task_spawn_failed', { taskId, error: String(err.message ?? err) });
    return { task: await taskDetail(taskId), spawnError: String(err.message ?? err) };
  }
}

async function findActiveTask(conversationId) {
  const { rows } = await query(
    `SELECT * FROM tasks WHERE conversation_id = $1
      ORDER BY CASE WHEN status IN ('queued','running','waiting_for_approval') THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1`,
    [conversationId]
  );
  return rows[0] ?? null;
}

// The message router is deterministic control-plane logic, not a model.
app.post('/api/conversations/:id/messages', asyncRoute(async (req, res) => {
  const { id } = req.params;
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });

  const conv = await defaultConversation();
  if (conv.id !== id && req.body?.strict) {
    return res.status(404).json({ error: 'conversation not found' });
  }
  const conversationId = id || conv.id;

  const insertMessage = async (role, content, meta = {}) =>
    query(
      'INSERT INTO messages (conversation_id, role, content, meta) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
      [conversationId, role, content, JSON.stringify(meta)]
    );

  await insertMessage('user', text, { kind: 'user-message' });

  const startMatch = text.match(/^(?:start|dispatch|delegate|派发)\s+(?:a\s+)?(?:long[- ]running\s+)?task:?\s*(.+)$/is);
  if (startMatch) {
    const goal = startMatch[1].trim();
    const title = goal.length > 80 ? `${goal.slice(0, 77)}…` : goal;
    const targetId = isolation.isKnownTarget(req.body?.targetId) ? req.body.targetId : isolation.CONTROL_PLANE_TARGET_ID;
    if (req.body?.targetId != null && !isolation.isKnownTarget(req.body.targetId)) {
      return res.status(400).json({ error: 'unknown_target' });
    }
    const { task, spawnError } = await createTask(conversationId, title, goal, targetId);
    const reply = spawnError
      ? `Task ${task.taskId} created but the worker could not be reached: ${spawnError}`
      : `Task ${task.taskId} started. Ask progress, steer, or cancel from its card.`;
    await insertMessage('system', reply, { kind: 'task-created', taskId: task.taskId });
    return res.status(201).json({ kind: 'task-created', task, reply });
  }

  const progressMatch = text.match(/^(?:progress|status|进度|任务进度)\b/i);
  const steerMatch = text.match(/^(?:steer|转向)(?:\s+(\S+))?\s*:\s*(.+)$/is);
  const cancelMatch = text.match(/^(?:cancel|取消)(?:\s+(\S+))?[.!?]?$/i);

  if (progressMatch || steerMatch || cancelMatch) {
    let task = null;
    const explicitId = progressMatch ? null : (steerMatch?.[1] ?? cancelMatch?.[1]);
    if (explicitId && explicitId.startsWith('task_')) {
      const { rows } = await query('SELECT * FROM tasks WHERE id = $1', [explicitId]);
      task = rows[0] ?? null;
    } else {
      task = await findActiveTask(conversationId);
    }
    if (!task) {
      const reply = 'No task found in this conversation yet.';
      await insertMessage('system', reply, { kind: 'progress' });
      return res.json({ kind: 'progress', reply });
    }
    if (progressMatch) {
      const detail = await taskDetail(task.id);
      const latest = detail.events.at(-1);
      const reply = latest
        ? `Task ${detail.taskId} is ${detail.status}. Last persisted event #${latest.seq}: ${latest.message} (${detail.events.length} events recorded).`
        : `Task ${detail.taskId} is ${detail.status}. No events recorded yet.`;
      await insertMessage('system', reply, { kind: 'progress', taskId: task.id });
      return res.json({ kind: 'progress', reply, task: detail });
    }
    if (steerMatch) {
      const message = steerMatch[2].trim();
      return steerTask(req, res, task.id, message);
    }
    if (cancelMatch) {
      return cancelTask(req, res, task.id);
    }
  }

  // Everything else goes to the chat session on the agent.
  let convRow = conversationId === conv.id ? conv : (await query('SELECT * FROM conversations WHERE id = $1', [conversationId])).rows[0];
  try {
    if (!convRow.eve_session_id) {
      const { sessionId } = await eve.createSession();
      await query('UPDATE conversations SET eve_session_id = $1 WHERE id = $2', [sessionId, conversationId]);
      convRow = { ...convRow, eve_session_id: sessionId };
      events.attach(`conv:${conversationId}`, sessionId);
    }
    await eve.sendMessage(convRow.eve_session_id, text);
    return res.status(202).json({ kind: 'chat-accepted' });
  } catch (err) {
    const reply = `The agent runtime is unavailable: ${String(err.message ?? err)}. The control plane is healthy; chat was not delivered.`;
    await insertMessage('system', reply, { kind: 'chat-error' });
    return res.status(503).json({ kind: 'chat-error', reply });
  }
}));

// -------------------------------------------------------------------- tasks

app.get('/api/tasks', asyncRoute(async (req, res) => {
  const { rows } = await query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100');
  res.json(await Promise.all(rows.map((t) => taskDetail(t.id))));
}));

app.get('/api/tasks/:id', asyncRoute(async (req, res) => {
  const detail = await taskDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'task not found' });
  res.json(detail);
}));

async function steerTask(req, res, taskId, message) {
  const { rows } = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const task = rows[0];
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (task.status === 'cancelled') {
    return res.status(409).json({ error: 'task is cancelled; steering has no effect' });
  }
  if (['succeeded', 'failed'].includes(task.status)) {
    return res.status(409).json({ error: `task already ${task.status}` });
  }
  const seqRow = await query(
    'UPDATE tasks SET control_seq = control_seq + 1, updated_at = now() WHERE id = $1 RETURNING control_seq',
    [taskId]
  );
  const controlSeq = seqRow.rows[0].control_seq;
  await query(
    `INSERT INTO task_controls (task_id, control_seq, type, payload, status)
     VALUES ($1, $2, 'steer', $3, 'received')`,
    [taskId, controlSeq, JSON.stringify({ message })]
  );
  // A steer invalidates any outstanding approval tickets for this task:
  // after a steer, old tickets must not authorize actions.
  const invalidated = await query(
    `UPDATE approvals SET status = 'invalidated', decided_at = now(), decided_by = 'system',
            decision_note = 'Invalidated — approve again'
      WHERE task_id = $1 AND status = 'pending'
      RETURNING id, eve_interaction_id, eve_session_id`,
    [taskId]
  );
  const taskTargetId = task.target_id ?? isolation.CONTROL_PLANE_TARGET_ID;
  let taskIdentity = null;
  try {
    taskIdentity = await identityForTask(task);
  } catch (err) {
    if (isolation.isIsolatedDesktopTarget(taskTargetId)) {
      return res.status(err.status || 409).json({ error: err.message });
    }
  }
  for (const inv of invalidated.rows) {
    if (inv.eve_interaction_id && inv.eve_session_id) {
      try {
        await eve.answerInteraction(
          inv.eve_session_id,
          inv.eve_interaction_id,
          'deny',
          'Invalidated — approve again',
          { targetId: taskTargetId, identity: taskIdentity }
        );
      } catch (err) {
        console.warn('[steer] failed to deny invalidated interaction', err.message);
      }
    }
  }
  let delivered = false;
  if (task.eve_session_id) {
    try {
      await eve.sendMessage(
        task.eve_session_id,
        `[hamster-control] CONTROL-STEER taskId=${taskId} controlSeq=${controlSeq} message=${message}`,
        { targetId: taskTargetId, identity: taskIdentity }
      );
      delivered = true;
    } catch (err) {
      console.warn('[steer] failed to deliver steer to worker', err.message);
    }
  }
  await query(
    `UPDATE task_controls SET status = $1 WHERE task_id = $2 AND control_seq = $3`,
    [delivered ? 'pending_apply' : 'received', taskId, controlSeq]
  );
  await events.audit('steer_received', { taskId, controlSeq, delivered });
  return res.status(202).json({
    taskId,
    controlSeq,
    receipt: delivered ? 'pending_apply' : 'received',
    delivered,
    invalidatedApprovals: invalidated.rowCount,
  });
}

app.post('/api/tasks/:id/steer', asyncRoute(async (req, res) => {
  const message = String(req.body?.message ?? '').trim();
  if (!message) return res.status(400).json({ error: 'message is required' });
  return steerTask(req, res, req.params.id, message);
}));

async function cancelTask(req, res, taskId) {
  const { rows } = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const task = rows[0];
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (task.status === 'cancelled') {
    return res.json({ taskId, status: 'cancelled', already: true });
  }
  await query(
    `UPDATE tasks SET status = 'cancelled', cancel_requested_at = now(), updated_at = now() WHERE id = $1`,
    [taskId]
  );
  const seqRow = await query(
    'UPDATE tasks SET control_seq = control_seq + 1 WHERE id = $1 RETURNING control_seq',
    [taskId]
  );
  const controlSeq = seqRow.rows[0].control_seq;
  await query(
    `INSERT INTO task_controls (task_id, control_seq, type, payload, status, applied_at)
     VALUES ($1, $2, 'cancel', '{}'::jsonb, 'applied', now())
     ON CONFLICT (task_id, control_seq) DO NOTHING`,
    [taskId, controlSeq]
  );
  const invalidated = await query(
    `UPDATE approvals SET status = 'invalidated', decided_at = now(), decided_by = 'system',
            decision_note = 'Invalidated — approve again'
      WHERE task_id = $1 AND status IN ('pending', 'approved') AND consumed_at IS NULL
      RETURNING id, eve_interaction_id, eve_session_id`,
    [taskId]
  );
  const cancelTargetId = task.target_id ?? isolation.CONTROL_PLANE_TARGET_ID;
  let cancelIdentity = null;
  try {
    cancelIdentity = await identityForTask(task);
  } catch (err) {
    if (isolation.isIsolatedDesktopTarget(cancelTargetId) && task.eve_session_id) {
      // Fail closed on legacy missing frozen identity — do not rebind to current managed.
      console.warn('[cancel] frozen identity missing', err.message);
    }
  }
  for (const inv of invalidated.rows) {
    if (inv.eve_interaction_id && inv.eve_session_id) {
      try {
        await eve.answerInteraction(
          inv.eve_session_id,
          inv.eve_interaction_id,
          'deny',
          'Task cancelled',
          { targetId: cancelTargetId, identity: cancelIdentity }
        );
      } catch (err) {
        console.warn('[cancel] failed to deny interaction', err.message);
      }
    }
  }
  let sessionCancel = 'not-attempted';
  if (task.eve_session_id) {
    try {
      if (isolation.isIsolatedDesktopTarget(cancelTargetId) && !cancelIdentity) {
        throw Object.assign(new Error('isolated_task_frozen_identity_missing'), { status: 409 });
      }
      await eve.cancelSession(task.eve_session_id, {
        targetId: cancelTargetId,
        identity: cancelIdentity,
      });
      sessionCancel = 'requested';
    } catch (err) {
      sessionCancel = `failed: ${String(err.message ?? err)}`;
    }
  }
  await events.audit('task_cancelled', { taskId, invalidatedApprovals: invalidated.rowCount, sessionCancel });
  return res.json({
    taskId,
    status: 'cancelled',
    controlSeq,
    invalidatedApprovals: invalidated.rowCount,
    sessionCancel,
    note: 'Already-performed actions are not undone. Sibling tasks and the main chat are unaffected.',
  });
}

app.post('/api/tasks/:id/cancel', asyncRoute((req, res) => cancelTask(req, res, req.params.id)));

// ---------------------------------------------------------------- execution targets

// GET /api/targets — execution-target surface (control plane default + isolated desktop).
// The isolated desktop is optional, never the host; unavailable => selector marks it so,
// without blocking the control plane.
app.get('/api/targets', asyncRoute(async (req, res) => {
  const probe = await isolation.probeIsolatedDesktop({ broker: BROKER });
  // not_started ≠ unavailable: only unavailable blocks composer dispatch.
  const isolatedState = probe.state ?? (probe.available ? 'ok' : 'unavailable');
  const targets = [
    {
      targetId: isolation.CONTROL_PLANE_TARGET_ID,
      label: 'Control plane',
      isDefault: true,
      available: true,
      state: 'ok',
      description: null,
    },
    {
      targetId: isolation.ISOLATED_DESKTOP_TARGET_ID,
      label: 'Isolated desktop',
      isDefault: false,
      available: isolatedState !== 'unavailable',
      state: isolatedState,
      description:
        'An isolated container on the same host as this Hamster. The bot cannot use the host itself.',
      unavailableReason: isolatedState === 'unavailable' ? probe.reason ?? 'unavailable' : null,
    },
  ];
  res.json({ targets });
}));

async function taskRowById(taskId) {
  const { rows } = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  return rows[0] ?? null;
}

/** Invalidate outstanding tickets when target changes or retry re-issues start. Exact copy. */
async function invalidateOutstandingTickets(taskId) {
  const { rows } = await query(
    `UPDATE approvals SET status = 'invalidated', decided_at = now(), decided_by = 'system',
            decision_note = $2
      WHERE task_id = $1 AND status IN ('pending', 'approved') AND consumed_at IS NULL
      RETURNING id, eve_interaction_id, eve_session_id, target_id`,
    [taskId, isolation.INVALIDATED_NOTE]
  );
  for (const inv of rows) {
    if (inv.eve_interaction_id && inv.eve_session_id) {
      try {
        const tid = inv.target_id || isolation.CONTROL_PLANE_TARGET_ID;
        const taskRes = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
        const taskRow = taskRes.rows[0];
        let identity = null;
        if (taskRow && isolation.isIsolatedDesktopTarget(tid)) {
          identity = await identityForTask(taskRow);
        }
        await eve.answerInteraction(
          inv.eve_session_id,
          inv.eve_interaction_id,
          'deny',
          isolation.INVALIDATED_NOTE,
          { targetId: tid, identity }
        );
      } catch (err) {
        console.warn('[approvals] invalidate deny not delivered', err.message);
      }
    }
  }
  return rows.length;
}

// Retry: only for tasks that have not started. Isolated-desktop tasks re-issue the
// high-risk create/start ticket (task stays Queued); prior start tickets are invalidated.
app.post('/api/tasks/:id/retry', asyncRoute(async (req, res) => {
  const task = await taskRowById(req.params.id);
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (task.status !== 'queued') {
    return res.status(409).json({ error: 'task_already_started' });
  }
  if (task.target_id === isolation.ISOLATED_DESKTOP_TARGET_ID) {
    await invalidateOutstandingTickets(task.id);
    const verified = await verifyIsolatedReuseOrDeny(null);
    const plan = isolation.planIsolatedCreateTask({ reuse: verified });
    if (plan.spawnSession && !plan.mintCreateTicket) {
      const guard = await guardIsolatedSessionIdentity(verified);
      if (guard.ok) {
        await startTaskSession(task.id);
        await events.audit('task_retry_isolated_reuse_running', {
          taskId: task.id,
          targetId: task.target_id,
          probe: verified.probe?.state,
          instanceId: guard.identity?.instanceId,
        });
        return res.json({ taskId: task.id, status: 'running', started: true, reused: true });
      }
      verified.reason = guard.reason || 'identity_recheck_failed';
    }
    const approvalId = `appr_${task.id}_create_${crypto.randomUUID()}`;
    const params = isolation.createIsolatedDesktopParams(task.id, task.target_id);
    const hash = policy.paramsHash(params);
    await query(
      `INSERT INTO approvals (id, task_id, action, params, params_hash, status, target_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, now() + ($7 || ' seconds')::interval)`,
      [approvalId, task.id, isolation.CREATE_ISOLATED_DESKTOP_ACTION, JSON.stringify(params), hash, task.target_id, String(APPROVAL_TTL_SECONDS)]
    );
    await events.audit('task_retry_requested', {
      taskId: task.id,
      approvalId,
      targetId: task.target_id,
      reuseDenied: verified.reason ?? null,
    });
    return res.json({ taskId: task.id, status: 'queued', approvalId, state: 'pending_approval' });
  }
  await startTaskSession(task.id);
  return res.json({ taskId: task.id, status: 'running', started: true });
}));

// Switch execution target for a task that has not started (Queued). Changing run location
// is NOT Steer and NOT Cancel; running tasks have no migrate-to-control-plane path.
// Outstanding tickets are invalidated ("Invalidated — approve again").
app.post('/api/tasks/:id/target', asyncRoute(async (req, res) => {
  const task = await taskRowById(req.params.id);
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (task.status !== 'queued') {
    return res.status(409).json({ error: 'task_already_started' });
  }
  const targetId = req.body?.targetId;
  if (!isolation.isKnownTarget(targetId)) {
    return res.status(400).json({ error: 'unknown_target' });
  }
  await invalidateOutstandingTickets(task.id);
  await query('UPDATE tasks SET target_id = $1, updated_at = now() WHERE id = $2', [targetId, task.id]);
  if (targetId === isolation.ISOLATED_DESKTOP_TARGET_ID) {
    const verified = await verifyIsolatedReuseOrDeny(null);
    const plan = isolation.planIsolatedCreateTask({ reuse: verified });
    if (plan.spawnSession && !plan.mintCreateTicket) {
      const guard = await guardIsolatedSessionIdentity(verified);
      if (guard.ok) {
        await startTaskSession(task.id);
        await events.audit('task_target_switched_isolated_reuse_running', {
          taskId: task.id,
          targetId,
          probe: verified.probe?.state,
          instanceId: guard.identity?.instanceId,
        });
        return res.json({
          taskId: task.id,
          status: 'running',
          started: true,
          switchedTo: 'isolated_desktop',
          reused: true,
        });
      }
      verified.reason = guard.reason || 'identity_recheck_failed';
    }
    // Re-issue the high-risk create/start ticket; task stays Queued (not started).
    const approvalId = `appr_${task.id}_create_${crypto.randomUUID()}`;
    const params = isolation.createIsolatedDesktopParams(task.id, targetId);
    const hash = policy.paramsHash(params);
    await query(
      `INSERT INTO approvals (id, task_id, action, params, params_hash, status, target_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, now() + ($7 || ' seconds')::interval)`,
      [approvalId, task.id, isolation.CREATE_ISOLATED_DESKTOP_ACTION, JSON.stringify(params), hash, targetId, String(APPROVAL_TTL_SECONDS)]
    );
    await events.audit('task_target_switched_to_isolated', {
      taskId: task.id,
      approvalId,
      targetId,
      reuseDenied: verified.reason ?? null,
    });
    return res.json({ taskId: task.id, status: 'queued', approvalId, state: 'pending_approval' });
  }
  // Switched to the control plane explicitly; only an unstarted task may do this.
  await startTaskSession(task.id);
  return res.json({ taskId: task.id, status: 'running', started: true, switchedTo: 'control_plane' });
}));

// ------------------------------------------------------------------- assets

app.get('/api/assets', asyncRoute(async (req, res) => {
  const { rows } = await query('SELECT * FROM assets ORDER BY created_at DESC LIMIT 100');
  res.json(rows.map(publicAsset));
}));

function publicAsset(a) {
  return {
    assetId: a.id,
    taskId: a.task_id,
    conversationId: a.conversation_id,
    title: a.title,
    source: a.source,
    layoutVersion: a.layout_version,
    freshness: a.freshness,
    lastSuccessAt: a.last_success_at,
    lastError: a.freshness === 'refresh_failed' ? a.last_error : null,
    publishedAt: a.published_at,
    publishedChannel: a.published_channel,
    createdAt: a.created_at,
  };
}

app.get('/api/assets/:id', asyncRoute(async (req, res) => {
  const { rows } = await query('SELECT * FROM assets WHERE id = $1', [req.params.id]);
  const asset = rows[0];
  if (!asset) return res.status(404).json({ error: 'asset not found' });
  if (asset.revoked_at) {
    return res.status(403).json({ error: 'asset_revoked', detail: 'Access to this asset was revoked. The cached snapshot is not served.' });
  }
  // Prefer the latest snapshot when present; otherwise the creation-time default.
  // Refresh mutates snapshot rows + freshness only — never the openui_document.
  const snap = await query(
    `SELECT data FROM asset_snapshots WHERE asset_id = $1 ORDER BY id DESC LIMIT 1`,
    [asset.id]
  );
  const data = snap.rows[0]?.data ?? asset.default_data;
  res.json({
    assetId: asset.id,
    taskId: asset.task_id,
    conversationId: asset.conversation_id,
    title: asset.title,
    source: asset.source,
    layoutVersion: asset.layout_version,
    freshness: asset.freshness,
    lastSuccessAt: asset.last_success_at,
    lastError: asset.freshness === 'refresh_failed' ? asset.last_error : null,
    publishedAt: asset.published_at,
    openui: asset.openui_document,
    bindings: asset.bindings,
    data,
  });
}));

// toolProvider target: fetch one named query's fresh data. Also refreshes the
// server-side snapshot so "Last succeeded at {time}" stays truthful.
app.get('/api/assets/:id/query/:name', asyncRoute(async (req, res) => {
  const { rows } = await query('SELECT * FROM assets WHERE id = $1', [req.params.id]);
  const asset = rows[0];
  if (!asset) return res.status(404).json({ error: 'asset_not_found' });
  if (asset.revoked_at) {
    return res.status(403).json({ error: 'asset_revoked' });
  }
  if (req.params.name !== 'metrics_weekly') {
    return res.status(404).json({ error: `unknown named query: ${req.params.name}` });
  }
  try {
    const data = await namedQueries.runNamedQuery(pool, 'metrics_weekly');
    await query('INSERT INTO asset_snapshots (asset_id, query_name, data) VALUES ($1, $2, $3)', [
      asset.id,
      'metrics_weekly',
      JSON.stringify(data),
    ]);
    await query(
      `UPDATE assets SET freshness = 'fresh', last_success_at = now(), last_error = NULL, updated_at = now() WHERE id = $1`,
      [asset.id]
    );
    res
      .set('x-hamster-last-success-at', new Date().toISOString())
      .set('cache-control', 'no-store')
      .json(data);
  } catch (err) {
    const message = String(err?.message ?? err);
    await query(
      `UPDATE assets SET freshness = 'refresh_failed', last_error = $2, updated_at = now() WHERE id = $1`,
      [asset.id, message]
    );
    res.status(503).json({ error: message });
  }
}));

app.post('/api/assets/:id/refresh', asyncRoute(async (req, res) => {
  const result = await assets.refreshAsset(req.params.id);
  if (!result.ok && result.error === 'asset_not_found') {
    return res.status(404).json({ error: 'asset_not_found' });
  }
  const status = result.ok ? 200 : 503;
  res.status(status).json(result);
}));

// ---------------------------------------------------------------- approvals

app.get('/api/approvals', asyncRoute(async (req, res) => {
  const status = String(req.query.status ?? '');
  const clause = status ? 'WHERE a.status = $1' : '';
  const params = status ? [status] : [];
  const { rows } = await query(
    `SELECT a.*, t.title AS task_title FROM approvals a JOIN tasks t ON t.id = a.task_id
      ${clause} ORDER BY a.requested_at DESC LIMIT 200`,
    params
  );
  res.json(rows.map((a) => ({
    id: a.id,
    taskId: a.task_id,
    taskTitle: a.task_title,
    action: a.action,
    params: a.params,
    status: a.status,
    requestedAt: a.requested_at,
    expiresAt: a.expires_at,
    decidedAt: a.decided_at,
    decisionNote: a.decision_note,
  })));
}));

app.post('/api/approvals/:id/approve', asyncRoute(async (req, res) => decideApproval(req, res, 'approved')));
app.post('/api/approvals/:id/deny', asyncRoute(async (req, res) => decideApproval(req, res, 'denied')));

async function decideApproval(req, res, outcome) {
  const { rows } = await query('SELECT * FROM approvals WHERE id = $1', [req.params.id]);
  const ticket = rows[0];
  if (!ticket) return res.status(404).json({ error: 'ticket not found' });
  if (ticket.status !== 'pending') {
    return res.status(409).json({ error: `ticket already ${ticket.status}`, status: ticket.status });
  }
  const task = await query('SELECT * FROM tasks WHERE id = $1', [ticket.task_id]);
  const taskRow = task.rows[0];
  if (taskRow && taskRow.status === 'cancelled') {
    await query(
      `UPDATE approvals SET status = 'invalidated', decided_at = now(), decided_by = 'system', decision_note = 'Invalidated — approve again' WHERE id = $1`,
      [ticket.id]
    );
    return res.status(409).json({ error: 'task_cancelled', status: 'invalidated' });
  }
  if (new Date(ticket.expires_at).getTime() <= Date.now()) {
    await expireTicket(ticket);
    return res.status(409).json({ error: 'expired', status: 'expired' });
  }

  const optionId = outcome === 'approved' ? 'approve' : 'deny';
  const isCreateIsolated =
    outcome === 'approved' && ticket.action === isolation.CREATE_ISOLATED_DESKTOP_ACTION;
  // For create/start, do not stamp "Approved for this action only" until readiness +
  // startTaskSession succeed. Otherwise a failed createSession would leave that surface.
  const note = outcome === 'approved'
    ? (isCreateIsolated ? null : isolation.APPROVED_ONCE_NOTE)
    : 'Denied';
  const ticketParams =
    ticket.params && typeof ticket.params === 'object' && !Array.isArray(ticket.params)
      ? ticket.params
      : {};
  // Fail closed: params.targetId is required — never invent it from the task's current target.
  const ticketTargetId =
    ticket.target_id ||
    (typeof ticketParams.targetId === 'string' ? ticketParams.targetId.trim() : null);
  if (outcome === 'approved') {
    if (!ticketTargetId || !ticketParams.targetId) {
      return res.status(409).json({ error: 'target_id_missing', status: 'invalid' });
    }
    if (taskRow && !policy.highRiskTargetAllows(taskRow, ticketParams).allowed) {
      return res.status(409).json({ error: 'target_mismatch', status: 'invalid' });
    }
  }
  const eveTargetId = ticketTargetId || taskRow?.target_id || isolation.CONTROL_PLANE_TARGET_ID;
  // Approval answers bind to the task's ORIGINAL frozen identity — never current managed.
  let eveIdentity = null;
  if (ticket.eve_interaction_id && ticket.eve_session_id) {
    try {
      eveIdentity = taskRow ? await identityForTask(taskRow) : null;
    } catch (err) {
      if (isolation.isIsolatedDesktopTarget(eveTargetId)) {
        return res.status(err.status || 409).json({ error: err.message });
      }
    }
  }
  if (ticket.eve_interaction_id && ticket.eve_session_id) {
    try {
      await eve.answerInteraction(
        ticket.eve_session_id,
        ticket.eve_interaction_id,
        optionId,
        note ?? isolation.APPROVED_ONCE_NOTE,
        { targetId: eveTargetId, identity: eveIdentity }
      );
    } catch (err) {
      // Fail closed: if the agent cannot be told, the action must not proceed.
      console.error('[approvals] failed to answer interaction', err);
      return res.status(502).json({
        error: 'agent_unreachable',
        detail: 'The approval could not be delivered to the worker; the action stays blocked.',
      });
    }
  }
  await query(
    `UPDATE approvals SET status = $1, decided_at = now(), decided_by = $2, decision_note = $3, consumed_at = NULL
      WHERE id = $4`,
    [outcome, req.body?.decidedBy ?? 'local-user', note, ticket.id]
  );
  await events.audit(`approval_${outcome}`, { approvalId: ticket.id, taskId: ticket.task_id }, req.body?.decidedBy ?? 'local-user');
  if (isCreateIsolated) {
    // Start goes through authorize() so the ticket is consumed exactly once for this start.
    // One start approval must not authorize later starts or in-container tools.
    const auth = await policy.authorize(
      ticket.task_id,
      isolation.CREATE_ISOLATED_DESKTOP_ACTION,
      ticketParams
    );
    if (!auth.allow) {
      await markIsolatedStartFailed(ticket.id, ticket.task_id);
      return res.status(409).json({ error: 'no_valid_ticket', status: 'invalidated', reason: auth.reason });
    }
    if (!isolation.isIsolatedDesktopTarget(ticketTargetId)) {
      await markIsolatedStartFailed(ticket.id, ticket.task_id);
      return res.status(409).json({ error: 'target_mismatch', status: 'invalidated' });
    }
    // Lifecycle: restart prior managed/stopped SAME instanceId; mint new only for create.
    // Foreign same-name → fail closed (no automatic stop/rm).
    const priorManaged = await getManagedIsolatedDesktop(ticketTargetId);
    const preProbe = await isolation.probeIsolatedDesktop({ broker: BROKER });
    const startPlan = isolation.resolveIsolatedStartIdentity({
      managed: priorManaged,
      probe: preProbe,
    });
    if (!startPlan.ok) {
      await markIsolatedStartFailed(ticket.id, ticket.task_id);
      return res.status(502).json({
        error: 'isolation_start_failed',
        taskId: ticket.task_id,
        targetId: ticketTargetId,
        reason: startPlan.reason,
        status: 'invalidated',
        state: 'start_failed',
      });
    }
    const instanceId =
      startPlan.mode === 'restart'
        ? startPlan.instanceId
        : `inst_${crypto.randomUUID()}`;
    // Restart pins to approved managed digest A — never freshly inspected tag B.
    const expectedImageId =
      startPlan.mode === 'restart' && priorManaged?.imageId ? priorManaged.imageId : null;
    const start = await isolation.startIsolatedDesktop({
      targetId: ticketTargetId,
      broker: BROKER,
      instanceId,
      approvalId: ticket.id,
      expectedImageId,
    });
    if (!start.ok) {
      await markIsolatedStartFailed(ticket.id, ticket.task_id);
      return res.status(502).json({
        error: 'isolation_start_failed',
        taskId: ticket.task_id,
        targetId: ticketTargetId,
        reason: start.reason,
        status: 'invalidated',
        state: 'start_failed',
      });
    }
    // Freeze identity from start() — never overwrite with a later status swap.
    let startedIdentity = {
      targetId: ticketTargetId,
      instanceId: start.instanceId || instanceId,
      containerId: start.containerId,
      imageId: start.imageId || '',
      configImage: start.configImage || isolation.ALLOWLISTED_IMAGE,
    };
    try {
      const status = await BROKER.status({ targetId: ticketTargetId });
      startedIdentity = isolation.mergeIdentityFillMissing(startedIdentity, {
        containerId: status?.containerId,
        imageId: status?.imageId,
        configImage: status?.configImage,
        instanceId: status?.instanceId,
        targetId: ticketTargetId,
      });
    } catch {
      // Keep start() identity; readiness / session guards still fail closed if unbound.
    }
    if (!startedIdentity.imageId || !startedIdentity.containerId || !startedIdentity.instanceId) {
      await markIsolatedStartFailed(ticket.id, ticket.task_id);
      return res.status(502).json({
        error: 'isolation_start_failed',
        taskId: ticket.task_id,
        targetId: ticketTargetId,
        reason: 'started_identity_incomplete',
        status: 'invalidated',
        state: 'start_failed',
      });
    }
    // Wait until isolated health binds targetId + instanceId before createSession.
    const ready = await readiness.waitForIsolatedDesktopReady({
      baseUrl: process.env.EVE_ISOLATED_API_URL || 'http://desktop:8081',
      expectedIdentity: {
        targetId: ticketTargetId,
        instanceId: startedIdentity.instanceId,
      },
      requireHealthIdentity: true,
    });
    if (!ready.ok) {
      await markIsolatedStartFailed(ticket.id, ticket.task_id);
      return res.status(502).json({
        error: 'isolation_not_ready',
        taskId: ticket.task_id,
        targetId: ticketTargetId,
        reason: ready.reason,
        status: 'invalidated',
        state: 'start_failed',
      });
    }
    // Session-creation boundary: probe+health must still match the started identity.
    // Managed provenance is recorded only after the full approve→start→ready→session chain.
    const probeBeforeSession = await isolation.probeIsolatedDesktop({ broker: BROKER });
    if (
      probeBeforeSession.state !== 'ok' ||
      !isolation.identitiesMatch(startedIdentity, {
        targetId: probeBeforeSession.targetId || ticketTargetId,
        instanceId: probeBeforeSession.instanceId,
        containerId: probeBeforeSession.containerId,
        imageId: probeBeforeSession.imageId,
      }) ||
      !isolation.imageIsAllowlisted(probeBeforeSession, {
        expectedImageId: startedIdentity.imageId,
        allowlistedImageId: probeBeforeSession.allowlistedImageId || startedIdentity.imageId,
      })
    ) {
      await markIsolatedStartFailed(ticket.id, ticket.task_id);
      return res.status(502).json({
        error: 'isolation_identity_recheck_failed',
        taskId: ticket.task_id,
        targetId: ticketTargetId,
        reason: 'identity_swapped_before_session',
        status: 'invalidated',
        state: 'start_failed',
      });
    }
    const healthBeforeSession = await readiness.checkIsolatedDesktopHealthOnce({
      baseUrl: process.env.EVE_ISOLATED_API_URL || 'http://desktop:8081',
      expectedIdentity: {
        targetId: ticketTargetId,
        instanceId: startedIdentity.instanceId,
      },
      requireHealthIdentity: true,
    });
    if (healthBeforeSession.ok !== true) {
      await markIsolatedStartFailed(ticket.id, ticket.task_id);
      return res.status(502).json({
        error: 'isolation_identity_recheck_failed',
        taskId: ticket.task_id,
        targetId: ticketTargetId,
        reason: healthBeforeSession.reason || 'health_recheck_failed',
        status: 'invalidated',
        state: 'start_failed',
      });
    }
    try {
      // Frozen start identity rides on the session request; worker gateway re-verifies.
      await startTaskSession(ticket.task_id, { identity: startedIdentity });
    } catch (err) {
      // createSession / attach failed: ticket must not remain Approved for this action only.
      await markIsolatedStartFailed(ticket.id, ticket.task_id);
      return res.status(502).json({
        error: 'isolation_session_failed',
        taskId: ticket.task_id,
        targetId: ticketTargetId,
        reason: String(err?.message ?? err),
        status: 'invalidated',
        state: 'start_failed',
      });
    }
    // Only Hamster-approved create/start that fully succeeded writes managed provenance
    // (never silently adopt an arbitrary externally created same-name runtime).
    await upsertManagedIsolatedDesktop({
      ...startedIdentity,
      approvalId: ticket.id,
      taskId: ticket.task_id,
    });
    // Success only: now stamp Approved for this action only (ticket already consumed).
    await query(
      `UPDATE approvals SET decision_note = $2 WHERE id = $1`,
      [ticket.id, isolation.APPROVED_ONCE_NOTE]
    );
    return res.json({
      id: ticket.id,
      status: outcome,
      note: isolation.APPROVED_ONCE_NOTE,
      taskId: ticket.task_id,
      instanceId: startedIdentity.instanceId,
      containerId: startedIdentity.containerId,
    });
  }
  await query(
    `UPDATE tasks SET status = 'running', updated_at = now()
      WHERE id = $1 AND status = 'waiting_for_approval'`,
    [ticket.task_id]
  );
  return res.json({ id: ticket.id, status: outcome, note, taskId: ticket.task_id });
}

/** Invalidate start ticket + keep task Queued so UI shows start_failed (not approved). */
async function markIsolatedStartFailed(ticketId, taskId) {
  await query(
    `UPDATE approvals SET status = 'invalidated', decision_note = $2, decided_at = now(), decided_by = 'system'
      WHERE id = $1`,
    [ticketId, isolation.INVALIDATED_NOTE]
  );
  // Ensure the task stays Queued with no session — execution state becomes start_failed.
  await query(
    `UPDATE tasks SET status = 'queued', eve_session_id = NULL, updated_at = now()
      WHERE id = $1 AND status IN ('queued', 'waiting_for_approval', 'running')`,
    [taskId]
  );
  await events.audit('isolation_start_failed', { approvalId: ticketId, taskId });
}

async function startTaskSession(taskId, opts = {}) {
  const task = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const t = task.rows[0];
  if (!t || t.eve_session_id) return t?.eve_session_id ?? null;
  const targetId = t.target_id ?? isolation.CONTROL_PLANE_TARGET_ID;
  // Route the worker to the runtime that belongs to this targetId (must-fix 3).
  // Isolated: freeze identity into session headers AND persist on the task row.
  // Later ops must use the persisted ORIGINAL identity — never re-read managed.
  let identity = opts.identity || null;
  if (isolation.isIsolatedDesktopTarget(targetId) && !identity) {
    identity = await getManagedIsolatedDesktop(targetId);
  }
  if (isolation.isIsolatedDesktopTarget(targetId)) {
    if (!identity?.instanceId || !identity?.imageId || !isolation.isCompleteImageDigest(identity.imageId)) {
      const err = new Error('isolated_session_identity_required:startTaskSession');
      err.status = 409;
      throw err;
    }
  }
  const { sessionId } = await eve.createSession(
    `[hamster-worker taskId=${t.id} conversationId=${t.conversation_id} targetId=${targetId} title=${t.title}] ${t.goal ?? ''}`,
    { targetId, identity }
  );
  await query(
    `UPDATE tasks SET eve_session_id = $1, status = $2,
       eve_instance_id = $3, eve_container_id = $4, eve_image_id = $5,
       updated_at = now() WHERE id = $6`,
    [
      sessionId,
      'running',
      identity?.instanceId || null,
      identity?.containerId || null,
      identity?.imageId || null,
      taskId,
    ],
  );
  events.attach(`task:${taskId}`, sessionId, { targetId, identity });
  return sessionId;
}

async function expireTicket(ticket) {
  const note = events.EXPIRY_NOTE;
  await query(
    `UPDATE approvals SET status = 'expired', decided_at = now(), decided_by = 'system', decision_note = $2
      WHERE id = $1 AND status = 'pending'`,
    [ticket.id, note]
  );
  if (ticket.eve_interaction_id && ticket.eve_session_id) {
    try {
      const task = await query('SELECT * FROM tasks WHERE id = $1', [ticket.task_id]);
      const taskRow = task.rows[0];
      const targetId =
        ticket.target_id ||
        taskRow?.target_id ||
        isolation.CONTROL_PLANE_TARGET_ID;
      let identity = null;
      if (taskRow && isolation.isIsolatedDesktopTarget(targetId)) {
        identity = await identityForTask(taskRow);
      }
      await eve.answerInteraction(ticket.eve_session_id, ticket.eve_interaction_id, 'deny', note, {
        targetId,
        identity,
      });
    } catch (err) {
      console.warn('[approvals] expiry deny not delivered', err.message);
    }
  }
  await query(
    `UPDATE tasks SET status = 'running', updated_at = now()
      WHERE id = $1 AND status = 'waiting_for_approval'`,
    [ticket.task_id]
  );
  await events.audit('approval_expired', { approvalId: ticket.id, taskId: ticket.task_id });
}

async function sweepExpired() {
  try {
    const { rows } = await query(
      `UPDATE approvals SET status = 'expired', decided_at = now(), decided_by = 'system', decision_note = $1
        WHERE status = 'pending' AND expires_at <= now() RETURNING *`,
      [events.EXPIRY_NOTE]
    );
    for (const ticket of rows) {
      if (ticket.eve_interaction_id && ticket.eve_session_id) {
        try {
          const task = await query('SELECT * FROM tasks WHERE id = $1', [ticket.task_id]);
          const taskRow = task.rows[0];
          const targetId =
            ticket.target_id ||
            taskRow?.target_id ||
            isolation.CONTROL_PLANE_TARGET_ID;
          let identity = null;
          if (taskRow && isolation.isIsolatedDesktopTarget(targetId)) {
            identity = await identityForTask(taskRow);
          }
          await eve.answerInteraction(
            ticket.eve_session_id,
            ticket.eve_interaction_id,
            'deny',
            events.EXPIRY_NOTE,
            { targetId, identity }
          );
        } catch (err) {
          console.warn('[approvals] expiry deny not delivered', err.message);
        }
      }
      await query(
        `UPDATE tasks SET status = 'running', updated_at = now()
          WHERE id = $1 AND status = 'waiting_for_approval'`,
        [ticket.task_id]
      );
      await events.audit('approval_expired', { approvalId: ticket.id, taskId: ticket.task_id });
    }
  } catch (err) {
    console.error('[approvals] sweep failed', err);
  }
}

// ----------------------------------------------------------------- internal

app.post('/internal/policy/check', requireInternal, asyncRoute(async (req, res) => {
  const { taskId, action, params } = req.body ?? {};
  const decision = await policy.authorize(String(taskId ?? ''), String(action ?? ''), params ?? {});
  res.json(decision);
}));

app.post('/internal/events', requireInternal, asyncRoute(async (req, res) => {
  const { taskId, kind, step = null, total = null, message } = req.body ?? {};
  if (!taskId || !kind || !message) {
    return res.status(400).json({ error: 'taskId, kind and message are required' });
  }
  const task = await query('SELECT status FROM tasks WHERE id = $1', [taskId]);
  if (task.rows.length === 0) return res.status(404).json({ error: 'task not found' });
  if (task.rows[0].status === 'cancelled') {
    // Cancelled tasks forbid later new tool calls, including durable writes.
    return res.status(409).json({ error: 'task_cancelled' });
  }
  const ev = await events.appendTaskEvent(taskId, { kind, message, step, total });
  if (kind === 'failure') {
    // Design-table terminal status is Failed — never leave a still-Running card
    // beside a "halted" chat line for this task.
    await query(
      `UPDATE tasks SET status = 'failed', updated_at = now()
        WHERE id = $1 AND status NOT IN ('cancelled')`,
      [taskId]
    );
  } else {
    await query(
      `UPDATE tasks SET status = 'running', updated_at = now()
        WHERE id = $1 AND status IN ('queued', 'waiting_for_approval')`,
      [taskId]
    );
  }
  res.status(201).json({ seq: ev?.seq ?? null });
}));

app.post('/internal/assets', requireInternal, asyncRoute(async (req, res) => {
  const { taskId, title } = req.body ?? {};
  if (!taskId || !title) return res.status(400).json({ error: 'taskId and title are required' });
  const task = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const taskRow = task.rows[0];
  if (!taskRow) return res.status(404).json({ error: 'task not found' });
  if (taskRow.status === 'cancelled') return res.status(409).json({ error: 'task_cancelled' });

  const snapshot = await namedQueries.runNamedQuery(pool, 'metrics_weekly');
  const asset = await assets.createAsset({
    taskId,
    conversationId: taskRow.conversation_id,
    title: String(title),
    bindings: [{ query: 'metrics_weekly', args: { rev: '$rev' } }],
    defaultData: snapshot,
    buildDocument: (id, snap) => assets.buildDashboardDocument(id, 'metrics_weekly', snap),
  });
  if (!taskRow.asset_id) {
    await query('UPDATE tasks SET asset_id = $1, updated_at = now() WHERE id = $2', [asset.id, taskId]);
  }
  await events.audit('asset_created', { assetId: asset.id, taskId });
  res.status(201).json({ assetId: asset.id, url: `/assets/${asset.id}` });
}));

app.post('/internal/assets/:id/publish', requireInternal, asyncRoute(async (req, res) => {
  const { taskId, channel } = req.body ?? {};
  const asset = await query('SELECT * FROM assets WHERE id = $1', [req.params.id]);
  if (asset.rows.length === 0) return res.status(404).json({ error: 'asset_not_found' });
  const task = await query('SELECT status FROM tasks WHERE id = $1', [taskId]);
  if (task.rows[0]?.status === 'cancelled') return res.status(409).json({ error: 'task_cancelled' });
  await query('UPDATE assets SET published_at = now(), published_channel = $2, updated_at = now() WHERE id = $1', [
    req.params.id,
    String(channel ?? 'shared workspace'),
  ]);
  await events.audit('asset_published', { assetId: req.params.id, taskId, channel });
  res.json({ assetId: req.params.id, published: true, channel: String(channel ?? 'shared workspace') });
}));

app.post('/internal/controls/:taskId/:seq/applied', requireInternal, asyncRoute(async (req, res) => {
  const seq = Number(req.params.seq);
  const result = await query(
    `UPDATE task_controls SET status = 'applied', applied_at = now()
      WHERE task_id = $1 AND control_seq = $2 AND type = 'steer' AND status != 'applied' RETURNING *`,
    [req.params.taskId, seq]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'control not found or already applied' });
  }
  await events.audit('steer_applied', { taskId: req.params.taskId, controlSeq: seq });
  res.json({ taskId: req.params.taskId, controlSeq: seq, status: 'applied' });
}));

// Approval expiry sweeper: fail closed when nobody decides in time.

// ------------------------------------------------------------ error handler

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[api] unhandled error', err);
  res.status(500).json({ error: String(err?.message ?? err) });
});

// --------------------------------------------------------------------- boot

async function reattachFollowers() {
  const [tasks, convs] = await Promise.all([
    query(
      `SELECT id, eve_session_id, target_id, eve_instance_id, eve_container_id, eve_image_id
       FROM tasks WHERE eve_session_id IS NOT NULL AND status NOT IN ('succeeded','failed','cancelled')`,
    ),
    query('SELECT id, eve_session_id FROM conversations WHERE eve_session_id IS NOT NULL'),
  ]);
  for (const t of tasks.rows) {
    const tid = t.target_id ?? isolation.CONTROL_PLANE_TARGET_ID;
    let identity = null;
    try {
      identity = await identityForTask(t);
    } catch (err) {
      console.warn('[reattach] refusing stream without frozen identity', t.id, err.message);
      continue;
    }
    events.attach(`task:${t.id}`, t.eve_session_id, {
      targetId: tid,
      identity,
    });
  }
  for (const c of convs.rows) {
    events.attach(`conv:${c.id}`, c.eve_session_id, {
      targetId: isolation.CONTROL_PLANE_TARGET_ID,
    });
  }
}

async function bootHttpServer() {
  await migrate();
  await namedQueries.seedMetrics(pool);
  await defaultConversation();
  await reattachFollowers();
  setInterval(sweepExpired, 15000).unref();
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`Hamster control plane listening on port ${PORT}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  bootHttpServer().catch((err) => {
    console.error('Fatal boot error', err);
    process.exit(1);
  });
} else {
  module.exports = {
    app,
    migrate,
    defaultConversation,
    setIsolationBrokerForTests,
    getManagedIsolatedDesktop,
    upsertManagedIsolatedDesktop,
    frozenIdentityFromTask,
    identityForTask,
    identityForTarget,
    INTERNAL_SECRET,
    pool,
    bootHttpServer,
  };
}
