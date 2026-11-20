'use strict';

// Hamster P2 slice 1 — failing-first tests for control-plane policy (target binding + high-risk set).

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('./policy');
const isolation = require('./isolation');

const CONTROL = isolation.CONTROL_PLANE_TARGET_ID;
const ISOLATED = isolation.ISOLATED_DESKTOP_TARGET_ID;

test('paramsHash is deterministic and sensitive to key order', () => {
  const a = policy.paramsHash({ taskId: 'task_1', targetId: 'target_isolated_desktop' });
  const b = policy.paramsHash({ taskId: 'task_1', targetId: 'target_isolated_desktop' });
  assert.equal(a, b);
  const reordered = policy.paramsHash({ targetId: 'target_isolated_desktop', taskId: 'task_1' });
  assert.equal(a, reordered);
  assert.notEqual(a, policy.paramsHash({ taskId: 'task_1', targetId: 'target_control_plane' }));
});

test('high-risk action sets: publish_dashboard + create_isolated_desktop', () => {
  assert.equal(policy.HIGH_RISK_ACTIONS.has('publish_dashboard'), true);
  assert.equal(policy.HIGH_RISK_ACTIONS.has('create_isolated_desktop'), true);
  assert.equal(policy.LOW_RISK_ACTIONS.has('acknowledge_control'), true);
  assert.equal(policy.isHighRiskAction('create_isolated_desktop'), true);
});

test('high-risk target binding: ticket must match task execution target', () => {
  const taskOnIsolated = { target_id: ISOLATED, status: 'queued' };
  const taskOnControl = { target_id: CONTROL, status: 'waiting_for_approval' };

  assert.equal(
    policy.highRiskTargetAllows(taskOnIsolated, { taskId: 'task_1', action: 'create_isolated_desktop', targetId: ISOLATED }).allowed,
    true,
  );
  assert.equal(
    policy.highRiskTargetAllows(taskOnIsolated, { taskId: 'task_1', action: 'create_isolated_desktop', targetId: CONTROL }).allowed,
    false,
  );
  assert.equal(
    policy.highRiskTargetAllows(taskOnControl, { taskId: 'task_1', action: 'publish_dashboard', targetId: CONTROL }).allowed,
    true,
  );
  assert.equal(
    policy.highRiskTargetAllows(taskOnControl, { taskId: 'task_1', action: 'publish_dashboard', targetId: ISOLATED }).allowed,
    false,
  );
});
