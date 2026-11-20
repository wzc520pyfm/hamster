import test from 'node:test'
import assert from 'node:assert/strict'
import { parseWorkerHeader } from './workerHeader.ts'

test('parseWorkerHeader keeps taskId, conversationId, targetId, title separate', () => {
  const h = parseWorkerHeader(
    '[hamster-worker taskId=task_abc conversationId=conv_1 targetId=target_isolated_desktop title=Build weekly metrics] do the work',
    'sess_runtime',
  )
  assert.equal(h.taskId, 'task_abc')
  assert.equal(h.conversationId, 'conv_1')
  assert.equal(h.targetId, 'target_isolated_desktop')
  assert.equal(h.title, 'Build weekly metrics')
  assert.equal(h.runtimeSessionId, 'sess_runtime')
})

test('parseWorkerHeader: title with spaces does not swallow targetId', () => {
  // Legacy/broken order would make title=([^\]]+) eat targetId= — new order puts title last.
  const h = parseWorkerHeader(
    '[hamster-worker taskId=task_1 conversationId=conv_x targetId=target_control_plane title=Hello world report]',
  )
  assert.equal(h.targetId, 'target_control_plane')
  assert.equal(h.title, 'Hello world report')
  assert.equal(h.conversationId, 'conv_x')
})
