/**
 * Must-fix 4: not-started ≠ unavailable for composer dispatch.
 * Run: node --test client/src/lib/runTargetDispatch.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canDispatchToIsolated,
  mayUseControlPlaneInstead,
  showUnstartedIsolatedActions,
  isLongTaskDispatch,
} from './runTargetDispatch.mjs'

test('dispatch: not_started allows send (start-approval chain); unavailable blocks', () => {
  assert.equal(canDispatchToIsolated('not_started'), true)
  assert.equal(canDispatchToIsolated('ok'), true)
  assert.equal(canDispatchToIsolated('unavailable'), false)
})

test('Use the control plane instead: only for tasks that have not started', () => {
  assert.equal(mayUseControlPlaneInstead('queued'), true)
  assert.equal(mayUseControlPlaneInstead('running'), false)
  assert.equal(mayUseControlPlaneInstead('waiting_for_approval'), false)
  assert.equal(mayUseControlPlaneInstead('succeeded'), false)
  assert.equal(mayUseControlPlaneInstead('failed'), false)
  assert.equal(mayUseControlPlaneInstead('cancelled'), false)
})

test('Use the control plane instead: available for pending_approval and start_failed', () => {
  assert.equal(showUnstartedIsolatedActions('pending_approval', 'queued'), true)
  assert.equal(showUnstartedIsolatedActions('start_failed', 'queued'), true)
  assert.equal(showUnstartedIsolatedActions('ok', 'running'), false)
  assert.equal(showUnstartedIsolatedActions('stopped', 'failed'), false)
})

test('only long-task dispatch reads Run-on; progress/follow-ups do not match', () => {
  assert.equal(isLongTaskDispatch('start task: build a dashboard'), true)
  assert.equal(isLongTaskDispatch('progress task_abc'), false)
  assert.equal(isLongTaskDispatch('hello hamster'), false)
})
