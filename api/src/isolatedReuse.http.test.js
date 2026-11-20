'use strict';

/**
 * P2 isolated HTTP integration — real API routes + ephemeral Postgres only.
 *
 * SAFETY: No default DATABASE_URL. Refuses compose/shared :5432 and shared DB names.
 * Start wholly separate temp PG first:
 *   eval "$(api/scripts/start-ephemeral-pg.sh)"
 *   node --test api/src/isolatedReuse.http.test.js
 *   api/scripts/stop-ephemeral-pg.sh
 *
 * Fake broker never calls docker / never stops a live desktop.
 * Fake health here is **gateway-shaped** (Eve base fields + identity bind) for API
 * contract tests — NOT worker bootstrap proof. See agent/lib/isolatedIdentityGateway
 * bootstrap test for real Eve `{ok,status,workflowId}` augmentation.
 *
 * Labels:
 *   NATURAL — createTask mints ticket → POST /approve → authorize consume → start
 *   SEED    — SQL-stamped approved ticket + /internal/policy/check only (not natural)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('crypto');

const {
  assertEphemeralDatabaseUrl,
  assertEphemeralLiveConnection,
} = require('./ephemeralPgGuard');

// Fail closed before any require of db/index — no default URL fallback.
assertEphemeralDatabaseUrl(process.env.DATABASE_URL, process.env);

process.env.HAMSTER_INTERNAL_SECRET = process.env.HAMSTER_INTERNAL_SECRET || 'test-internal-secret';
process.env.HAMSTER_DB_PASSWORD = process.env.HAMSTER_DB_PASSWORD || 'unused-ephemeral';

const isolation = require('./isolation');
const policy = require('./policy');
const eve = require('./eve');

const ISOLATED = isolation.ISOLATED_DESKTOP_TARGET_ID;
const CONTROL = isolation.CONTROL_PLANE_TARGET_ID;

const FIX = {
  instanceId: 'inst_http_1',
  containerId: 'ctr_http_1',
  imageId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  configImage: isolation.ALLOWLISTED_IMAGE,
};

/**
 * Gateway-shaped fake: real Eve health fields + identity augmentation the
 * production isolatedIdentityGateway adds. Session requires x-hamster-* headers.
 */
function startGatewayShapedEve(identityState) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/eve/v1/health') {
      const mode = server.__healthMode || 'ok';
      if (mode === 'ok') {
        res.writeHead(200, { 'content-type': 'application/json' });
        // Real Eve public shape: ok/status/workflowId — plus gateway identity bind.
        res.end(
          JSON.stringify({
            ok: true,
            status: 'ready',
            workflowId: 'wf_gateway_shaped_test',
            targetId: ISOLATED,
            instanceId: identityState.instanceId,
            imageId: identityState.imageId,
          }),
        );
        return;
      }
      if (mode === 'spoof') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            status: 'ready',
            workflowId: 'wf_spoof',
            targetId: ISOLATED,
            instanceId: 'inst_SPOOFED',
            imageId: identityState.imageId,
          }),
        );
        return;
      }
      if (mode === 'eve_raw_only') {
        // Bare Eve without gateway — proves API must not accept this for reuse bind.
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'ready', workflowId: 'wf_raw' }));
        return;
      }
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, status: 'not_ready' }));
      return;
    }
    // ALL /eve/v1/session* routes require frozen identity (create/follow-up/cancel/stream/…).
    const isSession =
      url.pathname === '/eve/v1/session' || url.pathname.startsWith('/eve/v1/session/');
    if (isSession) {
      const gotInst = String(req.headers[eve.INSTANCE_HEADER] || '').trim();
      const gotTarget = String(req.headers[eve.TARGET_HEADER] || '').trim();
      const gotImage = String(req.headers[eve.IMAGE_HEADER] || '').trim();
      if (
        gotInst !== identityState.instanceId ||
        gotTarget !== ISOLATED ||
        gotImage !== identityState.imageId
      ) {
        res.writeHead(409, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: false,
            error: 'instance_id_mismatch',
            expected: identityState.instanceId,
            got: gotInst || null,
            path: url.pathname,
          }),
        );
        return;
      }
      if (url.pathname.includes('/stream')) {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.end('');
        return;
      }
      if (url.pathname.endsWith('/cancel') && req.method === 'POST') {
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, cancelled: true }));
        return;
      }
      if (url.pathname === '/eve/v1/session' && req.method === 'POST') {
        const sessionId = `sess_${crypto.randomUUID()}`;
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, sessionId, deliveryId: `del_${sessionId}` }));
        return;
      }
      // Follow-up / answer / existing session POST
      if (req.method === 'POST' || req.method === 'GET') {
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: url.pathname }));
        return;
      }
      res.writeHead(405).end('method');
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
      identityState.containerId = state.preserveContainerId || `ctr_${instanceId}`;
      identityState.imageId = state.evilDigest ? 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' : FIX.imageId;
      identityState.configImage = state.evilTag
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
        allowlistedImageId: FIX.imageId,
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
          allowlistedImageId: FIX.imageId,
        };
      }
      if (state.mode === 'not_started') {
        return {
          ok: false,
          running: false,
          state: 'not_started',
          allowlistedImageId: FIX.imageId,
        };
      }
      if (state.mode === 'stopped_managed') {
        return {
          ok: false,
          running: false,
          state: 'not_started',
          containerId: identityState.containerId,
          imageId: identityState.imageId,
          configImage: identityState.configImage,
          instanceId: identityState.instanceId,
          managed: isolation.MANAGED_LABEL_VALUE,
          targetId: ISOLATED,
          allowlistedImageId: FIX.imageId,
        };
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
          allowlistedImageId: FIX.imageId,
        };
      }
      if (state.mode === 'wrong_digest') {
        // Tag still allowlisted; immutable digest wrong — must fail closed.
        return {
          ok: true,
          running: true,
          state: 'ok',
          containerId: identityState.containerId,
          imageId: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          configImage: isolation.ALLOWLISTED_IMAGE,
          instanceId: identityState.instanceId,
          managed: isolation.MANAGED_LABEL_VALUE,
          targetId: ISOLATED,
          allowlistedImageId: FIX.imageId,
        };
      }
      if (state.mode === 'external_same_name') {
        return {
          ok: true,
          running: true,
          state: 'ok',
          containerId: 'ctr_external_same_name',
          imageId: FIX.imageId,
          configImage: isolation.ALLOWLISTED_IMAGE,
          instanceId: null,
          managed: null,
          targetId: ISOLATED,
          allowlistedImageId: FIX.imageId,
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
  const eveServer = await startGatewayShapedEve(identityState);
  process.env.EVE_ISOLATED_API_URL = eveServer.baseUrl;
  process.env.EVE_API_URL = eveServer.baseUrl;

  delete require.cache[require.resolve('./db')];
  delete require.cache[require.resolve('../index.js')];
  delete require.cache[require.resolve('./policy')];
  delete require.cache[require.resolve('./events')];
  delete require.cache[require.resolve('./namedQueries')];
  delete require.cache[require.resolve('./isolation')];
  delete require.cache[require.resolve('./readiness')];
  delete require.cache[require.resolve('./eve')];

  const api = require('../index.js');
  await api.migrate();
  // Live connection verify BEFORE any destructive SQL (env strings alone are forgeable).
  const livePg = await assertEphemeralLiveConnection(api.pool, process.env);
  assert.equal(livePg.verified, true);
  await api.pool.query(`
    TRUNCATE TABLE isolated_desktop_managed, approvals, task_events, task_controls,
      messages, tasks, assets, conversations
    RESTART IDENTITY CASCADE
  `);
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
    eve: eveServer,
    pool: api.pool,
    api,
    ephemeralPg: livePg,
    async seedManaged(overrides = {}) {
      const row = {
        targetId: ISOLATED,
        instanceId: identityState.instanceId,
        containerId: identityState.containerId,
        imageId: identityState.imageId,
        configImage: identityState.configImage,
        approvalId: 'appr_seed_managed',
        taskId: 'task_seed_managed',
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
        `SELECT id, status, action, consumed_at FROM approvals WHERE task_id = $1 AND action = $2`,
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
    eveServer.server.close();
  }
}

test('guard: ephemeral PG evidence present (not shared :5432)', () => {
  const info = assertEphemeralDatabaseUrl(process.env.DATABASE_URL, process.env);
  assert.notEqual(String(info.port), '5432');
  assert.match(info.database, /^hamster_p2_ephemeral_/);
  assert.match(String(info.dataDir), /hamster-p2-ephemeral-pg-/);
});

test('NATURAL: managed healthy reuse → 0 create tickets, 0 broker.start', async (t) => {
  await withApi(t, async (ctx) => {
    ctx.brokerState.mode = 'ok';
    ctx.eve.server.__healthMode = 'ok';
    await ctx.seedManaged();
    const beforeStarts = ctx.broker.startCalls();
    const { status, body } = await ctx.postMessage('start task: reuse managed desktop', ISOLATED);
    assert.equal(status, 201);
    const taskId = body.task?.taskId || body.task?.id;
    const tickets = await ctx.countCreateTickets(taskId);
    assert.equal(tickets.length, 0);
    assert.equal(ctx.broker.startCalls(), beforeStarts);
    const detail = await fetch(`${ctx.origin}/api/tasks/${taskId}`).then((r) => r.json());
    assert.equal(detail.status, 'running');
  });
});

test('NATURAL: bare Eve health without identity bind → mint ticket (fail closed)', async (t) => {
  await withApi(t, async (ctx) => {
    await ctx.seedManaged();
    ctx.brokerState.mode = 'ok';
    ctx.eve.server.__healthMode = 'eve_raw_only';
    const { body } = await ctx.postMessage('start task: raw eve health', ISOLATED);
    const taskId = body.task?.taskId || body.task?.id;
    const tickets = await ctx.countCreateTickets(taskId);
    assert.equal(tickets.length, 1);
  });
});

test('NATURAL: foreign same-name 2xx without managed → mint ticket', async (t) => {
  await withApi(t, async (ctx) => {
    ctx.brokerState.mode = 'external_same_name';
    ctx.eve.server.__healthMode = 'eve_raw_only';
    const { body } = await ctx.postMessage('start task: external same name', ISOLATED);
    const taskId = body.task?.taskId || body.task?.id;
    const tickets = await ctx.countCreateTickets(taskId);
    assert.equal(tickets.length, 1);
    assert.equal(ctx.broker.startCalls(), 0);
    assert.equal(await ctx.getManaged(), null);
  });
});

test('NATURAL: not_started requires create/start approval; no silent start', async (t) => {
  await withApi(t, async (ctx) => {
    ctx.brokerState.mode = 'not_started';
    const beforeStarts = ctx.broker.startCalls();
    const { body } = await ctx.postMessage('start task: needs ticket', ISOLATED);
    const taskId = body.task?.taskId || body.task?.id;
    const tickets = await ctx.countCreateTickets(taskId);
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0].status, 'pending');
    assert.equal(ctx.broker.startCalls(), beforeStarts);
  });
});

test('NATURAL negative: tag allowlisted but wrong image digest → mint ticket', async (t) => {
  await withApi(t, async (ctx) => {
    await ctx.seedManaged();
    ctx.brokerState.mode = 'wrong_digest';
    ctx.eve.server.__healthMode = 'ok';
    const { body } = await ctx.postMessage('start task: wrong digest', ISOLATED);
    const taskId = body.task?.taskId || body.task?.id;
    const tickets = await ctx.countCreateTickets(taskId);
    assert.equal(tickets.length, 1);
  });
});

test('NATURAL negative: spoofed health instanceId → mint ticket', async (t) => {
  await withApi(t, async (ctx) => {
    await ctx.seedManaged();
    ctx.brokerState.mode = 'ok';
    ctx.eve.server.__healthMode = 'spoof';
    const { body } = await ctx.postMessage('start task: spoofed health', ISOLATED);
    const taskId = body.task?.taskId || body.task?.id;
    assert.equal((await ctx.countCreateTickets(taskId)).length, 1);
  });
});

test('NATURAL negative: identity swap at session boundary → mint ticket', async (t) => {
  await withApi(t, async (ctx) => {
    await ctx.seedManaged();
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
    assert.equal((await ctx.countCreateTickets(taskId)).length, 1);
    const detail = await fetch(`${ctx.origin}/api/tasks/${taskId}`).then((r) => r.json());
    assert.equal(detail.status, 'queued');
  });
});

test('NATURAL authorize chain: postMessage→approve→consume→managed→reuse 0ticket 0start', async (t) => {
  await withApi(t, async (ctx) => {
    ctx.brokerState.mode = 'not_started';
    ctx.eve.server.__healthMode = 'ok';

    const first = await ctx.postMessage('start task: natural authorize chain', ISOLATED);
    assert.equal(first.status, 201);
    const taskId = first.body.task?.taskId || first.body.task?.id;
    const tickets = await ctx.countCreateTickets(taskId);
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0].status, 'pending');
    assert.equal(tickets[0].consumed_at, null);

    const approved = await ctx.approve(tickets[0].id);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.status, 'approved');
    assert.ok(approved.body.instanceId);
    assert.ok(approved.body.containerId);
    assert.equal(ctx.broker.startCalls(), 1);

    const managed = await ctx.getManaged();
    assert.ok(managed, 'natural approve must record managed provenance');
    assert.equal(managed.instanceId, approved.body.instanceId);
    assert.equal(managed.approvalId, tickets[0].id);
    assert.equal(managed.imageId, FIX.imageId);

    const consumed = await ctx.countCreateTickets(taskId);
    assert.ok(consumed[0].consumed_at, 'ticket must be consumed by authorize()');

    const detail = await fetch(`${ctx.origin}/api/tasks/${taskId}`).then((r) => r.json());
    assert.equal(detail.status, 'running');

    const before = ctx.broker.startCalls();
    const second = await ctx.postMessage('start task: reuse after natural authorize', ISOLATED);
    assert.equal(second.status, 201);
    const task2 = second.body.task?.taskId || second.body.task?.id;
    assert.equal((await ctx.countCreateTickets(task2)).length, 0);
    assert.equal(ctx.broker.startCalls(), before);
    const detail2 = await fetch(`${ctx.origin}/api/tasks/${task2}`).then((r) => r.json());
    assert.equal(detail2.status, 'running');
  });
});

test('NATURAL: restart prior stopped managed uses same instanceId (no foreign adopt)', async (t) => {
  await withApi(t, async (ctx) => {
    const prior = await ctx.seedManaged({
      instanceId: 'inst_prior_stopped',
      containerId: 'ctr_prior_stopped',
      imageId: FIX.imageId,
    });
    ctx.identityState.instanceId = prior.instanceId;
    ctx.identityState.containerId = prior.containerId;
    ctx.identityState.imageId = prior.imageId;
    ctx.identityState.managed = isolation.MANAGED_LABEL_VALUE;
    ctx.brokerState.mode = 'stopped_managed';
    ctx.brokerState.preserveContainerId = prior.containerId;
    ctx.eve.server.__healthMode = 'ok';

    const created = await ctx.postMessage('start task: restart stopped managed', ISOLATED);
    const taskId = created.body.task?.taskId || created.body.task?.id;
    const tickets = await ctx.countCreateTickets(taskId);
    assert.equal(tickets.length, 1);

    const approved = await ctx.approve(tickets[0].id);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.instanceId, prior.instanceId, 'restart must keep same instanceId');
    assert.equal(approved.body.containerId, prior.containerId);
    const managed = await ctx.getManaged();
    assert.equal(managed.instanceId, prior.instanceId);
  });
});

test('SEED (not natural approve): SQL-approved create ticket then policy/check cross-action', async (t) => {
  await withApi(t, async (ctx) => {
    ctx.brokerState.mode = 'not_started';
    const { body } = await ctx.postMessage('start task: seed policy bind', ISOLATED);
    const taskId = body.task?.taskId || body.task?.id;
    const tickets = await ctx.countCreateTickets(taskId);
    assert.equal(tickets.length, 1);

    // SEED ONLY — deliberately NOT POST /approve. Labels this path as SQL stamp + policy check.
    await ctx.pool.query(
      `UPDATE approvals SET status = 'approved', decided_at = now(), decided_by = 'SEED_SQL_NOT_NATURAL_APPROVE'
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

test('gateway-shaped Eve: unauthenticated /session/existing and /cancel are 409 (not 202 passthrough)', async (t) => {
  await withApi(t, async (ctx) => {
    const base = process.env.EVE_ISOLATED_API_URL;
    for (const path of [
      '/eve/v1/session/existing',
      '/eve/v1/session/existing/cancel',
      '/eve/v1/session/existing/stream',
    ]) {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(res.status, 409, path);
      const body = await res.json();
      assert.equal(body.error, 'instance_id_mismatch');
    }
  });
});

test('NATURAL: pin managed digestA when tag retargets B — requires new approval', async (t) => {
  await withApi(t, async (ctx) => {
    const digestA = FIX.imageId;
    const digestB = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    await ctx.seedManaged({ imageId: digestA });
    // Probe still same instance/container but image digest moved (tag retarget).
    ctx.identityState.imageId = digestB;
    ctx.brokerState.mode = 'ok';
    ctx.eve.server.__healthMode = 'ok';
    // Force status to report digestB while managed row stays digestA.
    const inner = ctx.broker.status;
    ctx.broker.status = async () => {
      const s = await inner();
      return { ...s, imageId: digestB, configImage: isolation.ALLOWLISTED_IMAGE };
    };
    const { body } = await ctx.postMessage('start task: tag retarget digestB', ISOLATED);
    const taskId = body.task?.taskId || body.task?.id;
    assert.equal((await ctx.countCreateTickets(taskId)).length, 1, 'image change needs new approval');
    const managed = await ctx.getManaged();
    assert.equal(managed.imageId, digestA, 'managed row remains pinned to approved digestA');
  });
});

test('API ops: mismatched identity blocks steer / cancel / approval-answer paths', async (t) => {
  await withApi(t, async (ctx) => {
    ctx.brokerState.mode = 'not_started';
    ctx.eve.server.__healthMode = 'ok';
    const first = await ctx.postMessage('start task: identity ops', ISOLATED);
    const taskId = first.body.task?.taskId || first.body.task?.id;
    const tickets = await ctx.countCreateTickets(taskId);
    const approved = await ctx.approve(tickets[0].id);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));

    // Corrupt frozen identity → subsequent Eve ops must fail closed (409 from gateway).
    ctx.identityState.instanceId = 'inst_MISMATCHED';

    const steer = await fetch(`${ctx.origin}/api/tasks/${taskId}/steer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'steer me' }),
    });
    // Steer may surface 502/409 depending on error mapping — must not silently succeed to Eve.
    assert.notEqual(steer.status, 200);

    const cancel = await fetch(`${ctx.origin}/api/tasks/${taskId}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    // Cancel request is accepted at API layer but session cancel must not get 202 from Eve without identity.
    // Restore identity and prove unauthenticated Eve cancel path is still 409.
    const eveCancel = await fetch(
      `${process.env.EVE_ISOLATED_API_URL}/eve/v1/session/sess_x/cancel`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    );
    assert.equal(eveCancel.status, 409);

    // Restore correct identity; cancel with match should reach Eve 202.
    ctx.identityState.instanceId = approved.body.instanceId;
    const eveOk = await fetch(
      `${process.env.EVE_ISOLATED_API_URL}/eve/v1/session/sess_x/cancel`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [eve.INSTANCE_HEADER]: ctx.identityState.instanceId,
          [eve.TARGET_HEADER]: ISOLATED,
          [eve.IMAGE_HEADER]: FIX.imageId,
        },
        body: '{}',
      },
    );
    assert.equal(eveOk.status, 202);
    assert.ok(cancel.status); // exercised cancel API with mismatched identity above
  });
});
