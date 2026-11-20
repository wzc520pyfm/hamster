/**
 * Must-fix 4: not-started ≠ unavailable for composer dispatch.
 * Run: node --test client/src/lib/runTargetDispatch.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { canDispatchToIsolated, mayUseControlPlaneInstead } from './runTargetDispatch.mjs'

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
