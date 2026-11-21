/**
 * Offline network-deny harness for Hamster agent unit tests.
 *
 * Preferred install path: `node --import ./lib/testSupport/networkDeny.preload.ts`
 * so EVERY test child installs the guard before any test/production imports.
 * Files may also `import` this module; install is idempotent.
 *
 * Covers (named offline contract):
 * - globalThis.fetch
 * - node:http / node:https `.request` and `.get` (CJS / default-import aliases)
 * - node:net `.connect` / `.createConnection` / Socket.prototype.connect
 * - node:tls `.connect` (https ESM namespace backstop — does not go through net alone)
 *
 * ESM `import * as http|https` namespace objects are read-only; CJS export mutation
 * covers require/default-import. Namespace http falls through to net; namespace
 * https falls through to tls.connect — both are hooked here so outbound sockets
 * cannot open. Denied calls throw immediately (no endpoint contact by design).
 *
 * Tests-only. Does not change production selection code.
 */

import { createRequire } from "node:module";
import type * as Http from "node:http";
import type * as Https from "node:https";
import type * as Net from "node:net";
import type * as Tls from "node:tls";

export const NETWORK_DENIED_PREFIX = "NETWORK_DENIED:";
export const NETWORK_DENY_GLOBAL_FLAG = "__HAMSTER_NETWORK_DENY_INSTALLED__";

export type NetworkDenyStats = {
  fetch: number;
  httpRequest: number;
  httpGet: number;
  httpsRequest: number;
  httpsGet: number;
  netConnect: number;
  netCreateConnection: number;
  socketConnect: number;
  tlsConnect: number;
};

const stats: NetworkDenyStats = {
  fetch: 0,
  httpRequest: 0,
  httpGet: 0,
  httpsRequest: 0,
  httpsGet: 0,
  netConnect: 0,
  netCreateConnection: 0,
  socketConnect: 0,
  tlsConnect: 0,
};

let installed = false;

const require = createRequire(import.meta.url);
const http = require("node:http") as typeof Http;
const https = require("node:https") as typeof Https;
const net = require("node:net") as typeof Net;
const tls = require("node:tls") as typeof Tls;

function deny(kind: keyof NetworkDenyStats): never {
  stats[kind] += 1;
  throw new Error(
    `${NETWORK_DENIED_PREFIX} ${kind} blocked by testSupport/networkDeny.harness (no outbound network in offline tests)`,
  );
}

type AnyFn = (...args: unknown[]) => unknown;

function wrapDeny(kind: keyof NetworkDenyStats): AnyFn {
  return (..._args: unknown[]) => deny(kind);
}

const originals = {
  fetch: globalThis.fetch,
  httpRequest: http.request,
  httpGet: http.get,
  httpsRequest: https.request,
  httpsGet: https.get,
  netConnect: net.connect,
  netCreateConnection: net.createConnection,
  socketConnect: net.Socket.prototype.connect,
  tlsConnect: tls.connect,
};

/** Clear provider key / proxy slots without reading or printing values. */
export function clearProviderAndProxyEnv(): void {
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.HAMSTER_MODEL_ID;
  delete process.env.HAMSTER_MODEL_PROVIDER;
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  delete process.env.ALL_PROXY;
  delete process.env.http_proxy;
  delete process.env.https_proxy;
  delete process.env.all_proxy;
  delete process.env.NO_PROXY;
  delete process.env.no_proxy;
}

/**
 * Install deny hooks on shared builtin exports. Safe to call once; subsequent
 * calls are no-ops so preload + per-file imports can coexist.
 */
export function installNetworkDenyHarness(): void {
  if (installed) return;
  installed = true;

  clearProviderAndProxyEnv();

  globalThis.fetch = ((..._args: unknown[]) => deny("fetch")) as typeof globalThis.fetch;

  http.request = wrapDeny("httpRequest") as typeof http.request;
  http.get = wrapDeny("httpGet") as typeof http.get;
  https.request = wrapDeny("httpsRequest") as typeof https.request;
  https.get = wrapDeny("httpsGet") as typeof https.get;
  net.connect = wrapDeny("netConnect") as typeof net.connect;
  net.createConnection = wrapDeny("netCreateConnection") as typeof net.createConnection;
  net.Socket.prototype.connect = wrapDeny("socketConnect") as typeof net.Socket.prototype.connect;
  tls.connect = wrapDeny("tlsConnect") as typeof tls.connect;

  (globalThis as Record<string, unknown>)[NETWORK_DENY_GLOBAL_FLAG] = {
    installed: true,
    installedAt: "testSupport/networkDeny.harness",
  };
}

export function isNetworkDenyHarnessInstalled(): boolean {
  const flag = (globalThis as Record<string, unknown>)[NETWORK_DENY_GLOBAL_FLAG] as
    | { installed?: boolean }
    | undefined;
  return installed === true && flag?.installed === true;
}

export function getNetworkDenyStats(): Readonly<NetworkDenyStats> {
  return { ...stats };
}

export function resetNetworkDenyStats(): void {
  for (const key of Object.keys(stats) as (keyof NetworkDenyStats)[]) {
    stats[key] = 0;
  }
}

/** Restore originals (optional; most suites keep deny for process lifetime). */
export function uninstallNetworkDenyHarness(): void {
  if (!installed) return;
  globalThis.fetch = originals.fetch;
  http.request = originals.httpRequest;
  http.get = originals.httpGet;
  https.request = originals.httpsRequest;
  https.get = originals.httpsGet;
  net.connect = originals.netConnect;
  net.createConnection = originals.netCreateConnection;
  net.Socket.prototype.connect = originals.socketConnect;
  tls.connect = originals.tlsConnect;
  delete (globalThis as Record<string, unknown>)[NETWORK_DENY_GLOBAL_FLAG];
  installed = false;
}

// Auto-install on import (preload and leading static imports).
installNetworkDenyHarness();
