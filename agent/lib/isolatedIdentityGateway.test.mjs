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
import http from 'node:http';
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
    imageId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
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
    assert.equal(body.imageId, 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('gateway rejects session without matching identity headers (worker-side)', async () => {
  let upstreamSession = 0;
  const server = createIsolatedIdentityGatewayServer({
    instanceId: 'inst_boot_1',
    targetId: 'target_isolated_desktop',
    imageId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
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
        [IDENTITY_HEADERS.IMAGE]: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
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
        [IDENTITY_HEADERS.IMAGE]: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
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

const DIGEST =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

test('ALL session routes require identity; stubs /existing and /cancel are not 202 passthrough', async () => {
  const forwarded = [];
  const server = createIsolatedIdentityGatewayServer({
    instanceId: 'inst_boot_1',
    targetId: 'target_isolated_desktop',
    imageId: DIGEST,
    fetchUpstream: async (path, opts = {}) => {
      forwarded.push({ path, method: opts.method || 'GET' });
      return { status: 202, body: { ok: true, proxied: path } };
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    for (const path of [
      '/eve/v1/session/existing',
      '/eve/v1/session/existing/cancel',
      '/eve/v1/session/sess_1/stream',
      '/eve/v1/session/sess_1',
    ]) {
      const bad = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(bad.status, 409, path);
      const body = await bad.json();
      assert.equal(body.error, 'instance_id_mismatch');
    }
    assert.equal(forwarded.length, 0, 'must not proxy without identity');

    const okHdrs = {
      'content-type': 'application/json',
      [IDENTITY_HEADERS.INSTANCE]: 'inst_boot_1',
      [IDENTITY_HEADERS.TARGET]: 'target_isolated_desktop',
      [IDENTITY_HEADERS.IMAGE]: DIGEST,
    };
    // Non-stream stubs still use fetchUpstream; stream uses incremental proxy (separate test).
    for (const path of ['/eve/v1/session/existing', '/eve/v1/session/existing/cancel']) {
      const ok = await fetch(`${base}${path}`, { method: 'POST', headers: okHdrs, body: '{}' });
      assert.equal(ok.status, 202, path);
    }
    assert.equal(forwarded.length, 2);

    // Non-session routes fail closed — no unsafe passthrough.
    const other = await fetch(`${base}/eve/v1/other`, { method: 'GET' });
    assert.equal(other.status, 404);
    const otherBody = await other.json();
    assert.equal(otherBody.error, 'route_not_allowed_by_gateway');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('mismatched image digest header rejected on session create', async () => {
  let upstream = 0;
  const server = createIsolatedIdentityGatewayServer({
    instanceId: 'inst_boot_1',
    targetId: 'target_isolated_desktop',
    imageId: DIGEST,
    fetchUpstream: async () => {
      upstream += 1;
      return { status: 202, body: { ok: true } };
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/eve/v1/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [IDENTITY_HEADERS.INSTANCE]: 'inst_boot_1',
        [IDENTITY_HEADERS.TARGET]: 'target_isolated_desktop',
        [IDENTITY_HEADERS.IMAGE]: 'sha256:',
      },
      body: JSON.stringify({ message: 'hi' }),
    });
    assert.equal(res.status, 409);
    assert.equal(upstream, 0);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('incremental NDJSON stream: first headers/event before end; cancel cleans upstream', async () => {
  let upstreamCanceled = false;
  let upstreamReqClosed = false;
  const events = [
    '{"type":"ping","n":1}\n',
    '{"type":"ping","n":2}\n',
    '{"type":"ping","n":3}\n',
  ];

  // Continuous upstream: delays 250ms between lines; never buffers whole body first.
  const upstream = http.createServer((req, res) => {
    if (!req.url.includes('/stream')) {
      res.writeHead(404).end();
      return;
    }
    req.on('aborted', () => {
      upstreamCanceled = true;
    });
    res.on('close', () => {
      upstreamReqClosed = true;
    });
    res.writeHead(200, {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-cache',
    });
    let i = 0;
    const tick = () => {
      if (res.destroyed || res.writableEnded) return;
      if (i >= events.length) {
        res.end();
        return;
      }
      res.write(events[i]);
      i += 1;
      setTimeout(tick, 250);
    };
    tick();
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const upPort = upstream.address().port;
  process.env.HAMSTER_EVE_UPSTREAM_HOST = '127.0.0.1';
  process.env.HAMSTER_EVE_UPSTREAM_PORT = String(upPort);

  const gateway = createIsolatedIdentityGatewayServer({
    instanceId: 'inst_boot_1',
    targetId: 'target_isolated_desktop',
    imageId: DIGEST,
    // No fetchUpstream — real incremental proxy to local upstream.
  });
  await new Promise((r) => gateway.listen(0, '127.0.0.1', r));
  const gwPort = gateway.address().port;

  try {
    const ac = new AbortController();
    const t0 = Date.now();
    const res = await fetch(`http://127.0.0.1:${gwPort}/eve/v1/session/sess_stream/stream`, {
      method: 'GET',
      headers: {
        [IDENTITY_HEADERS.INSTANCE]: 'inst_boot_1',
        [IDENTITY_HEADERS.TARGET]: 'target_isolated_desktop',
        [IDENTITY_HEADERS.IMAGE]: DIGEST,
      },
      signal: ac.signal,
    });
    // Headers must arrive before the full finite stream ends (~750ms+).
    const headersAt = Date.now() - t0;
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get('content-type') || ''), /ndjson|octet|json/i);
    assert.ok(headersAt < 400, `headers too late (${headersAt}ms) — still buffering?`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let firstEventAt = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      if (firstEventAt == null && buf.includes('"n":1')) {
        firstEventAt = Date.now() - t0;
        // Cancel after first event — must clean upstream (not wait for full body).
        ac.abort();
        break;
      }
    }
    assert.ok(firstEventAt != null, 'first NDJSON event never arrived before end');
    assert.ok(firstEventAt < 500, `first event too late (${firstEventAt}ms)`);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(
      upstreamCanceled || upstreamReqClosed,
      'upstream must be cancelled/closed after client abort',
    );

    // Identity still required on stream.
    const bad = await fetch(`http://127.0.0.1:${gwPort}/eve/v1/session/sess_stream/stream`, {
      method: 'GET',
    });
    assert.equal(bad.status, 409);
  } finally {
    await new Promise((r) => gateway.close(r));
    await new Promise((r) => upstream.close(r));
  }
});
