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

test('execution targets: mid-run container stop -> task Failed and execution state stopped', () => {
  const state = isolation.taskExecutionState(taskFixture({ status: 'failed', target_id: ISOLATED }));
  assert.equal(state.state, 'stopped');
});

test('execution targets: task lifecycle stays distinct from container state copy', () => {
  // The container-state sentence must never be a task lifecycle word (Failed / Succeeded).
  const failed = isolation.taskExecutionState(taskFixture({ status: 'failed', target_id: ISOLATED }));
  assert.notEqual(failed.state, 'failed');
  const stopped = isolation.taskExecutionState(taskFixture({ status: 'failed', target_id: ISOLATED }));
  assert.equal(stopped.state, 'stopped');
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
