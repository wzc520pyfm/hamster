'use strict';

/**
 * Side-effect-free progress target selection for the control-plane message router.
 * Does not load index.js / db.js; does not listen, migrate, or touch the network.
 * Callers inject { query, findActiveTask }.
 *
 * GREEN: honor an explicit task_ id only when it belongs to the current conversation.
 * Unknown / cross-conversation ids return null (no silent findActiveTask fallback).
 * No id keeps baseline findActiveTask behavior.
 */

const PROGRESS_RE = /^(?:progress|status|进度|任务进度)\b(?:\s+(\S+))?/i;

/**
 * @param {{
 *   conversationId: string,
 *   text: string,
 *   query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>,
 *   findActiveTask: (conversationId: string) => Promise<any|null>,
 * }} deps
 * @returns {Promise<{
 *   matched: boolean,
 *   task: any|null,
 *   usedExplicitId: string|null,
 *   usedFindActive: boolean,
 * }>}
 */
async function selectProgressTarget(deps) {
  const { conversationId, text, query, findActiveTask } = deps;
  const raw = String(text ?? '').trim();
  const m = raw.match(PROGRESS_RE);
  if (!m) {
    return { matched: false, task: null, usedExplicitId: null, usedFindActive: false };
  }

  const candidate = m[1] ?? null;
  const explicitId = candidate && String(candidate).startsWith('task_') ? String(candidate) : null;

  if (explicitId) {
    // Conversation-scoped lookup only — do not fall back to another task on miss.
    const { rows } = await query(
      'SELECT * FROM tasks WHERE id = $1 AND conversation_id = $2',
      [explicitId, conversationId],
    );
    return {
      matched: true,
      task: rows[0] ?? null,
      usedExplicitId: explicitId,
      usedFindActive: false,
    };
  }

  const task = await findActiveTask(conversationId);
  return {
    matched: true,
    task,
    usedExplicitId: null,
    usedFindActive: true,
  };
}

module.exports = {
  selectProgressTarget,
  PROGRESS_RE,
};
