'use strict';

// HTTP readiness wait for the isolated-desktop eve endpoint after docker start.
// Fail closed on timeout / unreachable — callers must invalidate the start ticket
// and must not leave "Approved for this action only" on the surface.
//
// When expectedIdentity is set, health JSON must bind targetId + instanceId
// (fail closed on missing/mismatch). Plain 2xx without identity is not enough.

const DEFAULT_TIMEOUT_MS = Number(process.env.HAMSTER_ISOLATED_READY_TIMEOUT_MS ?? 60000);
const DEFAULT_INTERVAL_MS = Number(process.env.HAMSTER_ISOLATED_READY_INTERVAL_MS ?? 500);

/**
 * @param {unknown} body
 * @param {{ targetId?: string, instanceId?: string } | null | undefined} expected
 * @returns {{ ok: boolean, reason?: string, targetId?: string|null, instanceId?: string|null, status?: number }}
 */
function bindHealthBody(body, expected) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'health_body_invalid' };
  }
  if (body.ok !== true) {
    return { ok: false, reason: 'health_not_ok' };
  }
  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : null;
  const instanceId = typeof body.instanceId === 'string' ? body.instanceId.trim() : null;
  if (!expected) {
    return { ok: true, targetId, instanceId };
  }
  if (!targetId || !instanceId) {
    return { ok: false, reason: 'health_identity_unbound', targetId, instanceId };
  }
  if (expected.targetId && targetId !== expected.targetId) {
    return { ok: false, reason: 'health_target_mismatch', targetId, instanceId };
  }
  if (expected.instanceId && instanceId !== expected.instanceId) {
    return { ok: false, reason: 'health_instance_mismatch', targetId, instanceId };
  }
  return { ok: true, targetId, instanceId };
}

async function readJsonBody(res) {
  if (!res || typeof res.json !== 'function') {
    // Node fetch / undici always has .json; tests may pass plain objects.
    if (res && typeof res.body === 'object' && res.body !== null) return res.body;
    return null;
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Poll GET {baseUrl}/eve/v1/health until ok (and identity-bound when expected) or timeout.
 */
async function waitForIsolatedDesktopReady(opts = {}) {
  const baseUrl = (opts.baseUrl || process.env.EVE_ISOLATED_API_URL || 'http://desktop:8081').replace(
    /\/$/,
    '',
  );
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const sleep =
    opts.sleep ||
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = opts.now || (() => Date.now());
  const expected = opts.expectedIdentity || null;
  const requireIdentity = opts.requireHealthIdentity === true || Boolean(expected);

  if (typeof fetchImpl !== 'function') {
    return { ok: false, reason: 'fetch_unavailable' };
  }

  const healthUrl = `${baseUrl}/eve/v1/health`;
  const deadline = now() + timeoutMs;
  let lastReason = 'readiness_pending';

  while (now() <= deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(intervalMs, 5000));
      try {
        const res = await fetchImpl(healthUrl, { method: 'GET', signal: controller.signal });
        if (res && res.ok) {
          const body = await readJsonBody(res);
          if (!requireIdentity) {
            if (body && typeof body === 'object' && body.ok === true) {
              return {
                ok: true,
                status: res.status,
                targetId: typeof body.targetId === 'string' ? body.targetId : null,
                instanceId: typeof body.instanceId === 'string' ? body.instanceId : null,
              };
            }
            // Legacy establish: HTTP ok without parseable ok:true still accepted only when
            // requireHealthIdentity is explicitly false and no expectedIdentity.
            return { ok: true, status: res.status, targetId: null, instanceId: null };
          }
          const bound = bindHealthBody(body, expected);
          if (bound.ok) {
            return { ok: true, status: res.status, targetId: bound.targetId, instanceId: bound.instanceId };
          }
          lastReason = bound.reason || 'health_identity_unbound';
        } else {
          lastReason = `readiness_http_${res?.status ?? 'unknown'}`;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastReason = `readiness_unreachable:${String(err?.message ?? err)}`;
    }
    if (now() > deadline) break;
    await sleep(intervalMs);
  }

  return { ok: false, reason: `readiness_timeout:${lastReason}` };
}

/**
 * One-shot health GET for reuse decisions. Fail closed on non-ok / unbound identity.
 */
async function checkIsolatedDesktopHealthOnce(opts = {}) {
  const baseUrl = (opts.baseUrl || process.env.EVE_ISOLATED_API_URL || 'http://desktop:8081').replace(
    /\/$/,
    '',
  );
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, reason: 'fetch_unavailable' };
  }
  const expected = opts.expectedIdentity || null;
  const requireIdentity = opts.requireHealthIdentity !== false; // reuse default: require bind
  const healthUrl = `${baseUrl}/eve/v1/health`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 2000);
    try {
      const res = await fetchImpl(healthUrl, { method: 'GET', signal: controller.signal });
      if (!res || !res.ok) {
        return { ok: false, reason: `readiness_http_${res?.status ?? 'unknown'}` };
      }
      const body = await readJsonBody(res);
      if (!requireIdentity && !expected) {
        if (body && typeof body === 'object' && body.ok === true) {
          return {
            ok: true,
            status: res.status,
            targetId: typeof body.targetId === 'string' ? body.targetId : null,
            instanceId: typeof body.instanceId === 'string' ? body.instanceId : null,
          };
        }
        return { ok: true, status: res.status, targetId: null, instanceId: null };
      }
      const bound = bindHealthBody(body, expected);
      if (!bound.ok) {
        return {
          ok: false,
          reason: bound.reason,
          status: res.status,
          targetId: bound.targetId ?? null,
          instanceId: bound.instanceId ?? null,
        };
      }
      return {
        ok: true,
        status: res.status,
        targetId: bound.targetId,
        instanceId: bound.instanceId,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { ok: false, reason: `readiness_unreachable:${String(err?.message ?? err)}` };
  }
}

module.exports = {
  waitForIsolatedDesktopReady,
  checkIsolatedDesktopHealthOnce,
  bindHealthBody,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_INTERVAL_MS,
};
