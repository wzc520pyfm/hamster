'use strict';

// Hamster P2 slice 1 — failing-first tests for execution-target policy + state.
// Run: cd api && node --test src/isolation.test.js src/policy.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const isolation = require('./isolation');
const policy = require('./policy');

const CONTROL = isolation.CONTROL_PLANE_TARGET_ID;
const ISOLATED = isolation.ISOLATED_DESKTOP_TARGET_ID;

function taskFixture(overrides = {}) {
  return {
    id: 'task_test',
    status: 'queued',
    target_id: CONTROL,
    approvals: [],
    ...overrides,
  };
}

test('execution targets: stable ids and known-target resolution', () => {
  assert.equal(isolation.CONTROL_PLANE_TARGET_ID, 'target_control_plane');
  assert.equal(isolation.ISOLATED_DESKTOP_TARGET_ID, 'target_isolated_desktop');
  assert.equal(isolation.isKnownTarget('target_control_plane'), true);
  assert.equal(isolation.isKnownTarget('target_isolated_desktop'), true);
  assert.equal(isolation.isKnownTarget('host_machine'), false);
  assert.equal(isolation.isIsolatedDesktopTarget('target_isolated_desktop'), true);
  assert.equal(isolation.isIsolatedDesktopTarget('target_control_plane'), false);
});

test('execution targets: control-plane task is ok', () => {
  const state = isolation.taskExecutionState(taskFixture({ status: 'running', target_id: CONTROL }));
  assert.equal(state.state, 'ok');
  assert.equal(state.targetId, CONTROL);
});

test('execution targets: missing task on isolated surface is unavailable', () => {
  const state = isolation.taskExecutionState(null);
  assert.equal(state.state, 'unavailable');
});

test('execution targets: queued task assigned to isolated without pending ticket -> start_failed', () => {
  const state = isolation.taskExecutionState(taskFixture({ status: 'queued', target_id: ISOLATED }));
  assert.equal(state.state, 'start_failed');
});

test('execution targets: queued task assigned to isolated with pending create/start ticket -> pending_approval', () => {
  const state = isolation.taskExecutionState(
    taskFixture({
      status: 'queued',
      target_id: ISOLATED,
      approvals: [{ action: 'create_isolated_desktop', status: 'pending' }],
    }),
  );
  assert.equal(state.state, 'pending_approval');
});

test('execution targets: running task on isolated is ok (approved + started)', () => {
  const state = isolation.taskExecutionState(taskFixture({ status: 'running', target_id: ISOLATED }));
  assert.equal(state.state, 'ok');
});

test('execution targets: ordinary isolated failure is failed, not stopped', () => {
  const state = isolation.taskExecutionState(taskFixture({ status: 'failed', target_id: ISOLATED }));
  assert.equal(state.state, 'failed');
});

test('execution targets: mid-run container stop (detected) -> stopped', () => {
  const byFlag = isolation.taskExecutionState(
    taskFixture({ status: 'failed', target_id: ISOLATED, isolatedDesktopStopped: true }),
  );
  assert.equal(byFlag.state, 'stopped');
  const byEvent = isolation.taskExecutionState(
    taskFixture({
      status: 'failed',
      target_id: ISOLATED,
      events: [{ kind: 'isolated_desktop_stopped', message: 'container exited' }],
    }),
  );
  assert.equal(byEvent.state, 'stopped');
});

test('execution targets: task lifecycle stays distinct from container state copy', () => {
  // The container-state sentence must never be a task lifecycle word (Failed / Succeeded).
  const stopped = isolation.taskExecutionState(
    taskFixture({ status: 'failed', target_id: ISOLATED, isolatedDesktopStopped: true }),
  );
  assert.equal(stopped.state, 'stopped');
  assert.notEqual(stopped.state, 'failed');
});

test('createIsolatedDesktopParams includes targetId and exact same-host scope copy', () => {
  const params = isolation.createIsolatedDesktopParams('task_1', ISOLATED);
  assert.equal(params.taskId, 'task_1');
  assert.equal(params.targetId, ISOLATED);
  assert.equal(params.scope, isolation.ISOLATED_DESKTOP_SCOPE);
  assert.match(params.scope, /cannot use the host itself/i);
});

test('execution targets: start is fail-closed without broker and rejects non-isolated targets', async () => {
  const noBroker = await isolation.startIsolatedDesktop({ targetId: ISOLATED });
  assert.equal(noBroker.ok, false);
  assert.ok(noBroker.reason);

  const controlPlane = await isolation.startIsolatedDesktop({
    targetId: isolation.CONTROL_PLANE_TARGET_ID,
    broker: { start: async () => ({ ok: true }) },
  });
  assert.equal(controlPlane.ok, false);

  const isolatedOk = await isolation.startIsolatedDesktop({
    targetId: ISOLATED,
    broker: { start: async () => ({ ok: true, containerId: 'ctr_test' }) },
  });
  assert.equal(isolatedOk.ok, true);
});

test('policy: HIGH_RISK_ACTIONS now covers publish_dashboard and create_isolated_desktop', () => {
  assert.equal(policy.HIGH_RISK_ACTIONS.has('publish_dashboard'), true);
  assert.equal(policy.HIGH_RISK_ACTIONS.has('create_isolated_desktop'), true);
  assert.equal(policy.isHighRiskAction('create_isolated_desktop'), true);
  assert.equal(policy.isHighRiskAction('publish_dashboard'), true);
  assert.equal(policy.isHighRiskAction('acknowledge_control'), false);
  assert.equal(policy.isHighRiskAction('totally_unknown_action'), false);
});

test('policy: LOW_RISK_ACTIONS stays low risk (no high-risk leakage)', () => {
  assert.equal(policy.LOW_RISK_ACTIONS.has('record_task_event'), true);
  assert.equal(policy.LOW_RISK_ACTIONS.has('save_dashboard_page'), true);
  assert.equal(policy.LOW_RISK_ACTIONS.has('acknowledge_control'), true);
  for (const action of policy.LOW_RISK_ACTIONS) {
    assert.equal(policy.isHighRiskAction(action), false);
  }
});

test('policy: ticket is bound to the task execution target (cross-target approval is denied)', () => {
  const taskOnIsolated = { target_id: ISOLATED };
  const taskOnControl = { target_id: CONTROL };

  // Control-plane approval must not authorize an isolated-desktop action.
  const crossToIsolated = policy.highRiskTargetAllows(taskOnControl, {
    taskId: 'task_x',
    action: 'create_isolated_desktop',
    targetId: ISOLATED,
  });
  assert.equal(crossToIsolated.allowed, false);

  // Isolated approval must not authorize a control-plane action.
  const crossToControl = policy.highRiskTargetAllows(taskOnIsolated, {
    taskId: 'task_x',
    action: 'publish_dashboard',
    targetId: CONTROL,
  });
  assert.equal(crossToControl.allowed, false);

  // Same-target binding is required for a usable ticket.
  const sameTarget = policy.highRiskTargetAllows(taskOnIsolated, {
    taskId: 'task_x',
    action: 'create_isolated_desktop',
    targetId: ISOLATED,
  });
  assert.equal(sameTarget.allowed, true);
});

test('broker names align with compose: container desktop on network hamster_p2', () => {
  // Must-fix 2: broker create/start must use the same names the stack actually routes to.
  assert.equal(isolation.ISOLATED_CONTAINER_NAME, 'desktop');
  assert.equal(isolation.ISOLATED_NETWORK_NAME, 'hamster_p2');
});

test('probe: not_started is distinct from unavailable (broker ok, container absent)', async () => {
  const broker = {
    status: async () => ({ ok: false, running: false, state: 'not_started' }),
  };
  const probe = await isolation.probeIsolatedDesktop({ broker });
  assert.equal(probe.state, 'not_started');
  // Dispatchable for the start-approval chain; not marked unavailable.
  assert.equal(probe.available, true);
  assert.equal(probe.ok, true);
});

test('probe: unavailable when broker missing or probe fails', async () => {
  const noBroker = await isolation.probeIsolatedDesktop({});
  assert.equal(noBroker.state, 'unavailable');
  assert.equal(noBroker.available, false);

  const broken = await isolation.probeIsolatedDesktop({
    broker: {
      status: async () => {
        throw new Error('docker daemon down');
      },
    },
  });
  assert.equal(broken.state, 'unavailable');
  assert.equal(broken.available, false);

  const imageMissing = await isolation.probeIsolatedDesktop({
    broker: {
      status: async () => ({ ok: false, running: false, state: 'unavailable', reason: 'image_unavailable' }),
    },
  });
  assert.equal(imageMissing.state, 'unavailable');
  assert.equal(imageMissing.available, false);
});

test('probe: running container is ok / available', async () => {
  const probe = await isolation.probeIsolatedDesktop({
    broker: { status: async () => ({ ok: true, running: true, state: 'ok' }) },
  });
  assert.equal(probe.state, 'ok');
  assert.equal(probe.available, true);
});

test('broker start args: allowlisted image, named desktop, hamster_p2, no docker.sock mount', async () => {
  const calls = [];
  const broker = isolation.createDockerIsolationBroker({
    dockerRun: async (args) => {
      calls.push(args);
      if (args[0] === 'create') return 'ctr_abc';
      if (args[0] === 'start') return 'ctr_abc';
      if (args[0] === 'inspect') {
        // No existing container — force create path.
        const err = new Error('No such object: desktop');
        throw err;
      }
      if (args[0] === 'image') return 'ok';
      return '';
    },
  });
  const result = await broker.start({ targetId: ISOLATED });
  assert.equal(result.ok, true);
  const create = calls.find((a) => a[0] === 'create');
  assert.ok(create, 'expected docker create');
  assert.ok(create.includes('--name'));
  assert.equal(create[create.indexOf('--name') + 1], 'desktop');
  assert.ok(create.includes('--network'));
  assert.equal(create[create.indexOf('--network') + 1], 'hamster_p2');
  assert.ok(create.includes(isolation.ALLOWLISTED_IMAGE));
  const joined = create.join(' ');
  assert.equal(joined.includes('docker.sock'), false);
  assert.equal(joined.includes('--privileged'), false);
  assert.equal(create.includes('host'), false);
});
