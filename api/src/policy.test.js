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

test('high-risk target binding: missing params.targetId fails closed (no task fallback)', () => {
  const taskOnIsolated = { target_id: ISOLATED, status: 'queued' };
  const missing = policy.highRiskTargetAllows(taskOnIsolated, { taskId: 'task_1', action: 'create_isolated_desktop' });
  assert.equal(missing.allowed, false);
  assert.equal(missing.reason, 'target_id_missing');
  const empty = policy.highRiskTargetAllows(taskOnIsolated, {
    taskId: 'task_1',
    action: 'create_isolated_desktop',
    targetId: '',
  });
  assert.equal(empty.allowed, false);
});

test('schema.sql creates tables before altering them (fresh volume safe)', () => {
  const fs = require('fs');
  const path = require('path');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const createTasks = schema.indexOf('CREATE TABLE IF NOT EXISTS tasks');
  const alterTasks = schema.indexOf('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS');
  const createApprovals = schema.indexOf('CREATE TABLE IF NOT EXISTS approvals');
  const alterApprovals = schema.indexOf('ALTER TABLE approvals ADD COLUMN IF NOT EXISTS');
  assert.ok(createTasks >= 0 && alterTasks >= 0);
  assert.ok(createTasks < alterTasks, 'CREATE tasks must precede ALTER tasks');
  assert.ok(createApprovals >= 0 && alterApprovals >= 0);
  assert.ok(createApprovals < alterApprovals, 'CREATE approvals must precede ALTER approvals');
});
