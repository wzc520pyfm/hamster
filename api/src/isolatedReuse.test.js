'use strict';

/**
 * P2 — healthy already-running isolated desktop reuse (createTask).
 * Fail closed: never trust client "running"; not_started/unavailable/unhealthy
 * still require create/start ticket; create tickets never authorize tools.
 *
 * Run: cd api && node --test src/isolatedReuse.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const isolation = require('./isolation');
const policy = require('./policy');
const readiness = require('./readiness');

const ISOLATED = isolation.ISOLATED_DESKTOP_TARGET_ID;
const CONTROL = isolation.CONTROL_PLANE_TARGET_ID;

test('shouldSkipCreateIsolatedDesktopApproval: healthy probe+health => skip ticket', () => {
  const d = isolation.shouldSkipCreateIsolatedDesktopApproval({
    probe: { state: 'ok', ok: true },
    health: { ok: true },
    clientClaim: { running: true }, // ignored
  });
  assert.equal(d.skip, true);
  assert.equal(d.reason, null);
});

test('shouldSkipCreateIsolatedDesktopApproval: client running claim alone never skips', () => {
  const d = isolation.shouldSkipCreateIsolatedDesktopApproval({
    probe: { state: 'not_started' },
    health: { ok: false },
    clientClaim: { running: true, state: 'ok' },
  });
  assert.equal(d.skip, false);
  assert.equal(d.reason, 'not_started');
});

test('shouldSkipCreateIsolatedDesktopApproval: not_started requires create/start ticket', () => {
  const d = isolation.shouldSkipCreateIsolatedDesktopApproval({
    probe: { state: 'not_started', ok: true },
    health: { ok: true }, // health alone is insufficient without probe ok
  });
  assert.equal(d.skip, false);
  assert.equal(d.reason, 'not_started');
});

test('shouldSkipCreateIsolatedDesktopApproval: unavailable / unknown fail closed', () => {
  assert.equal(
    isolation.shouldSkipCreateIsolatedDesktopApproval({
      probe: { state: 'unavailable' },
      health: { ok: true },
    }).skip,
    false,
  );
  assert.equal(
    isolation.shouldSkipCreateIsolatedDesktopApproval({
      probe: null,
      health: { ok: true },
    }).skip,
    false,
  );
  assert.equal(
    isolation.shouldSkipCreateIsolatedDesktopApproval({
      probe: { state: 'ok' },
      health: { ok: false, reason: 'readiness_timeout' },
    }).reason,
    'health_not_ready',
  );
  assert.equal(
    isolation.shouldSkipCreateIsolatedDesktopApproval({
      probe: { state: 'ok' },
      health: null,
    }).skip,
    false,
  );
});

test('verifyHealthyIsolatedDesktopForReuse: probe ok + health ok => reuse', async () => {
  const broker = {
    status: async () => ({ ok: true, running: true, state: 'ok' }),
    start: async () => {
      throw new Error('start must not be called on reuse path');
    },
  };
  const out = await isolation.verifyHealthyIsolatedDesktopForReuse({
    broker,
    waitReady: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(out.reuse, true);
  assert.equal(out.probe.state, 'ok');
  assert.equal(out.health.ok, true);
});

test('verifyHealthyIsolatedDesktopForReuse: not_started => no reuse, no docker start', async () => {
  let started = false;
  const broker = {
    status: async () => ({ ok: false, running: false, state: 'not_started' }),
    start: async () => {
      started = true;
      return { ok: true };
    },
  };
  const out = await isolation.verifyHealthyIsolatedDesktopForReuse({
    broker,
    waitReady: async () => {
      throw new Error('health must not be polled when probe is not ok');
    },
  });
  assert.equal(out.reuse, false);
  assert.equal(out.reason, 'not_started');
  assert.equal(started, false);
});

test('verifyHealthyIsolatedDesktopForReuse: probe ok but health fail => no reuse (ticket still required)', async () => {
  const broker = {
    status: async () => ({ ok: true, running: true, state: 'ok' }),
    start: async () => {
      throw new Error('must not start');
    },
  };
  const out = await isolation.verifyHealthyIsolatedDesktopForReuse({
    broker,
    waitReady: async () => ({ ok: false, reason: 'readiness_timeout:x' }),
  });
  assert.equal(out.reuse, false);
  assert.equal(out.reason, 'health_not_ready');
});

test('verifyHealthyIsolatedDesktopForReuse: unavailable broker fail closed', async () => {
  const out = await isolation.verifyHealthyIsolatedDesktopForReuse({
    broker: null,
    waitReady: async () => ({ ok: true }),
  });
  assert.equal(out.reuse, false);
  assert.match(String(out.reason), /unavailable|broker/i);
});

test('createTaskDecision: healthy reuse => no create ticket; spawn session', () => {
  const plan = isolation.planIsolatedCreateTask({
    reuse: { reuse: true, reason: null },
  });
  assert.equal(plan.mintCreateTicket, false);
  assert.equal(plan.spawnSession, true);
  assert.equal(plan.startDesktop, false);
});

test('createTaskDecision: not_started => mint create ticket; no spawn; no start', () => {
  const plan = isolation.planIsolatedCreateTask({
    reuse: { reuse: false, reason: 'not_started' },
  });
  assert.equal(plan.mintCreateTicket, true);
  assert.equal(plan.spawnSession, false);
  assert.equal(plan.startDesktop, false);
});

test('createTaskDecision: unhealthy/unavailable => mint ticket (fail closed for reuse)', () => {
  for (const reason of ['health_not_ready', 'unavailable', 'unavailable_or_unknown']) {
    const plan = isolation.planIsolatedCreateTask({
      reuse: { reuse: false, reason },
    });
    assert.equal(plan.mintCreateTicket, true, reason);
    assert.equal(plan.spawnSession, false, reason);
    assert.equal(plan.startDesktop, false, reason);
  }
});

test('security: create_isolated_desktop ticket cannot authorize publish_dashboard (params/action)', () => {
  // Different action + hash ⇒ authorize path would require its own approved ticket.
  assert.equal(policy.isHighRiskAction('publish_dashboard'), true);
  assert.equal(policy.isHighRiskAction('create_isolated_desktop'), true);
  const createParams = isolation.createIsolatedDesktopParams('task_a', ISOLATED);
  const toolParams = { taskId: 'task_a', title: 'Dash', targetId: ISOLATED };
  assert.notEqual(policy.paramsHash(createParams), policy.paramsHash(toolParams));
  assert.notEqual(isolation.CREATE_ISOLATED_DESKTOP_ACTION, 'publish_dashboard');
});

test('security: cross-target high-risk binding rejected; missing targetId fail closed', () => {
  const task = { id: 'task_x', target_id: ISOLATED, status: 'running' };
  assert.equal(
    policy.highRiskTargetAllows(task, {
      taskId: 'task_x',
      action: 'publish_dashboard',
      targetId: CONTROL,
    }).allowed,
    false,
  );
  assert.equal(
    policy.highRiskTargetAllows(task, { taskId: 'task_x', action: 'publish_dashboard' }).reason,
    'target_id_missing',
  );
});

test('security: stale/startup create params must not match tool authorize hash', () => {
  const startParams = isolation.createIsolatedDesktopParams('task_old', ISOLATED);
  const toolParams = {
    taskId: 'task_old',
    title: 'Secret dash',
    channel: 'local',
    targetId: ISOLATED,
  };
  assert.notEqual(policy.paramsHash(startParams), policy.paramsHash(toolParams));
});

test('security regression: electron main keeps sandbox/contextIsolation/nodeIntegration guards', () => {
  const mainPath = path.join(__dirname, '../../electron/main.js');
  const src = fs.readFileSync(mainPath, 'utf8');
  assert.match(src, /contextIsolation:\s*true/);
  assert.match(src, /nodeIntegration:\s*false/);
  assert.match(src, /sandbox:\s*true/);
  assert.match(src, /setWindowOpenHandler/);
});

test('readiness one-shot health check fail closed when fetch fails', async () => {
  const result = await readiness.checkIsolatedDesktopHealthOnce({
    baseUrl: 'http://desktop.test:8081',
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /unreachable|ECONNREFUSED/i);
});

test('readiness one-shot health check ok on 200', async () => {
  const result = await readiness.checkIsolatedDesktopHealthOnce({
    baseUrl: 'http://desktop.test:8081',
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(result.ok, true);
});
