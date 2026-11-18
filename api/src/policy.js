'use strict';

const crypto = require('crypto');
const { query } = require('./db');

const HIGH_RISK_ACTIONS = new Set(['publish_dashboard']);
const LOW_RISK_ACTIONS = new Set(['record_task_event', 'save_dashboard_page', 'acknowledge_control']);

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

function paramsHash(params) {
  return crypto.createHash('sha256').update(canonicalJson(params ?? {})).digest('hex');
}

async function getTask(taskId) {
  const { rows } = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  return rows[0] ?? null;
}

// authorize(): the product policy layer. Enforced regardless of eve's approval config.
// - Unknown actions are denied.
// - Any action for a cancelled task is denied (forbids later new tool calls).
// - High-risk actions require an approved, unexpired, unused ticket whose params_hash
//   matches exactly; approval is consumed exactly once.
async function authorize(taskId, action, params) {
  if (!HIGH_RISK_ACTIONS.has(action) && !LOW_RISK_ACTIONS.has(action)) {
    return { allow: false, reason: `unknown_action:${action}` };
  }
  const task = await getTask(taskId);
  if (!task) return { allow: false, reason: 'task_not_found' };
  if (task.status === 'cancelled') {
    return { allow: false, reason: 'task_cancelled' };
  }

  if (LOW_RISK_ACTIONS.has(action)) {
    if (action === 'acknowledge_control') {
      const seq = Number(params?.controlSeq);
      if (!Number.isInteger(seq) || seq <= 0) {
        return { allow: false, reason: 'bad_control_seq' };
      }
      const { rows } = await query(
        'SELECT 1 FROM task_controls WHERE task_id = $1 AND control_seq = $2',
        [taskId, seq]
      );
      if (rows.length === 0) return { allow: false, reason: 'control_seq_not_found' };
    }
    return { allow: true };
  }

  // publish_dashboard: consume one matching approved ticket.
  const hash = paramsHash(params);
  const { rows } = await query(
    `UPDATE approvals
        SET consumed_at = now()
      WHERE id = (
        SELECT id FROM approvals
         WHERE task_id = $1 AND action = $2 AND params_hash = $3
           AND status = 'approved' AND consumed_at IS NULL AND expires_at > now()
         ORDER BY requested_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id`,
    [taskId, action, hash]
  );
  if (rows.length === 0) {
    return { allow: false, reason: 'no_valid_ticket' };
  }
  return { allow: true, ticketId: rows[0].id };
}

module.exports = { authorize, paramsHash, canonicalJson, HIGH_RISK_ACTIONS };
