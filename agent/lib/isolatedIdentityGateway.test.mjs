/**
 * Bootstrap proof for isolated identity gateway against **real Eve health shape**.
 *
 * Real Eve public GET /eve/v1/health returns `{ ok, status, workflowId }` — NOT
 * targetId/instanceId. This test injects that exact upstream shape and proves the
 * production gateway augments + enforces session headers.
 *
 * This is NOT the API HTTP harness fake. No docker / no live desktop / no shared PG.
 *
 * Run: node --test agent/lib/isolatedIdentityGateway.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIsolatedIdentityGatewayServer,
  IDENTITY_HEADERS,
} from './isolatedIdentityGateway.mjs';

const REAL_EVE_HEALTH = {
  ok: true,
  status: 'ready',
  workflowId: 'wf_real_eve_shape_bootstrap',
};

test('gateway augments real Eve health with targetId/instanceId/imageId', async () => {
  const server = createIsolatedIdentityGatewayServer({
    instanceId: 'inst_boot_1',
    targetId: 'target_isolated_desktop',
    imageId: 'sha256:bootdigest',
    fetchUpstream: async (path) => {
      assert.equal(path, '/eve/v1/health');
      return { status: 200, body: { ...REAL_EVE_HEALTH } };
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/eve/v1/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.status, 'ready');
    assert.equal(body.workflowId, REAL_EVE_HEALTH.workflowId);
    assert.equal(body.targetId, 'target_isolated_desktop');
    assert.equal(body.instanceId, 'inst_boot_1');
    assert.equal(body.imageId, 'sha256:bootdigest');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('gateway rejects session without matching identity headers (worker-side)', async () => {
  let upstreamSession = 0;
  const server = createIsolatedIdentityGatewayServer({
    instanceId: 'inst_boot_1',
    targetId: 'target_isolated_desktop',
    imageId: 'sha256:bootdigest',
    fetchUpstream: async (path) => {
      if (path === '/eve/v1/session') {
        upstreamSession += 1;
        return {
          status: 202,
          body: { ok: true, sessionId: 'wrun_boot', deliveryId: 'del_boot' },
        };
      }
      return { status: 200, body: { ...REAL_EVE_HEALTH } };
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { port } = server.address();
    const bad = await fetch(`http://127.0.0.1:${port}/eve/v1/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });
    assert.equal(bad.status, 409);
    assert.equal(upstreamSession, 0, 'must not forward to Eve on mismatch');

    const spoof = await fetch(`http://127.0.0.1:${port}/eve/v1/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [IDENTITY_HEADERS.INSTANCE]: 'inst_OTHER',
        [IDENTITY_HEADERS.TARGET]: 'target_isolated_desktop',
        [IDENTITY_HEADERS.IMAGE]: 'sha256:bootdigest',
      },
      body: JSON.stringify({ message: 'hi' }),
    });
    assert.equal(spoof.status, 409);
    assert.equal(upstreamSession, 0);

    const ok = await fetch(`http://127.0.0.1:${port}/eve/v1/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [IDENTITY_HEADERS.INSTANCE]: 'inst_boot_1',
        [IDENTITY_HEADERS.TARGET]: 'target_isolated_desktop',
        [IDENTITY_HEADERS.IMAGE]: 'sha256:bootdigest',
      },
      body: JSON.stringify({ message: 'hi' }),
    });
    assert.equal(ok.status, 202);
    const body = await ok.json();
    assert.equal(body.sessionId, 'wrun_boot');
    assert.equal(upstreamSession, 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('document: bare Eve health lacks identity — wrapper is required', () => {
  assert.equal(Object.hasOwn(REAL_EVE_HEALTH, 'targetId'), false);
  assert.equal(Object.hasOwn(REAL_EVE_HEALTH, 'instanceId'), false);
  assert.equal(REAL_EVE_HEALTH.ok, true);
  assert.equal(REAL_EVE_HEALTH.status, 'ready');
  assert.equal(typeof REAL_EVE_HEALTH.workflowId, 'string');
});
