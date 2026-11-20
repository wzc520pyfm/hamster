'use strict';

/**
 * P2 isolated HTTP integration — real API routes + real Postgres + fake broker/health.
 * NOT the box live stack. Fake broker never calls docker / never stops a live desktop.
 *
 * Covers: managed provenance reuse, negatives (wrong image, spoofed health, identity
 * swap, unmanaged same-name), and a real authorize HTTP approve→start→session chain.
 *
 * Run:
 *   DATABASE_URL=postgres://hamster:changeme@127.0.0.1:5432/hamster_p2_test \
 *   node --test api/src/isolatedReuse.http.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://hamster:changeme@127.0.0.1:5432/hamster_p2_test';
process.env.DATABASE_URL = DATABASE_URL;
process.env.HAMSTER_INTERNAL_SECRET = process.env.HAMSTER_INTERNAL_SECRET || 'test-internal-secret';
process.env.HAMSTER_DB_PASSWORD = process.env.HAMSTER_DB_PASSWORD || 'changeme';

const isolation = require('./isolation');
const policy = require('./policy');

const ISOLATED = isolation.ISOLATED_DESKTOP_TARGET_ID;
const CONTROL = isolation.CONTROL_PLANE_TARGET_ID;

const FIX = {
  instanceId: 'inst_http_1',
  containerId: 'ctr_http_1',
  imageId: 'sha256:httpimg1',
  configImage: isolation.ALLOWLISTED_IMAGE,
};

function startFakeEve(identityState) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/eve/v1/health') {
      const mode = server.__healthMode || 'ok';
      if (mode === 'ok') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            targetId: ISOLATED,
            instanceId: identityState.instanceId,
          }),
        );
        return;
      }
      if (mode === 'spoof') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            targetId: ISOLATED,
            instanceId: 'inst_SPOOFED',
          }),
        );
        return;
      }
      if (mode === 'unbound') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    if (url.pathname === '/eve/v1/session' && req.method === 'POST') {
      const sessionId = `sess_${crypto.randomUUID()}`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sessionId, deliveryId: `del_${sessionId}` }));
      return;
    }
    if (url.pathname.includes('/stream')) {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end('');
      return;
    }
    res.writeHead(404).end('no');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function fakeBroker(state, identityState) {
  let startCalls = 0;
  return {
    startCalls: () => startCalls,
    start: async ({ instanceId, approvalId }) => {
      startCalls += 1;
      if (state.rejectUnmanaged) {
        return { ok: false, reason: 'unmanaged_or_foreign_container_present' };
      }
      identityState.instanceId = instanceId;
      identityState.containerId = `ctr_${instanceId}`;
      identityState.imageId = FIX.imageId;
      identityState.configImage = state.evilImage
        ? 'evil/other:latest'
        : isolation.ALLOWLISTED_IMAGE;
      identityState.managed = isolation.MANAGED_LABEL_VALUE;
      identityState.approvalId = approvalId;
      state.mode = 'ok';
      return {
        ok: true,
        containerId: identityState.containerId,
        imageId: identityState.imageId,
        configImage: identityState.configImage,
        instanceId: identityState.instanceId,
      };
    },
    status: async () => {
      if (state.mode === 'ok') {
        return {
          ok: true,
          running: true,
          state: 'ok',
          containerId: identityState.containerId,
          imageId: identityState.imageId,
          configImage: identityState.configImage,
          instanceId: identityState.instanceId,
          managed: identityState.managed,
          targetId: ISOLATED,
        };
      }
      if (state.mode === 'not_started') {
        return { ok: false, running: false, state: 'not_started' };
      }
      if (state.mode === 'swap') {
        return {
          ok: true,
          running: true,
          state: 'ok',
          containerId: 'ctr_SWAPPED',
          imageId: identityState.imageId,
          configImage: identityState.configImage,
          instanceId: identityState.instanceId,
          managed: isolation.MANAGED_LABEL_VALUE,
          targetId: ISOLATED,
        };
      }
      if (state.mode === 'wrong_image') {
        return {
          ok: true,
          running: true,
          state: 'ok',
          containerId: identityState.containerId,
          imageId: 'sha256:evil',
          configImage: 'evil/other:latest',
          instanceId: identityState.instanceId,
          managed: isolation.MANAGED_LABEL_VALUE,
          targetId: ISOLATED,
        };
      }
      if (state.mode === 'external_same_name') {
        return {
          ok: true,
          running: true,
          state: 'ok',
          containerId: 'ctr_external_same_name',
          imageId: 'sha256:ext',
          configImage: isolation.ALLOWLISTED_IMAGE,
          instanceId: null,
          managed: null,
          targetId: ISOLATED,
        };
      }
      return {
        ok: false,
        running: false,
        state: 'unavailable',
        reason: 'image_unavailable:test',
      };
    },
  };
}

async function withApi(t, run) {
  const identityState = {
    instanceId: FIX.instanceId,
    containerId: FIX.containerId,
    imageId: FIX.imageId,
    configImage: FIX.configImage,
    managed: isolation.MANAGED_LABEL_VALUE,
  };
  const eve = await startFakeEve(identityState);
  process.env.EVE_ISOLATED_API_URL = eve.baseUrl;
  process.env.EVE_API_URL = eve.baseUrl;

  delete require.cache[require.resolve('./db')];
  delete require.cache[require.resolve('../index.js')];
  delete require.cache[require.resolve('./policy')];
  delete require.cache[require.resolve('./events')];
  delete require.cache[require.resolve('./namedQueries')];
  delete require.cache[require.resolve('./isolation')];
  delete require.cache[require.resolve('./readiness')];

  const api = require('../index.js');
  await api.migrate();
  await api.pool
    .query(
      `
    TRUNCATE TABLE isolated_desktop_managed, approvals, task_events, task_controls,
      messages, tasks, assets, conversations
    RESTART IDENTITY CASCADE
  `,
    )
    .catch(async () => {
      // Fresh DB: migrate already applied schema
    });
  const conv = await api.defaultConversation();

  const brokerState = { mode: 'ok' };
  const broker = fakeBroker(brokerState, identityState);
  api.setIsolationBrokerForTests(broker);

  const server = await new Promise((resolve) => {
    const s = api.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  const ctx = {
    origin,
    convId: conv.id,
    broker,
    brokerState,
    identityState,
    eve,
    secret: api.INTERNAL_SECRET,
    pool: api.pool,
    api,
    async seedManaged(overrides = {}) {
      const row = {
        targetId: ISOLATED,
        instanceId: identityState.instanceId,
        containerId: identityState.containerId,
        imageId: identityState.imageId,
        configImage: identityState.configImage,
        approvalId: 'appr_seed',
        taskId: 'task_seed',
        ...overrides,
      };
      await api.upsertManagedIsolatedDesktop(row);
      return row;
    },
    async postMessage(text, targetId) {
      const res = await fetch(`${origin}/api/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, targetId }),
      });
      const body = await res.json();
      return { status: res.status, body };
    },
    async approve(ticketId, decidedBy = 'test-user') {
      const res = await fetch(`${origin}/api/approvals/${ticketId}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decidedBy }),
      });
      return { status: res.status, body: await res.json() };
    },
    async policyCheck(taskId, action, params) {
      const res = await fetch(`${origin}/internal/policy/check`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hamster-internal-secret': api.INTERNAL_SECRET,
        },
        body: JSON.stringify({ taskId, action, params }),
      });
      return { status: res.status, body: await res.json() };
    },
    async countCreateTickets(taskId) {
      const { rows } = await api.pool.query(
        `SELECT id, status, action FROM approvals WHERE task_id = $1 AND action = $2`,
        [taskId, isolation.CREATE_ISOLATED_DESKTOP_ACTION],
      );
      return rows;
    },
    async getManaged() {
      return api.getManagedIsolatedDesktop(ISOLATED);
    },
  };

  try {
    await run(ctx);
  } finally {
    await new Promise((r) => server.close(r));
    eve.server.close();
  }
}

test('HTTP: managed healthy reuse → 0 create tickets, 0 broker.start', async (t) => {
  await withApi(t, async (ctx) => {
    ctx.brokerState.mode = 'ok';
    ctx.eve.server.__healthMode = 'ok';
    await ctx.seedManaged();
    const beforeStarts = ctx.broker.startCalls();
    const { status, body } = await ctx.postMessage('start task: reuse managed desktop', ISOLATED);
    assert.equal(status, 201);
    const taskId = body.task?.taskId || body.task?.id;
    assert.ok(taskId);
    const tickets = await ctx.countCreateTickets(taskId);
    assert.equal(tickets.length, 0, 'managed reuse must not mint create_isolated_desktop');
    assert.equal(ctx.broker.startCalls(), beforeStarts, 'reuse must not docker start');
    const detail = await fetch(`${ctx.origin}/api/tasks/${taskId}`).then((r) => r.json());
    assert.equal(detail.status, 'running');
  });
});

test('HTTP: external same-name 2xx without managed provenance → mint ticket', async (t) => {
  await withApi(t, async (ctx) => {
    ctx.brokerState.mode = 'external_same_name';
    ctx.eve.server.__healthMode = 'unbound';
    // No seedManaged — arbitrary runtime must not be adopted.
    const { body } = await ctx.postMessage('start task: external same name', ISOLATED);
    const taskId = body.task?.taskId || body.task?.id;
    const tickets = await ctx.countCreateTickets(taskId);
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0].status, 'pending');
    assert.equal(ctx.broker.startCalls(), 0);
    assert.equal(await ctx.getManaged(), null);
  });
});

test('HTTP: not_started still requires create/start approval; no silent start', async (t) => {
  await withApi(t, async (ctx) => {
    ctx.brokerState.mode = 'not_started';
    ctx.eve.server.__healthMode = 'ok';
    const beforeStarts = ctx.broker.startCalls();
    const { status, body } = await ctx.postMessage('start task: needs ticket', ISOLATED);
    assert.equal(status, 201);
    const taskId = body.task?.taskId || body.task?.id;
    const tickets = await ctx.countCreateTickets(taskId);
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0].status, 'pending');
    assert.equal(ctx.broker.startCalls(), beforeStarts);
  });
});

test('HTTP negative: wrong image on probe → mint ticket (fail closed)', async (t) => {
  await withApi(t, async (ctx) => {
    await ctx.seedManaged();
    ctx.brokerState.mode = 'wrong_image';
    ctx.eve.server.__healthMode = 'ok';
    const { body } = await ctx.postMessage('start task: wrong image', ISOLATED);
    const taskId = body.task?.taskId || body.task?.id;
    const tickets = await ctx.countCreateTickets(taskId);
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0].status, 'pending');
  });
});

test('HTTP negative: spoofed health instanceId → mint ticket', async (t) => {
  await withApi(t, async (ctx) => {
    await ctx.seedManaged();
    ctx.brokerState.mode = 'ok';
    ctx.eve.server.__healthMode = 'spoof';
    const { body } = await ctx.postMessage('start task: spoofed health', ISOLATED);
    const taskId = body.task?.taskId || body.task?.id;
    const tickets = await ctx.countCreateTickets(taskId);
    assert.equal(tickets.length, 1);
  });
});

test('HTTP negative: identity swap at session boundary → mint ticket', async (t) => {
  await withApi(t, async (ctx) => {
    await ctx.seedManaged();
    // First status ok for verify; flip to swap before recheck by wrapping status.
    let n = 0;
    const inner = ctx.broker.status;
    ctx.broker.status = async () => {
      n += 1;
      if (n === 1) return inner();
      ctx.brokerState.mode = 'swap';
      return inner();
    };
    ctx.eve.server.__healthMode = 'ok';
    const { body } = await ctx.postMessage('start task: toctou swap', ISOLATED);
    const taskId = body.task?.taskId || body.task?.id;
    const tickets = await ctx.countCreateTickets(taskId);
    assert.equal(tickets.length, 1, 'TOCTOU swap must fail closed and mint ticket');
    const detail = await fetch(`${ctx.origin}/api/tasks/${taskId}`).then((r) => r.json());
    assert.equal(detail.status, 'queued');
  });
});

test('HTTP authorize chain: approve create/start → managed provenance → reuse', async (t) => {
  await withApi(t, async (ctx) => {
    ctx.brokerState.mode = 'not_started';
    ctx.eve.server.__healthMode = 'ok';

    const first = await ctx.postMessage('start task: authorize chain', ISOLATED);
    assert.equal(first.status, 201);
    const taskId = first.body.task?.taskId || first.body.task?.id;
    const tickets = await ctx.countCreateTickets(taskId);
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0].status, 'pending');

    // Real approve HTTP path — consume ticket, broker.start, record managed, session.
    const approved = await ctx.approve(tickets[0].id);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.status, 'approved');
    assert.ok(approved.body.instanceId);
    assert.ok(approved.body.containerId);
    assert.equal(ctx.broker.startCalls(), 1);

    const managed = await ctx.getManaged();
    assert.ok(managed, 'approve must record managed provenance');
    assert.equal(managed.instanceId, approved.body.instanceId);
    assert.equal(managed.containerId, approved.body.containerId);
    assert.equal(managed.approvalId, tickets[0].id);
    assert.equal(managed.configImage, isolation.ALLOWLISTED_IMAGE);

    const detail = await fetch(`${ctx.origin}/api/tasks/${taskId}`).then((r) => r.json());
    assert.equal(detail.status, 'running');

    // Second task: reuse managed SAME instance — no new create ticket / no start.
    const before = ctx.broker.startCalls();
    const second = await ctx.postMessage('start task: reuse after authorize', ISOLATED);
    assert.equal(second.status, 201);
    const task2 = second.body.task?.taskId || second.body.task?.id;
    const tickets2 = await ctx.countCreateTickets(task2);
    assert.equal(tickets2.length, 0);
    assert.equal(ctx.broker.startCalls(), before);
    const detail2 = await fetch(`${ctx.origin}/api/tasks/${task2}`).then((r) => r.json());
    assert.equal(detail2.status, 'running');
  });
});

test('HTTP: create/start ticket cannot authorize publish_dashboard; cross-target denied', async (t) => {
  await withApi(t, async (ctx) => {
    ctx.brokerState.mode = 'not_started';
    const { body } = await ctx.postMessage('start task: ticket bind', ISOLATED);
    const taskId = body.task?.taskId || body.task?.id;
    const tickets = await ctx.countCreateTickets(taskId);
    assert.equal(tickets.length, 1);

    await ctx.pool.query(
      `UPDATE approvals SET status = 'approved', decided_at = now(), decided_by = 'test'
       WHERE id = $1`,
      [tickets[0].id],
    );

    const createParams = isolation.createIsolatedDesktopParams(taskId, ISOLATED);
    const pub = await ctx.policyCheck(taskId, 'publish_dashboard', {
      taskId,
      title: 'Dash',
      targetId: ISOLATED,
    });
    assert.equal(pub.body.allow, false);
    assert.equal(pub.body.reason, 'no_valid_ticket');

    const cross = await ctx.policyCheck(taskId, 'publish_dashboard', {
      taskId,
      title: 'Dash',
      targetId: CONTROL,
    });
    assert.equal(cross.body.allow, false);
    assert.match(String(cross.body.reason), /target_mismatch/);

    const okCreate = await ctx.policyCheck(
      taskId,
      isolation.CREATE_ISOLATED_DESKTOP_ACTION,
      createParams,
    );
    assert.equal(okCreate.body.allow, true);

    const again = await ctx.policyCheck(
      taskId,
      isolation.CREATE_ISOLATED_DESKTOP_ACTION,
      createParams,
    );
    assert.equal(again.body.allow, false);
    assert.equal(again.body.reason, 'no_valid_ticket');
  });
});

test('unit guard: highRiskTargetAllows still fail-closed for missing targetId', () => {
  const task = { id: 't', target_id: ISOLATED, status: 'running' };
  assert.equal(
    policy.highRiskTargetAllows(task, { taskId: 't', action: 'publish_dashboard' }).reason,
    'target_id_missing',
  );
});
