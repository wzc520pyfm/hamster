'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const readiness = require('./readiness');

test('waitForIsolatedDesktopReady: succeeds when health returns ok', async () => {
  let calls = 0;
  const result = await readiness.waitForIsolatedDesktopReady({
    baseUrl: 'http://desktop:8081',
    timeoutMs: 2000,
    intervalMs: 10,
    fetchImpl: async (url) => {
      calls += 1;
      assert.match(String(url), /\/eve\/v1\/health$/);
      return { ok: true, status: 200 };
    },
  });
  assert.equal(result.ok, true);
  assert.ok(calls >= 1);
});

test('waitForIsolatedDesktopReady: times out when unreachable (fail closed)', async () => {
  let now = 0;
  const result = await readiness.waitForIsolatedDesktopReady({
    baseUrl: 'http://desktop:8081',
    timeoutMs: 50,
    intervalMs: 10,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /readiness_timeout/);
});

test('waitForIsolatedDesktopReady: non-ok HTTP eventually times out', async () => {
  let now = 0;
  const result = await readiness.waitForIsolatedDesktopReady({
    baseUrl: 'http://desktop:8081',
    timeoutMs: 40,
    intervalMs: 10,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /readiness_timeout/);
});
