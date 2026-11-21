'use strict';

/**
 * Offline business TDD for production progress target selection.
 * Calls the real shared selectProgressTarget (not a copied router).
 * Stubs only: query / findActiveTask. No index.js / db.js / listen / PG / GUI.
 */

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

function clearSecretsAndProxies() {
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DATABASE_URL;
  delete process.env.HAMSTER_DB_PASSWORD;
  delete process.env.HAMSTER_AGENT_PASSWORD;
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  delete process.env.ALL_PROXY;
  delete process.env.http_proxy;
  delete process.env.https_proxy;
  delete process.env.all_proxy;
  delete process.env.NO_PROXY;
  delete process.env.no_proxy;
}

function installNetworkDeny() {
  const deny = () => {
    throw new Error('NETWORK_DENIED: progressTarget tests must not call network');
  };
  globalThis.fetch = deny;
  http.request = deny;
  http.get = deny;
  https.request = deny;
  https.get = deny;
  net.connect = deny;
  net.createConnection = deny;
  net.Socket.prototype.connect = deny;
}

before(() => {
  clearSecretsAndProxies();
  installNetworkDeny();
});

beforeEach(() => {
  clearSecretsAndProxies();
});

const { selectProgressTarget } = require('./progressTarget.js');

const CONV_A = 'conv_a';
const CONV_B = 'conv_b';
const CANCELLED_ID = 'task_cancelled_001';
const RUNNING_ID = 'task_running_002';
const UNKNOWN_ID = 'task_unknown_999';
const OTHER_CONV_ID = 'task_other_conv_003';

function makeFixture() {
  const tasks = new Map([
    [
      CANCELLED_ID,
      {
        id: CANCELLED_ID,
        conversation_id: CONV_A,
        title: 'old',
        status: 'cancelled',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    [
      RUNNING_ID,
      {
        id: RUNNING_ID,
        conversation_id: CONV_A,
        title: 'live',
        status: 'running',
        created_at: '2026-01-02T00:00:00.000Z',
      },
    ],
    [
      OTHER_CONV_ID,
      {
        id: OTHER_CONV_ID,
        conversation_id: CONV_B,
        title: 'elsewhere',
        status: 'running',
        created_at: '2026-01-03T00:00:00.000Z',
      },
    ],
  ]);

  const calls = { query: [], findActiveTask: 0 };

  async function query(sql, params = []) {
    calls.query.push({ sql, params });
    if (sql.includes('FROM tasks') && sql.includes('id = $1') && sql.includes('conversation_id')) {
      const [id, conversationId] = params;
      const row = tasks.get(id);
      if (row && row.conversation_id === conversationId) return { rows: [row] };
      return { rows: [] };
    }
    if (sql.includes('FROM tasks') && sql.includes('id = $1')) {
      const row = tasks.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    throw new Error(`unexpected SQL in offline fixture (not a DB claim): ${sql.slice(0, 80)}`);
  }

  // Mirrors baseline findActiveTask priority: active statuses first, then newest.
  async function findActiveTask(conversationId) {
    calls.findActiveTask += 1;
    const rows = [...tasks.values()].filter((t) => t.conversation_id === conversationId);
    rows.sort((a, b) => {
      const active = (s) => (['queued', 'running', 'waiting_for_approval'].includes(s) ? 0 : 1);
      const byStatus = active(a.status) - active(b.status);
      if (byStatus !== 0) return byStatus;
      return a.created_at < b.created_at ? 1 : -1;
    });
    return rows[0] ?? null;
  }

  return { query, findActiveTask, calls, tasks };
}

test('explicit cancelled id with running sibling: progress selects the cancelled card (not findActiveTask sibling)', async () => {
  const { query, findActiveTask, calls } = makeFixture();
  const result = await selectProgressTarget({
    conversationId: CONV_A,
    text: `progress ${CANCELLED_ID}`,
    query,
    findActiveTask,
  });

  assert.equal(result.matched, true);
  assert.ok(result.task, 'must resolve a task');
  // Business contract: TaskCard progress for this id must not silently switch to the running sibling.
  assert.equal(result.task.id, CANCELLED_ID);
  assert.equal(result.task.status, 'cancelled');
  assert.equal(result.usedExplicitId, CANCELLED_ID);
  assert.equal(result.usedFindActive, false);
  assert.equal(calls.findActiveTask, 0, 'explicit in-conversation id must not call findActiveTask');
});

test('unknown explicit id: no task, no silent fallback to another task', async () => {
  const { query, findActiveTask, calls } = makeFixture();
  const result = await selectProgressTarget({
    conversationId: CONV_A,
    text: `progress ${UNKNOWN_ID}`,
    query,
    findActiveTask,
  });

  assert.equal(result.matched, true);
  assert.equal(result.task, null);
  assert.equal(result.usedExplicitId, UNKNOWN_ID);
  assert.equal(result.usedFindActive, false);
  assert.equal(calls.findActiveTask, 0);
});

test('cross-conversation explicit id: no leak / no silent fallback to this conversation’s active task', async () => {
  const { query, findActiveTask, calls } = makeFixture();
  const result = await selectProgressTarget({
    conversationId: CONV_A,
    text: `progress ${OTHER_CONV_ID}`,
    query,
    findActiveTask,
  });

  assert.equal(result.matched, true);
  assert.equal(result.task, null, 'must not return a task from another conversation');
  assert.equal(result.usedExplicitId, OTHER_CONV_ID);
  assert.equal(result.usedFindActive, false);
  assert.equal(calls.findActiveTask, 0);
});

test('no explicit id: preserve findActiveTask behavior (running sibling wins)', async () => {
  const { query, findActiveTask, calls } = makeFixture();
  const result = await selectProgressTarget({
    conversationId: CONV_A,
    text: 'progress',
    query,
    findActiveTask,
  });

  assert.equal(result.matched, true);
  assert.equal(result.task.id, RUNNING_ID);
  assert.equal(result.task.status, 'running');
  assert.equal(result.usedExplicitId, null);
  assert.equal(result.usedFindActive, true);
  assert.equal(calls.findActiveTask, 1);
  assert.equal(calls.query.length, 0, 'no-id path must not query by id');
});
