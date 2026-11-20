'use strict';

// Contract: after docker start, readiness / createSession failure must leave the task in
// start_failed territory (queued, no pending create ticket) and must not leave the ticket
// surface as "Approved for this action only".

const test = require('node:test');
const assert = require('node:assert/strict');
const isolation = require('./isolation');
const readiness = require('./readiness');

test('queued isolated task without pending create ticket is start_failed', () => {
  const state = isolation.taskExecutionState({
    id: 'task_x',
    status: 'queued',
    target_id: isolation.ISOLATED_DESKTOP_TARGET_ID,
    approvals: [{ action: 'create_isolated_desktop', status: 'invalidated' }],
  });
  assert.equal(state.state, 'start_failed');
});

test('approve-once note must not be the decision_note after a simulated start failure path', () => {
  // Pure contract: invalidation uses INVALIDATED_NOTE, never APPROVED_ONCE_NOTE.
  assert.equal(isolation.INVALIDATED_NOTE, 'Invalidated — approve again');
  assert.equal(isolation.APPROVED_ONCE_NOTE, 'Approved for this action only');
  assert.notEqual(isolation.INVALIDATED_NOTE, isolation.APPROVED_ONCE_NOTE);
});

test('readiness failure reason is distinct and fail-closed (feeds start_failed path)', async () => {
  let now = 0;
  const result = await readiness.waitForIsolatedDesktopReady({
    timeoutMs: 30,
    intervalMs: 5,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED');
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /readiness_timeout/);
});
