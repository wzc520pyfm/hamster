'use strict';

/**
 * Offline business TDD for production createTask catch → taskDetail.failureReason.
 * Calls the real shared createTaskLifecycle (not a copied helper).
 * Stubs only: query / eve / audit / appendTaskEvent / attach.
 * Does not require index.js or db.js. No listen / migrate / PG / agent / model.
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
    throw new Error('NETWORK_DENIED: taskLifecycle tests must not call network');
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

const {
  createTaskLifecycle,
  failureReasonFromEvents,
  safeSpawnFailureMessage,
} = require('./taskLifecycle.js');

/** Minimal in-memory stand-in for the SQL shapes createTask/taskDetail issue. Not a real DB claim. */
function makeMemoryDeps(eveImpl) {
  const tasks = new Map();
  const eventsByTask = new Map();
  const audits = [];
  const calls = { query: [], audit: [], appendTaskEvent: [], attach: [], createSession: 0 };

  async function query(sql, params = []) {
    calls.query.push({ sql, params });
    if (sql.startsWith('INSERT INTO tasks')) {
      const [id, conversationId, title, status] = params;
      const row = {
        id,
        conversation_id: conversationId,
        title,
        status,
        eve_session_id: null,
        asset_id: null,
        control_seq: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        cancel_requested_at: null,
      };
      tasks.set(id, row);
      return { rows: [row] };
    }
    if (sql.startsWith('UPDATE tasks SET eve_session_id')) {
      const [sessionId, status, id] = params;
      const row = tasks.get(id);
      row.eve_session_id = sessionId;
      row.status = status;
      row.updated_at = new Date().toISOString();
      return { rows: [row] };
    }
    if (sql.startsWith('UPDATE tasks SET status')) {
      const [status, id] = params;
      const row = tasks.get(id);
      row.status = status;
      row.updated_at = new Date().toISOString();
      return { rows: [row] };
    }
    if (sql.startsWith('SELECT * FROM tasks WHERE id')) {
      const row = tasks.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('FROM task_events')) {
      return { rows: [...(eventsByTask.get(params[0]) ?? [])] };
    }
    if (sql.includes('FROM task_controls')) return { rows: [] };
    if (sql.includes('FROM approvals')) return { rows: [] };
    throw new Error(`unexpected SQL in offline fixture (not a DB claim): ${sql.slice(0, 80)}`);
  }

  const deps = {
    query,
    eve: {
      createSession: async (prompt) => {
        calls.createSession += 1;
        return eveImpl.createSession(prompt);
      },
    },
    audit: async (action, detail) => {
      calls.audit.push({ action, detail });
      audits.push({ action, detail });
    },
    appendTaskEvent: async (taskId, event) => {
      calls.appendTaskEvent.push({ taskId, event });
      const list = eventsByTask.get(taskId) ?? [];
      const row = {
        seq: list.length + 1,
        kind: event.kind,
        message: event.message,
        step: null,
        total: null,
        created_at: new Date().toISOString(),
      };
      list.push(row);
      eventsByTask.set(taskId, list);
      return row;
    },
    attach: (key, sessionId) => {
      calls.attach.push({ key, sessionId });
    },
  };

  return { deps, tasks, eventsByTask, audits, calls };
}

test('production createTask catch → taskDetail: spawn failure yields status=failed and non-null failureReason for TaskCard', async () => {
  const { deps, calls } = makeMemoryDeps({
    createSession: async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:8081');
    },
  });
  const { createTask } = createTaskLifecycle(deps);

  const { task, spawnError } = await createTask('conv_1', 'demo', 'build weekly metrics');

  assert.equal(calls.createSession, 1);
  assert.equal(task.status, 'failed');
  assert.ok(spawnError, 'chat spawnError must remain available');
  assert.equal(
    calls.audit.some((a) => a.action === 'task_spawn_failed'),
    true,
    'audit task_spawn_failed must be preserved',
  );
  assert.equal(calls.attach.length, 0, 'failure path must not attach session');
  // Business contract: TaskCard needs failureReason from kind=failure events.
  assert.equal(task.failureReason, spawnError);
  assert.ok(task.failureReason, 'failureReason must be non-null so TaskCard can render it');
  assert.equal(failureReasonFromEvents(task.events), task.failureReason);
  assert.equal(
    calls.appendTaskEvent.some((c) => c.event.kind === 'failure'),
    true,
    'createTask catch must append kind=failure task_event (not audit-only)',
  );
});

test('production createTask catch: secret-bearing error redacted in failure event/card/audit/chat', async () => {
  const { deps, calls, audits } = makeMemoryDeps({
    createSession: async () => {
      throw new Error(
        'upstream Authorization: Basic dXNlcjpwYXNz db=postgres://hamster:s3cret@db:5432/h Bearer sk-abcdefghijklmnopqrstuvwxyz DEEPSEEK_API_KEY=sk-should-not-leak',
      );
    },
  });
  const { createTask } = createTaskLifecycle(deps);
  const { task, spawnError } = await createTask('conv_1', 'demo', 'goal');

  assert.equal(task.status, 'failed');
  assert.equal(task.failureReason, spawnError);
  for (const sample of [spawnError, task.failureReason, audits[0].detail.error]) {
    assert.doesNotMatch(sample, /dXNlcjpwYXNz/);
    assert.doesNotMatch(sample, /s3cret/);
    assert.doesNotMatch(sample, /sk-abcdefghijklmnopqrstuvwxyz/);
    assert.doesNotMatch(sample, /sk-should-not-leak/);
    assert.match(sample, /Basic\s+\[redacted\]/i);
    assert.match(sample, /postgres:\/\/\[redacted\]@/);
    assert.match(sample, /Bearer\s+\[redacted\]/i);
    assert.match(sample, /DEEPSEEK_API_KEY=\[redacted\]/);
  }
  assert.equal(calls.appendTaskEvent[0].event.message, spawnError);
});

test('production createTask success path: running + attach; no failure event/audit', async () => {
  const { deps, calls } = makeMemoryDeps({
    createSession: async () => ({ sessionId: 'sess_ok_1' }),
  });
  const { createTask } = createTaskLifecycle(deps);
  const { task, spawnError } = await createTask('conv_1', 'demo', 'goal');

  assert.equal(spawnError, undefined);
  assert.equal(task.status, 'running');
  assert.equal(task.failureReason, null);
  assert.equal(calls.attach.length, 1);
  assert.equal(calls.audit.length, 0);
  assert.equal(calls.appendTaskEvent.length, 0);
});

test('safeSpawnFailureMessage: Basic credentials and URL userinfo redacted; Bearer/sk-/KEY kept', () => {
  assert.match(
    safeSpawnFailureMessage(new Error('Authorization: Basic dXNlcjpwYXNz')),
    /Basic\s+\[redacted\]/i,
  );
  assert.doesNotMatch(
    safeSpawnFailureMessage(new Error('Authorization: Basic dXNlcjpwYXNz')),
    /dXNlcjpwYXNz/,
  );
  assert.match(
    safeSpawnFailureMessage(new Error('db postgres://hamster:s3cret@db:5432/hamster')),
    /postgres:\/\/\[redacted\]@/,
  );
  assert.doesNotMatch(
    safeSpawnFailureMessage(new Error('db postgres://hamster:s3cret@db:5432/hamster')),
    /s3cret/,
  );
  {
    const u = safeSpawnFailureMessage(new Error('proxy https://user:p@ss@host.example/path'));
    assert.match(u, /https:\/\/\[redacted\]@host\.example/);
    assert.doesNotMatch(u, /p@ss/);
  }
  assert.match(
    safeSpawnFailureMessage(new Error('Bearer sk-abcdefghijklmnopqrstuvwxyz')),
    /Bearer\s+\[redacted\]/i,
  );
  assert.doesNotMatch(
    safeSpawnFailureMessage(new Error('Bearer sk-abcdefghijklmnopqrstuvwxyz')),
    /sk-abcdefghijklmnopqrstuvwxyz/,
  );
  assert.match(
    safeSpawnFailureMessage(new Error('DEEPSEEK_API_KEY=sk-should-not-leak')),
    /DEEPSEEK_API_KEY=\[redacted\]/,
  );
});
