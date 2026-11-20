#!/usr/bin/env node
/**
 * Isolated-desktop identity gateway (Hamster P2).
 *
 * Real Eve (`npx eve start`) health is `{ ok, status, workflowId }` and
 * `POST /eve/v1/session` rejects unknown body fields. Injected env alone does
 * not bind instance identity. This gateway:
 *   - proxies to a local Eve process
 *   - augments GET /eve/v1/health with targetId + instanceId (+ imageId)
 *   - requires matching x-hamster-* headers on POST /eve/v1/session before
 *     forwarding a clean Eve-legal body (worker-side replacement defense)
 *
 * Control-plane agent keeps plain `eve start`. Broker create for the
 * allowlisted isolated image overrides CMD to run this gateway.
 *
 * Env:
 *   HAMSTER_ISOLATED_INSTANCE_ID (required)
 *   HAMSTER_ISOLATED_TARGET_ID   (default target_isolated_desktop)
 *   HAMSTER_ISOLATED_IMAGE_ID    (optional immutable digest)
 *   PORT                         (public listen, default 8081)
 *   HAMSTER_EVE_UPSTREAM_PORT    (Eve bind, default 18081)
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const INSTANCE_HEADER = 'x-hamster-instance-id';
const TARGET_HEADER = 'x-hamster-target-id';
const IMAGE_HEADER = 'x-hamster-image-id';

const instanceId = String(process.env.HAMSTER_ISOLATED_INSTANCE_ID || '').trim();
const targetId = String(
  process.env.HAMSTER_ISOLATED_TARGET_ID || 'target_isolated_desktop',
).trim();
const imageId = String(process.env.HAMSTER_ISOLATED_IMAGE_ID || '').trim() || null;
const publicPort = Number(process.env.PORT || 8081);
const upstreamPort = Number(process.env.HAMSTER_EVE_UPSTREAM_PORT || 18081);
const upstreamHost = process.env.HAMSTER_EVE_UPSTREAM_HOST || '127.0.0.1';
// Note: instanceId required only when running as main (see main()). Tests import
// createIsolatedIdentityGatewayServer with explicit opts and must not process.exit.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentRoot = path.join(__dirname, '..');

function upstreamUrl(urlPath) {
  return `http://${upstreamHost}:${upstreamPort}${urlPath}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function spawnEve() {
  const child = spawn(
    'npx',
    ['eve', 'start', '--host', upstreamHost, '--port', String(upstreamPort)],
    {
      cwd: agentRoot,
      env: { ...process.env, PORT: String(upstreamPort) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', (d) => process.stdout.write(`[eve] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[eve] ${d}`));
  child.on('exit', (code, signal) => {
    console.error(`[isolated-identity-gateway] eve exited code=${code} signal=${signal}`);
    process.exit(code ?? 1);
  });
  return child;
}

async function waitUpstreamHealthy(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'pending';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(upstreamUrl('/eve/v1/health'));
      const body = await res.json().catch(() => null);
      if (res.ok && body && body.ok === true) return body;
      last = `http_${res.status}`;
    } catch (err) {
      last = String(err?.message ?? err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`eve upstream not ready: ${last}`);
}

function identityMismatch(req) {
  const gotInstance = String(req.headers[INSTANCE_HEADER] || '').trim();
  const gotTarget = String(req.headers[TARGET_HEADER] || '').trim();
  const gotImage = String(req.headers[IMAGE_HEADER] || '').trim();
  if (!gotInstance || gotInstance !== instanceId) {
    return { error: 'instance_id_mismatch', expected: instanceId, got: gotInstance || null };
  }
  if (!gotTarget || gotTarget !== targetId) {
    return { error: 'target_id_mismatch', expected: targetId, got: gotTarget || null };
  }
  if (imageId) {
    if (!gotImage || gotImage !== imageId) {
      return { error: 'image_id_mismatch', expected: imageId, got: gotImage || null };
    }
  }
  return null;
}

async function proxy(req, res, { mutateHealth = false, requireIdentity = false } = {}) {
  if (requireIdentity) {
    const bad = identityMismatch(req);
    if (bad) {
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, ...bad }));
      return;
    }
  }

  const bodyBuf = req.method === 'GET' || req.method === 'HEAD' ? null : await readBody(req);
  const headers = { ...req.headers, host: `${upstreamHost}:${upstreamPort}` };
  // Do not forward hamster identity headers into Eve (unknown to Eve; keep body Eve-legal).
  delete headers[INSTANCE_HEADER];
  delete headers[TARGET_HEADER];
  delete headers[IMAGE_HEADER];
  delete headers['host'];

  const upstream = await fetch(upstreamUrl(req.url || '/'), {
    method: req.method,
    headers,
    body: bodyBuf && bodyBuf.length ? bodyBuf : undefined,
    redirect: 'manual',
  });

  const outHeaders = {};
  upstream.headers.forEach((v, k) => {
    if (k === 'transfer-encoding') return;
    outHeaders[k] = v;
  });

  if (mutateHealth && upstream.ok) {
    const text = await upstream.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      res.writeHead(upstream.status, outHeaders);
      res.end(text);
      return;
    }
    // Preserve real Eve fields; add Hamster identity bind.
    const augmented = {
      ...parsed,
      ok: parsed.ok === true,
      targetId,
      instanceId,
      ...(imageId ? { imageId } : {}),
    };
    const payload = Buffer.from(JSON.stringify(augmented));
    outHeaders['content-type'] = 'application/json';
    outHeaders['content-length'] = String(payload.length);
    res.writeHead(upstream.status, outHeaders);
    res.end(payload);
    return;
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  outHeaders['content-length'] = String(buf.length);
  res.writeHead(upstream.status, outHeaders);
  res.end(buf);
}

export function createIsolatedIdentityGatewayServer(opts = {}) {
  const self = {
    instanceId: opts.instanceId || instanceId,
    targetId: opts.targetId || targetId,
    imageId: opts.imageId || imageId,
  };
  // Allow tests to inject without process env mutation by closing over self.
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/eve/v1/health' && req.method === 'GET') {
        // Test/injected upstream via opts.fetchUpstream
        if (typeof opts.fetchUpstream === 'function') {
          const up = await opts.fetchUpstream('/eve/v1/health', { method: 'GET' });
          const parsed = typeof up.body === 'object' ? up.body : JSON.parse(up.body || '{}');
          const augmented = {
            ...parsed,
            ok: parsed.ok === true,
            targetId: self.targetId,
            instanceId: self.instanceId,
            ...(self.imageId ? { imageId: self.imageId } : {}),
          };
          res.writeHead(up.status || 200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(augmented));
          return;
        }
        await proxy(req, res, { mutateHealth: true });
        return;
      }
      if (url.pathname === '/eve/v1/session' && req.method === 'POST') {
        if (typeof opts.fetchUpstream === 'function') {
          const bad = (() => {
            const gotInstance = String(req.headers[INSTANCE_HEADER] || '').trim();
            const gotTarget = String(req.headers[TARGET_HEADER] || '').trim();
            const gotImage = String(req.headers[IMAGE_HEADER] || '').trim();
            if (!gotInstance || gotInstance !== self.instanceId) {
              return { error: 'instance_id_mismatch', expected: self.instanceId, got: gotInstance || null };
            }
            if (!gotTarget || gotTarget !== self.targetId) {
              return { error: 'target_id_mismatch', expected: self.targetId, got: gotTarget || null };
            }
            if (self.imageId && (!gotImage || gotImage !== self.imageId)) {
              return { error: 'image_id_mismatch', expected: self.imageId, got: gotImage || null };
            }
            return null;
          })();
          if (bad) {
            res.writeHead(409, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, ...bad }));
            return;
          }
          const raw = await readBody(req);
          const up = await opts.fetchUpstream('/eve/v1/session', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: raw.length ? raw.toString('utf8') : '{}',
          });
          res.writeHead(up.status || 202, { 'content-type': 'application/json' });
          res.end(typeof up.body === 'string' ? up.body : JSON.stringify(up.body));
          return;
        }
        await proxy(req, res, { requireIdentity: true });
        return;
      }
      if (typeof opts.fetchUpstream === 'function') {
        res.writeHead(404).end('not proxied in test mode');
        return;
      }
      await proxy(req, res);
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'gateway_proxy_failed', detail: String(err?.message ?? err) }));
    }
  });
  return server;
}

export const IDENTITY_HEADERS = {
  INSTANCE: INSTANCE_HEADER,
  TARGET: TARGET_HEADER,
  IMAGE: IMAGE_HEADER,
};

async function main() {
  if (!instanceId) {
    console.error('[isolated-identity-gateway] HAMSTER_ISOLATED_INSTANCE_ID is required');
    process.exit(1);
  }
  console.log(
    `[isolated-identity-gateway] starting eve on ${upstreamHost}:${upstreamPort}; public :${publicPort}`,
  );
  console.log(
    `[isolated-identity-gateway] identity instanceId=${instanceId} targetId=${targetId} imageId=${imageId || '(none)'}`,
  );
  spawnEve();
  await waitUpstreamHealthy();
  const server = createIsolatedIdentityGatewayServer();
  await new Promise((resolve) => server.listen(publicPort, '0.0.0.0', resolve));
  console.log(`[isolated-identity-gateway] listening on 0.0.0.0:${publicPort}`);
}

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error('[isolated-identity-gateway] fatal', err);
    process.exit(1);
  });
}
