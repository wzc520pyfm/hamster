'use strict';

/**
 * P2 — managed-instance reuse for isolated desktop.
 * Fail closed: provenance + containerId/image + health bind; never trust client
 * "running"; never adopt arbitrary same-name 2xx runtime.
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

const MANAGED = {
  targetId: ISOLATED,
  instanceId: 'inst_abc',
  containerId: 'ctr_abc123',
  imageId: 'sha256:img1',
  configImage: isolation.ALLOWLISTED_IMAGE,
  approvalId: 'appr_prior',
};

function healthyProbe(overrides = {}) {
  return {
    state: 'ok',
    ok: true,
    containerId: MANAGED.containerId,
    imageId: MANAGED.imageId,
    configImage: MANAGED.configImage,
    instanceId: MANAGED.instanceId,
    managed: isolation.MANAGED_LABEL_VALUE,
    targetId: ISOLATED,
    ...overrides,
  };
}

function healthyHealth(overrides = {}) {
  return {
    ok: true,
    status: 200,
    targetId: ISOLATED,
    instanceId: MANAGED.instanceId,
    ...overrides,
  };
}

test('shouldSkip: managed same instance + bound health => skip ticket', () => {
  const d = isolation.shouldSkipCreateIsolatedDesktopApproval({
    probe: healthyProbe(),
    health: healthyHealth(),
    managed: MANAGED,
    clientClaim: { running: true },
  });
  assert.equal(d.skip, true);
  assert.equal(d.reason, null);
});

test('shouldSkip: client running claim alone never skips', () => {
  const d = isolation.shouldSkipCreateIsolatedDesktopApproval({
    probe: { state: 'not_started' },
    health: { ok: false },
    managed: null,
    clientClaim: { running: true, state: 'ok' },
  });
  assert.equal(d.skip, false);
  assert.equal(d.reason, 'not_started');
});

test('shouldSkip: probe ok + health 2xx without managed provenance => fail closed', () => {
  const d = isolation.shouldSkipCreateIsolatedDesktopApproval({
    probe: healthyProbe(),
    health: healthyHealth(),
    managed: null,
  });
  assert.equal(d.skip, false);
  assert.equal(d.reason, 'unmanaged_instance');
});

test('shouldSkip: wrong image / container / health spoof / not_started', () => {
  assert.equal(
    isolation.shouldSkipCreateIsolatedDesktopApproval({
      probe: healthyProbe({ configImage: 'evil/other:latest' }),
      health: healthyHealth(),
      managed: MANAGED,
    }).reason,
    'image_not_allowlisted',
  );
  assert.equal(
    isolation.shouldSkipCreateIsolatedDesktopApproval({
      probe: healthyProbe({ containerId: 'ctr_other' }),
      health: healthyHealth(),
      managed: MANAGED,
    }).reason,
    'container_id_mismatch',
  );
  assert.equal(
    isolation.shouldSkipCreateIsolatedDesktopApproval({
      probe: healthyProbe(),
      health: healthyHealth({ instanceId: 'inst_spoof' }),
      managed: MANAGED,
    }).reason,
    'health_instance_mismatch',
  );
  assert.equal(
    isolation.shouldSkipCreateIsolatedDesktopApproval({
      probe: healthyProbe(),
      health: healthyHealth({ targetId: CONTROL }),
      managed: MANAGED,
    }).reason,
    'health_target_mismatch',
  );
  assert.equal(
    isolation.shouldSkipCreateIsolatedDesktopApproval({
      probe: { state: 'not_started', ok: true },
      health: healthyHealth(),
      managed: MANAGED,
    }).reason,
    'not_started',
  );
  assert.equal(
    isolation.shouldSkipCreateIsolatedDesktopApproval({
      probe: healthyProbe(),
      health: { ok: false },
      managed: MANAGED,
    }).reason,
    'health_not_ready',
  );
});

test('verifyHealthyIsolatedDesktopForReuse: managed + probe + health => reuse + identity', async () => {
  const broker = {
    status: async () => ({
      ok: true,
      running: true,
      state: 'ok',
      containerId: MANAGED.containerId,
      imageId: MANAGED.imageId,
      configImage: MANAGED.configImage,
      instanceId: MANAGED.instanceId,
      managed: isolation.MANAGED_LABEL_VALUE,
      targetId: ISOLATED,
    }),
    start: async () => {
      throw new Error('start must not be called on reuse path');
    },
  };
  const out = await isolation.verifyHealthyIsolatedDesktopForReuse({
    broker,
    getManagedInstance: async () => MANAGED,
    waitReady: async () => healthyHealth(),
  });
  assert.equal(out.reuse, true);
  assert.equal(out.identity.instanceId, MANAGED.instanceId);
  assert.equal(out.identity.containerId, MANAGED.containerId);
});

test('verify: same-name healthy without managed => no reuse', async () => {
  const out = await isolation.verifyHealthyIsolatedDesktopForReuse({
    broker: {
      status: async () => ({
        ok: true,
        running: true,
        state: 'ok',
        containerId: 'ctr_external',
        imageId: 'sha256:x',
        configImage: isolation.ALLOWLISTED_IMAGE,
        instanceId: null,
        managed: null,
      }),
      start: async () => {
        throw new Error('must not start');
      },
    },
    getManagedInstance: async () => null,
    waitReady: async () => ({ ok: true, targetId: ISOLATED, instanceId: 'inst_x' }),
  });
  assert.equal(out.reuse, false);
  assert.equal(out.reason, 'unmanaged_instance');
});

test('verify: not_started => no reuse, no docker start', async () => {
  let started = false;
  const out = await isolation.verifyHealthyIsolatedDesktopForReuse({
    broker: {
      status: async () => ({ ok: false, running: false, state: 'not_started' }),
      start: async () => {
        started = true;
        return { ok: true };
      },
    },
    getManagedInstance: async () => MANAGED,
    waitReady: async () => {
      throw new Error('health must not be polled when probe is not ok');
    },
  });
  assert.equal(out.reuse, false);
  assert.equal(out.reason, 'not_started');
  assert.equal(started, false);
});

test('recheckManagedIsolatedIdentity: identity swap fail closed', async () => {
  let calls = 0;
  const out = await isolation.recheckManagedIsolatedIdentity({
    expected: {
      targetId: ISOLATED,
      instanceId: MANAGED.instanceId,
      containerId: MANAGED.containerId,
      imageId: MANAGED.imageId,
      configImage: MANAGED.configImage,
    },
    getManagedInstance: async () => MANAGED,
    broker: {
      status: async () => {
        calls += 1;
        return {
          ok: true,
          running: true,
          state: 'ok',
          containerId: 'ctr_REPLACED',
          imageId: MANAGED.imageId,
          configImage: MANAGED.configImage,
          instanceId: MANAGED.instanceId,
          managed: isolation.MANAGED_LABEL_VALUE,
          targetId: ISOLATED,
        };
      },
    },
    waitReady: async () => healthyHealth(),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'identity_swapped');
  assert.equal(calls, 1);
});

test('recheckManagedIsolatedIdentity: stable identity holds', async () => {
  const expected = {
    targetId: ISOLATED,
    instanceId: MANAGED.instanceId,
    containerId: MANAGED.containerId,
    imageId: MANAGED.imageId,
    configImage: MANAGED.configImage,
  };
  const out = await isolation.recheckManagedIsolatedIdentity({
    expected,
    getManagedInstance: async () => MANAGED,
    broker: {
      status: async () => ({
        ok: true,
        running: true,
        state: 'ok',
        ...healthyProbe(),
      }),
    },
    waitReady: async () => healthyHealth(),
  });
  assert.equal(out.ok, true);
});

test('planIsolatedCreateTask: healthy reuse => no create ticket; spawn session', () => {
  const plan = isolation.planIsolatedCreateTask({
    reuse: { reuse: true, reason: null },
  });
  assert.equal(plan.mintCreateTicket, false);
  assert.equal(plan.spawnSession, true);
  assert.equal(plan.startDesktop, false);
});

test('planIsolatedCreateTask: not_started / unmanaged => mint ticket', () => {
  for (const reason of [
    'not_started',
    'unmanaged_instance',
    'health_instance_mismatch',
    'identity_swapped',
    'image_not_allowlisted',
  ]) {
    const plan = isolation.planIsolatedCreateTask({
      reuse: { reuse: false, reason },
    });
    assert.equal(plan.mintCreateTicket, true, reason);
    assert.equal(plan.spawnSession, false, reason);
    assert.equal(plan.startDesktop, false, reason);
  }
});

test('security: create_isolated_desktop ticket cannot authorize publish_dashboard', () => {
  assert.equal(policy.isHighRiskAction('publish_dashboard'), true);
  assert.equal(policy.isHighRiskAction('create_isolated_desktop'), true);
  const createParams = isolation.createIsolatedDesktopParams('task_a', ISOLATED);
  const toolParams = { taskId: 'task_a', title: 'Dash', targetId: ISOLATED };
  assert.notEqual(policy.paramsHash(createParams), policy.paramsHash(toolParams));
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

test('security regression: electron main keeps sandbox/contextIsolation/nodeIntegration guards', () => {
  const mainPath = path.join(__dirname, '../../electron/main.js');
  const src = fs.readFileSync(mainPath, 'utf8');
  assert.match(src, /contextIsolation:\s*true/);
  assert.match(src, /nodeIntegration:\s*false/);
  assert.match(src, /sandbox:\s*true/);
  assert.match(src, /setWindowOpenHandler/);
});

test('readiness: one-shot requires identity bind when expectedIdentity set', async () => {
  const unbound = await readiness.checkIsolatedDesktopHealthOnce({
    baseUrl: 'http://desktop.test:8081',
    expectedIdentity: { targetId: ISOLATED, instanceId: 'inst_abc' },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }),
  });
  assert.equal(unbound.ok, false);
  assert.equal(unbound.reason, 'health_identity_unbound');

  const spoof = await readiness.checkIsolatedDesktopHealthOnce({
    baseUrl: 'http://desktop.test:8081',
    expectedIdentity: { targetId: ISOLATED, instanceId: 'inst_abc' },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, targetId: ISOLATED, instanceId: 'inst_other' }),
    }),
  });
  assert.equal(spoof.ok, false);
  assert.equal(spoof.reason, 'health_instance_mismatch');

  const ok = await readiness.checkIsolatedDesktopHealthOnce({
    baseUrl: 'http://desktop.test:8081',
    expectedIdentity: { targetId: ISOLATED, instanceId: 'inst_abc' },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, targetId: ISOLATED, instanceId: 'inst_abc' }),
    }),
  });
  assert.equal(ok.ok, true);
});

test('readiness one-shot health check fail closed when fetch fails', async () => {
  const result = await readiness.checkIsolatedDesktopHealthOnce({
    baseUrl: 'http://desktop.test:8081',
    requireHealthIdentity: false,
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /unreachable|ECONNREFUSED/i);
});

test('broker start refuses unmanaged same-name container (never rm/stop)', async () => {
  const calls = [];
  const broker = isolation.createDockerIsolationBroker({
    dockerRun: async (args) => {
      calls.push(args);
      if (args[0] === 'image') return 'sha256:allow';
      if (args[0] === 'inspect') {
        return [
          'ctr_foreign',
          'sha256:img',
          isolation.ALLOWLISTED_IMAGE,
          'true',
          '',
          '',
          '',
        ].join('\t');
      }
      throw new Error(`unexpected docker ${args.join(' ')}`);
    },
  });
  const start = await broker.start({
    targetId: ISOLATED,
    instanceId: 'inst_new',
    approvalId: 'appr_1',
  });
  assert.equal(start.ok, false);
  assert.equal(start.reason, 'unmanaged_or_foreign_container_present');
  assert.ok(!calls.some((a) => a[0] === 'rm' || a[0] === 'stop'));
});
