'use strict';

// Thin client for a self-hosted eve instance (eve build && eve start).
// No Vercel dependency, no hosted eve service.
// Control-plane and isolated-desktop workers use distinct base URLs (must-fix 3).
//
// Real Eve health is `{ ok, status, workflowId }` and session POST rejects unknown
// body fields. Isolated identity is bound via x-hamster-* headers enforced by the
// isolated-identity gateway that wraps Eve inside the allowlisted desktop image.

const isolation = require('./isolation');

const REQUEST_TIMEOUT_MS = 15000;
const AGENT_USER = process.env.HAMSTER_AGENT_USERNAME ?? 'hamster';
const AGENT_PASSWORD = process.env.HAMSTER_AGENT_PASSWORD;
const BASIC_AUTH = AGENT_PASSWORD
  ? 'Basic ' + Buffer.from(`${AGENT_USER}:${AGENT_PASSWORD}`).toString('base64')
  : null;

const INSTANCE_HEADER = 'x-hamster-instance-id';
const TARGET_HEADER = 'x-hamster-target-id';
const IMAGE_HEADER = 'x-hamster-image-id';

function controlPlaneEveUrl() {
  return process.env.EVE_API_URL ?? 'http://localhost:8081';
}

function isolatedEveUrl() {
  return process.env.EVE_ISOLATED_API_URL ?? 'http://desktop:8081';
}

/**
 * Resolve the eve base URL for an execution target.
 * Isolated desktop must never share the control-plane agent endpoint.
 * URLs are read at call time so tests / restarts can rebind without stale module constants.
 */
function baseUrlForTarget(targetId) {
  if (isolation.isIsolatedDesktopTarget(targetId)) {
    return isolatedEveUrl();
  }
  return controlPlaneEveUrl();
}

function identityHeaders(identity) {
  if (!identity || typeof identity !== 'object') return {};
  const headers = {};
  if (identity.instanceId) headers[INSTANCE_HEADER] = String(identity.instanceId);
  if (identity.targetId) headers[TARGET_HEADER] = String(identity.targetId);
  if (identity.imageId) headers[IMAGE_HEADER] = String(identity.imageId);
  return headers;
}

async function eveFetch(path, { method = 'GET', body, baseUrl, headers: extraHeaders } = {}) {
  const root = baseUrl || controlPlaneEveUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${root}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(BASIC_AUTH ? { authorization: BASIC_AUTH } : {}),
        ...(extraHeaders || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }
    if (!res.ok) {
      const err = new Error((parsed && parsed.error) || `eve ${method} ${path} -> HTTP ${res.status}`);
      err.status = res.status;
      err.body = parsed;
      throw err;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

const health = (opts = {}) =>
  eveFetch('/eve/v1/health', {
    baseUrl: baseUrlForTarget(opts.targetId),
    headers: identityHeaders(opts.identity),
  });

/**
 * Create a session. For isolated targets, opts.identity MUST be the frozen
 * start/managed identity; headers are enforced by the worker gateway.
 * Body stays Eve-legal (message only) — no unknown top-level fields.
 */
async function createSession(message, opts = {}) {
  const body = message === undefined ? {} : { message };
  const targetId = opts.targetId;
  const identity = opts.identity || null;
  if (isolation.isIsolatedDesktopTarget(targetId)) {
    if (!identity?.instanceId || !identity?.targetId || !identity?.imageId) {
      const err = new Error('isolated_session_identity_required');
      err.status = 409;
      throw err;
    }
  }
  const res = await eveFetch('/eve/v1/session', {
    method: 'POST',
    body,
    baseUrl: baseUrlForTarget(targetId),
    headers: identityHeaders(identity),
  });
  return { sessionId: res.sessionId, deliveryId: res.deliveryId };
}

const sendMessage = (sessionId, message, opts = {}) =>
  eveFetch(`/eve/v1/session/${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    body: { message },
    baseUrl: baseUrlForTarget(opts.targetId),
    headers: identityHeaders(opts.identity),
  });

const answerInteraction = (sessionId, interactionId, optionId, text, opts = {}) =>
  eveFetch(`/eve/v1/session/${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    body: { answers: [{ interactionId, optionId, ...(text ? { text } : {}) }] },
    baseUrl: baseUrlForTarget(opts.targetId),
    headers: identityHeaders(opts.identity),
  });

const cancelSession = (sessionId, opts = {}) =>
  eveFetch(`/eve/v1/session/${encodeURIComponent(sessionId)}/cancel`, {
    method: 'POST',
    body: {},
    baseUrl: baseUrlForTarget(opts.targetId),
    headers: identityHeaders(opts.identity),
  });

module.exports = {
  health,
  createSession,
  sendMessage,
  answerInteraction,
  cancelSession,
  eveFetch,
  identityHeaders,
  INSTANCE_HEADER,
  TARGET_HEADER,
  IMAGE_HEADER,
  get EVE_URL() {
    return controlPlaneEveUrl();
  },
  get EVE_ISOLATED_URL() {
    return isolatedEveUrl();
  },
  baseUrlForTarget,
};

// ---------------------------------------------------------------------------
// NDJSON event follower. Re-attaches on boot; handlers must be idempotent.
// ---------------------------------------------------------------------------

/**
 * Follow a session stream forever (until aborted). Lines are parsed as NDJSON.
 * onFact(fact, at) is called for every entry of facts[].
 */
async function* streamLines(url, signal) {
  const res = await fetch(url, {
    signal,
    headers: BASIC_AUTH ? { authorization: BASIC_AUTH } : undefined,
  });
  if (!res.ok || !res.body) {
    throw new Error(`stream -> HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // skip malformed line
      }
    }
  }
}

const followers = new Map();

function attachFollower(key, sessionId, onFact, opts = {}) {
  if (followers.has(key)) return;
  const controller = new AbortController();
  followers.set(key, controller);
  const base = baseUrlForTarget(opts.targetId);

  const run = async () => {
    let attempt = 0;
    while (!controller.signal.aborted) {
      try {
        for await (const line of streamLines(
          `${base}/eve/v1/session/${encodeURIComponent(sessionId)}/stream`,
          controller.signal
        )) {
          attempt = 0;
          if (Array.isArray(line.facts)) {
            for (const fact of line.facts) {
              try {
                await onFact(fact);
              } catch (err) {
                console.error(`[eve-follow:${key}] handler error for ${fact?.type}:`, err);
              }
            }
          }
        }
        // Stream closed cleanly (session ended).
        return;
      } catch (err) {
        if (controller.signal.aborted) return;
        attempt += 1;
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
        console.warn(`[eve-follow:${key}] stream error, retry in ${delay}ms:`, err.message);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  };
  run();
}

function detachAll() {
  for (const controller of followers.values()) controller.abort();
  followers.clear();
}

module.exports.attachFollower = attachFollower;
module.exports.detachAll = detachAll;
