#!/usr/bin/env node
/**
 * Isolated-desktop identity gateway (Hamster P2).
 *
 * Real Eve (`npx eve start`) health is `{ ok, status, workflowId }` and
 * session routes reject unknown body fields. This gateway:
 *   - proxies to a local Eve process
 *   - augments GET /eve/v1/health with targetId + instanceId (+ imageId)
 *   - requires matching x-hamster-* headers on ALL /eve/v1/session* routes
 *     (create, follow-up, cancel, stream, compact, clear, end, stubs, …)
 *   - fails closed on other non-health paths (no unsafe passthrough)
 *
 * Control-plane agent keeps plain `eve start`. Broker create for the
 * allowlisted isolated image overrides CMD to run this gateway.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentRoot = path.join(__dirname, '..');

/** Read at call time so bootstrap can set env before first proxy hop. */
function upstreamHostPort() {
  return {
    host: process.env.HAMSTER_EVE_UPSTREAM_HOST || '127.0.0.1',
    port: Number(process.env.HAMSTER_EVE_UPSTREAM_PORT || 18081),
  };
}

function upstreamUrl(urlPath) {
  const { host, port } = upstreamHostPort();
  return `http://${host}:${port}${urlPath}`;
}

function isSessionRoute(pathname) {
  return pathname === '/eve/v1/session' || pathname.startsWith('/eve/v1/session/');
}

function isHealthRoute(pathname) {
  return pathname === '/eve/v1/health';
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function spawnEve() {
  const { host, port } = upstreamHostPort();
  const child = spawn(
    'npx',
    ['eve', 'start', '--host', host, '--port', String(port)],
    {
      cwd: agentRoot,
      env: { ...process.env, PORT: String(port) },
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

function checkIdentity(req, self) {
  const gotInstance = String(req.headers[INSTANCE_HEADER] || '').trim();
  const gotTarget = String(req.headers[TARGET_HEADER] || '').trim();
  const gotImage = String(req.headers[IMAGE_HEADER] || '').trim();
  if (!gotInstance || gotInstance !== self.instanceId) {
    return { error: 'instance_id_mismatch', expected: self.instanceId, got: gotInstance || null };
  }
  if (!gotTarget || gotTarget !== self.targetId) {
    return { error: 'target_id_mismatch', expected: self.targetId, got: gotTarget || null };
  }
  if (self.imageId) {
    if (!gotImage || gotImage !== self.imageId) {
      return { error: 'image_id_mismatch', expected: self.imageId, got: gotImage || null };
    }
  }
  return null;
}

async function proxy(req, res, { mutateHealth = false, requireIdentity = false, self } = {}) {
  if (requireIdentity) {
    const bad = checkIdentity(req, self);
    if (bad) {
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, ...bad }));
      return;
    }
  }

  const bodyBuf = req.method === 'GET' || req.method === 'HEAD' ? null : await readBody(req);
  const headers = { ...req.headers };
  delete headers[INSTANCE_HEADER];
  delete headers[TARGET_HEADER];
  delete headers[IMAGE_HEADER];
  delete headers.host;

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
    const augmented = {
      ...parsed,
      ok: parsed.ok === true,
      targetId: self.targetId,
      instanceId: self.instanceId,
      ...(self.imageId ? { imageId: self.imageId } : {}),
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

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = url.pathname;

      if (isHealthRoute(pathname) && req.method === 'GET') {
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
        await proxy(req, res, { mutateHealth: true, self });
        return;
      }

      if (isSessionRoute(pathname)) {
        if (typeof opts.fetchUpstream === 'function') {
          const bad = checkIdentity(req, self);
          if (bad) {
            res.writeHead(409, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, ...bad }));
            return;
          }
          const raw = await readBody(req);
          const up = await opts.fetchUpstream(pathname + url.search, {
            method: req.method,
            headers: { 'content-type': 'application/json' },
            body: raw.length ? raw.toString('utf8') : undefined,
          });
          res.writeHead(up.status || 202, { 'content-type': 'application/json' });
          res.end(typeof up.body === 'string' ? up.body : JSON.stringify(up.body ?? {}));
          return;
        }
        await proxy(req, res, { requireIdentity: true, self });
        return;
      }

      // No unsafe passthrough: unknown routes fail closed.
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'route_not_allowed_by_gateway' }));
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          error: 'gateway_proxy_failed',
          detail: String(err?.message ?? err),
        }),
      );
    }
  });
  return server;
}

export const IDENTITY_HEADERS = {
  INSTANCE: INSTANCE_HEADER,
  TARGET: TARGET_HEADER,
  IMAGE: IMAGE_HEADER,
};

export { isSessionRoute, isHealthRoute, checkIdentity };

async function main() {
  if (!instanceId) {
    console.error('[isolated-identity-gateway] HAMSTER_ISOLATED_INSTANCE_ID is required');
    process.exit(1);
  }
  const up = upstreamHostPort();
  console.log(
    `[isolated-identity-gateway] starting eve on ${up.host}:${up.port}; public :${publicPort}`,
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
