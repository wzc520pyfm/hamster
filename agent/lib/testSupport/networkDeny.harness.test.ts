/**
 * Dedicated sanity suite for the offline network-deny harness.
 * Does not import agent.ts or start any service.
 * Local mocked calls only — no real endpoints contacted by design.
 */
import "./networkDeny.harness.ts";
import {
  getNetworkDenyStats,
  isNetworkDenyHarnessInstalled,
  NETWORK_DENIED_PREFIX,
  resetNetworkDenyStats,
} from "./networkDeny.harness.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import httpDefault from "node:http";
import httpsDefault from "node:https";
import netDefault from "node:net";
import * as httpNs from "node:http";
import * as httpsNs from "node:https";

const require = createRequire(import.meta.url);
const http = require("node:http") as typeof httpDefault;
const https = require("node:https") as typeof httpsDefault;
const net = require("node:net") as typeof netDefault;
const tls = require("node:tls") as typeof import("node:tls");

test("harness reports installed (preload and/or import)", () => {
  assert.equal(isNetworkDenyHarnessInstalled(), true);
});

test("harness denies http/https request/get via CJS and default-import aliases", () => {
  resetNetworkDenyStats();
  assert.throws(() => http.request({ host: "127.0.0.1", port: 9, path: "/" }), new RegExp(NETWORK_DENIED_PREFIX));
  assert.throws(() => http.get({ host: "127.0.0.1", port: 9, path: "/" }), new RegExp(NETWORK_DENIED_PREFIX));
  assert.throws(() => https.request({ host: "127.0.0.1", port: 9, path: "/" }), new RegExp(NETWORK_DENIED_PREFIX));
  assert.throws(() => https.get({ host: "127.0.0.1", port: 9, path: "/" }), new RegExp(NETWORK_DENIED_PREFIX));
  assert.throws(() => httpDefault.request({ host: "127.0.0.1", port: 9, path: "/" }), new RegExp(NETWORK_DENIED_PREFIX));
  assert.throws(() => httpsDefault.get({ host: "127.0.0.1", port: 9, path: "/" }), new RegExp(NETWORK_DENIED_PREFIX));
  const s = getNetworkDenyStats();
  assert.ok(s.httpRequest >= 2);
  assert.ok(s.httpGet >= 1);
  assert.ok(s.httpsRequest >= 1);
  assert.ok(s.httpsGet >= 2);
});

test("harness denies fetch, net connect/createConnection/Socket.connect, and tls.connect", () => {
  resetNetworkDenyStats();
  assert.throws(() => globalThis.fetch("https://example.invalid/x"), new RegExp(NETWORK_DENIED_PREFIX));
  assert.throws(() => net.connect({ host: "127.0.0.1", port: 9 }), new RegExp(NETWORK_DENIED_PREFIX));
  assert.throws(() => net.createConnection({ host: "127.0.0.1", port: 9 }), new RegExp(NETWORK_DENIED_PREFIX));
  assert.throws(() => netDefault.connect({ host: "127.0.0.1", port: 9 }), new RegExp(NETWORK_DENIED_PREFIX));
  assert.throws(() => {
    const s = new net.Socket();
    s.connect({ host: "127.0.0.1", port: 9 });
  }, new RegExp(NETWORK_DENIED_PREFIX));
  assert.throws(() => tls.connect({ host: "127.0.0.1", port: 9 }), new RegExp(NETWORK_DENIED_PREFIX));
  const stats = getNetworkDenyStats();
  assert.equal(stats.fetch, 1);
  assert.ok(stats.netConnect >= 2);
  assert.equal(stats.netCreateConnection, 1);
  assert.equal(stats.socketConnect, 1);
  assert.equal(stats.tlsConnect, 1);
});

test("ESM namespace http.request is still denied (net backstop under read-only facade)", () => {
  resetNetworkDenyStats();
  assert.throws(
    () => httpNs.request({ host: "127.0.0.1", port: 9, path: "/" }),
    new RegExp(NETWORK_DENIED_PREFIX),
  );
  const s = getNetworkDenyStats();
  assert.ok(
    s.netCreateConnection >= 1 || s.socketConnect >= 1 || s.httpRequest >= 1,
    `expected net/socket/http denial for namespace http.request, got ${JSON.stringify(s)}`,
  );
});

test("ESM namespace https.request is still denied (tls.connect backstop under read-only facade)", () => {
  resetNetworkDenyStats();
  // https namespace does not share http's net.createConnection path; it uses tls.connect.
  assert.throws(
    () =>
      httpsNs.request({
        host: "127.0.0.1",
        port: 9,
        path: "/",
        rejectUnauthorized: false,
      }),
    new RegExp(NETWORK_DENIED_PREFIX),
  );
  const s = getNetworkDenyStats();
  assert.ok(
    s.tlsConnect >= 1 || s.httpsRequest >= 1 || s.socketConnect >= 1,
    `expected tls/https/socket denial for namespace https.request, got ${JSON.stringify(s)}`,
  );
});
