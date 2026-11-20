'use strict';

// HTTP readiness wait for the isolated-desktop eve endpoint after docker start.
// Fail closed on timeout / unreachable — callers must invalidate the start ticket
// and must not leave "Approved for this action only" on the surface.

const DEFAULT_TIMEOUT_MS = Number(process.env.HAMSTER_ISOLATED_READY_TIMEOUT_MS ?? 60000);
const DEFAULT_INTERVAL_MS = Number(process.env.HAMSTER_ISOLATED_READY_INTERVAL_MS ?? 500);

/**
 * Poll GET {baseUrl}/eve/v1/health until ok or timeout.
 * @param {{
 *   baseUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   intervalMs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 * }} [opts]
 * @returns {Promise<{ ok: boolean, reason?: string, status?: number }>}
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
          return { ok: true, status: res.status };
        }
        lastReason = `readiness_http_${res?.status ?? 'unknown'}`;
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
 * One-shot health GET for reuse decisions. Fail closed on non-ok / unreachable.
 * Does not start or create anything.
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
  const healthUrl = `${baseUrl}/eve/v1/health`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 2000);
    try {
      const res = await fetchImpl(healthUrl, { method: 'GET', signal: controller.signal });
      if (res && res.ok) return { ok: true, status: res.status };
      return { ok: false, reason: `readiness_http_${res?.status ?? 'unknown'}` };
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
  DEFAULT_TIMEOUT_MS,
  DEFAULT_INTERVAL_MS,
};
