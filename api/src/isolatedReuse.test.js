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
  imageId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
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
    allowlistedImageId: MANAGED.imageId,
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

test('imageIsAllowlisted: tag match + wrong digest fails closed', () => {
  assert.equal(
    isolation.imageIsAllowlisted(
      {
        configImage: isolation.ALLOWLISTED_IMAGE,
        imageId: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      },
      { expectedImageId: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' },
    ),
    false,
  );
  assert.equal(
    isolation.imageIsAllowlisted(
      { configImage: isolation.ALLOWLISTED_IMAGE },
      { expectedImageId: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' },
    ),
    false,
    'missing imageId must fail',
  );
  assert.equal(
    isolation.imageIsAllowlisted(
      { imageId: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', configImage: 'totally/different:tag' },
      { expectedImageId: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' },
    ),
    true,
    'digest match wins; tag alone never required',
  );
});

test('identitiesMatch: missing fields fail closed (fullExpected vs {})', () => {
  const full = {
    targetId: ISOLATED,
    instanceId: 'inst_abc',
    containerId: 'ctr_abc',
    imageId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  };
  assert.equal(isolation.identitiesMatch(full, {}), false);
  assert.equal(isolation.identitiesMatch(full, null), false);
  assert.equal(isolation.identitiesMatch(full, { targetId: ISOLATED }), false);
  assert.equal(
    isolation.identitiesMatch(full, {
      targetId: ISOLATED,
      instanceId: 'inst_abc',
      containerId: 'ctr_abc',
      imageId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }),
    true,
  );
  assert.equal(
    isolation.identitiesMatch(full, {
      ...full,
      imageId: 'sha256:',
    }),
    false,
    'truncated digest must not match',
  );
});

test('shouldSkip: wrong digest / container / health spoof / not_started', () => {
  assert.equal(
    isolation.shouldSkipCreateIsolatedDesktopApproval({
      probe: healthyProbe({
        configImage: isolation.ALLOWLISTED_IMAGE,
        imageId: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      }),
      health: healthyHealth(),
      managed: MANAGED,
    }).reason,
    'image_digest_mismatch',
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

test('resolveIsolatedStartIdentity: restart same managed stopped; foreign rejected', () => {
  const restart = isolation.resolveIsolatedStartIdentity({
    managed: MANAGED,
    probe: {
      containerId: MANAGED.containerId,
      instanceId: MANAGED.instanceId,
      imageId: MANAGED.imageId,
      managed: isolation.MANAGED_LABEL_VALUE,
      targetId: ISOLATED,
      state: 'not_started',
    },
  });
  assert.equal(restart.ok, true);
  assert.equal(restart.mode, 'restart');
  assert.equal(restart.instanceId, MANAGED.instanceId);

  const create = isolation.resolveIsolatedStartIdentity({
    managed: null,
    probe: { state: 'not_started' },
  });
  assert.equal(create.ok, true);
  assert.equal(create.mode, 'create');

  const foreign = isolation.resolveIsolatedStartIdentity({
    managed: MANAGED,
    probe: {
      containerId: 'ctr_foreign',
      instanceId: 'inst_other',
      managed: null,
      targetId: ISOLATED,
    },
  });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.reason, 'unmanaged_or_foreign_container_present');
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
      allowlistedImageId: MANAGED.imageId,
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
        imageId: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
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
    'image_digest_mismatch',
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
      if (args[0] === 'image') return 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      if (args[0] === 'inspect') {
        return [
          'ctr_foreign',
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
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

test('broker create uses complete immutable digest (not mutable tag) + verifies before start', async () => {
  const calls = [];
  let created = false;
  let started = false;
  const digest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const broker = isolation.createDockerIsolationBroker({
    dockerRun: async (args) => {
      calls.push(args);
      if (args[0] === 'image') return digest;
      if (args[0] === 'create') {
        created = true;
        // Image ref must be digest — never ALLOWLISTED_IMAGE tag.
        const imgIdx = args.indexOf(digest);
        assert.ok(imgIdx > 0, 'create must use immutable digest as image');
        assert.equal(args.includes(isolation.ALLOWLISTED_IMAGE), false);
        return 'ctr_new';
      }
      if (args[0] === 'start') {
        assert.equal(created, true, 'must inspect/verify before start');
        started = true;
        return 'ctr_new';
      }
      if (args[0] === 'inspect') {
        if (!created) throw new Error('No such object');
        return [
          'ctr_new',
          digest,
          isolation.ALLOWLISTED_IMAGE,
          'true',
          'inst_gw',
          isolation.MANAGED_LABEL_VALUE,
          ISOLATED,
        ].join('\t');
      }
      return '';
    },
  });
  const start = await broker.start({
    targetId: ISOLATED,
    instanceId: 'inst_gw',
    approvalId: 'appr_gw',
  });
  assert.equal(start.ok, true);
  assert.equal(started, true);
  const create = calls.find((a) => a[0] === 'create');
  assert.ok(create.includes('node'));
  assert.ok(create.some((a) => String(a).includes('isolatedIdentityGateway.mjs')));
  assert.ok(create.includes(digest));
  // inspect happens before start
  const inspectIdx = calls.findIndex((a) => a[0] === 'inspect');
  const startIdx = calls.findIndex((a) => a[0] === 'start');
  assert.ok(inspectIdx >= 0 && startIdx > inspectIdx);
});

test('digestsEqual / isCompleteImageDigest: reject truncated and prefix-only', () => {
  const full = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.equal(isolation.isCompleteImageDigest(full), true);
  assert.equal(isolation.isCompleteImageDigest('sha256:'), false);
  assert.equal(isolation.isCompleteImageDigest('sha256:aaaa'), false);
  assert.equal(isolation.isCompleteImageDigest(full.slice(0, 20)), false);
  assert.equal(isolation.digestsEqual(full, full), true);
  assert.equal(isolation.digestsEqual(full, 'sha256:'), false);
  assert.equal(
    isolation.digestsEqual(full, full.slice(0, full.length - 1)),
    false,
    'truncated must not match via prefix',
  );
  assert.equal(
    isolation.digestsEqual(
      full,
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ),
    false,
  );
});

test('resolveIsolatedStartIdentity: managed digestA pinned; probe digestB requires approval', () => {
  const digestA = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const digestB = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const managed = {
    instanceId: 'inst_a',
    containerId: 'ctr_a',
    imageId: digestA,
  };
  const same = isolation.resolveIsolatedStartIdentity({
    managed,
    probe: {
      containerId: 'ctr_a',
      instanceId: 'inst_a',
      imageId: digestA,
      managed: isolation.MANAGED_LABEL_VALUE,
      targetId: ISOLATED,
    },
  });
  assert.equal(same.ok, true);
  assert.equal(same.mode, 'restart');

  const retarget = isolation.resolveIsolatedStartIdentity({
    managed,
    probe: {
      containerId: 'ctr_a',
      instanceId: 'inst_a',
      imageId: digestB,
      managed: isolation.MANAGED_LABEL_VALUE,
      targetId: ISOLATED,
    },
  });
  assert.equal(retarget.ok, false);
  assert.equal(retarget.reason, 'managed_image_digest_changed_requires_approval');
});

test('broker create refuses incomplete digest from image inspect', async () => {
  const broker = isolation.createDockerIsolationBroker({
    dockerRun: async (args) => {
      if (args[0] === 'image') return 'sha256:'; // truncated — must refuse
      throw new Error(`unexpected ${args.join(' ')}`);
    },
  });
  const start = await broker.start({
    targetId: ISOLATED,
    instanceId: 'inst_bad',
    approvalId: 'appr_bad',
  });
  assert.equal(start.ok, false);
  assert.equal(start.reason, 'image_digest_incomplete');
});
