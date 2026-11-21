/**
 * Offline behavioral contract for production-shared model selection.
 *
 * Exercises the SAME liveSelection / selectAgentModelFromPlan module that
 * agent/agent/agent.ts wires. Does NOT import agent.ts (module-scope
 * defineAgent is a real side-effect / SEAM_BLOCKER).
 *
 * External vendor boundaries (eve anthropic/openai) are stubbed only.
 * DeepSeek path uses the real createDeepSeekModel factory (no network).
 *
 * Network isolation: import the deny harness FIRST so hooks install before
 * production/provider modules below are evaluated.
 */
import "./testSupport/networkDeny.harness.ts";
import {
  getNetworkDenyStats,
  NETWORK_DENIED_PREFIX,
  resetNetworkDenyStats,
} from "./testSupport/networkDeny.harness.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import httpDefault from "node:http";
import httpsDefault from "node:https";
import netDefault from "node:net";
import * as httpNs from "node:http";
import * as httpsNs from "node:https";
import * as netNs from "node:net";
import { planHamsterModel } from "./model.ts";

const require = createRequire(import.meta.url);
const httpCjs = require("node:http") as typeof httpDefault;
const httpsCjs = require("node:https") as typeof httpsDefault;
const netCjs = require("node:net") as typeof netDefault;
const tlsCjs = require("node:tls") as typeof import("node:tls");
import {
  liveSelection,
  selectAgentModelFromPlan,
  type VendorModelFns,
} from "./liveSelection.ts";

type CallLog = { anthropic: string[]; openai: string[] };

function makeVendorStubs(): { vendors: VendorModelFns; calls: CallLog } {
  const calls: CallLog = { anthropic: [], openai: [] };
  const vendors: VendorModelFns = {
    anthropic: (modelId: string) => {
      calls.anthropic.push(modelId);
      return { provider: "anthropic-stub", modelId };
    },
    openai: (modelId: string) => {
      calls.openai.push(modelId);
      return { provider: "openai-stub", modelId };
    },
  };
  return { vendors, calls };
}

beforeEach(() => {
  // Clear provider key / proxy slots without reading or printing any values.
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
});

test("production liveSelection: DeepSeek + passed key/model builds deepseek-labeled model and never calls openai/anthropic stubs", () => {
  const { vendors, calls } = makeVendorStubs();
  const selection = liveSelection("deepseek", "deepseek-chat", "sk-deepseek-placeholder", vendors);
  assert.equal(selection.reasoning, "low");
  assert.equal(selection.model.modelId, "deepseek-chat");
  assert.ok(String(selection.model.provider).startsWith("deepseek"));
  assert.ok(!String(selection.model.provider).startsWith("openai"));
  assert.deepEqual(calls.openai, []);
  assert.deepEqual(calls.anthropic, []);
});

test("production liveSelection: missing DeepSeek key throws DEEPSEEK_API_KEY and NEVER falls back to openai", () => {
  const { vendors, calls } = makeVendorStubs();
  assert.throws(
    () => liveSelection("deepseek", "deepseek-chat", null, vendors),
    /DEEPSEEK_API_KEY/,
  );
  assert.throws(
    () => liveSelection("deepseek", "deepseek-chat", "", vendors),
    /DEEPSEEK_API_KEY/,
  );
  assert.deepEqual(calls.openai, [], "openai vendor must not be invoked on DeepSeek key failure");
  assert.deepEqual(calls.anthropic, []);
});

test("selectAgentModelFromPlan: empty model id remains fixture (DeepSeek key present does not hijack)", () => {
  const { vendors, calls } = makeVendorStubs();
  const plan = planHamsterModel({
    modelId: "",
    provider: "deepseek",
    anthropicApiKey: "",
    openaiApiKey: "",
    deepseekApiKey: "sk-deepseek-placeholder",
  });
  assert.equal(plan.kind, "fixture");
  let fixtureCalls = 0;
  const selection = selectAgentModelFromPlan(
    plan,
    "sk-deepseek-placeholder",
    () => {
      fixtureCalls += 1;
      return { kind: "fixture-marker", reasoning: "low" as const };
    },
    vendors,
  );
  assert.equal(fixtureCalls, 1);
  assert.deepEqual(selection, { kind: "fixture-marker", reasoning: "low" });
  assert.deepEqual(calls.openai, []);
  assert.deepEqual(calls.anthropic, []);
});

test("selectAgentModelFromPlan: explicit anthropic is not hijacked by DeepSeek key", () => {
  const { vendors, calls } = makeVendorStubs();
  const plan = planHamsterModel({
    modelId: "claude-sonnet-5",
    provider: "anthropic",
    anthropicApiKey: "sk-ant-placeholder",
    openaiApiKey: "",
    deepseekApiKey: "sk-deepseek-placeholder",
  });
  assert.deepEqual(plan, { kind: "live", provider: "anthropic", modelId: "claude-sonnet-5" });
  const selection = selectAgentModelFromPlan(plan, "sk-deepseek-placeholder", () => {
    throw new Error("fixture must not run");
  }, vendors);
  assert.deepEqual(calls.anthropic, ["claude-sonnet-5"]);
  assert.deepEqual(calls.openai, []);
  assert.equal((selection as { model: { provider: string } }).model.provider, "anthropic-stub");
});

test("selectAgentModelFromPlan: explicit openai is not hijacked by DeepSeek key", () => {
  const { vendors, calls } = makeVendorStubs();
  const plan = planHamsterModel({
    modelId: "gpt-5.6-sol",
    provider: "openai",
    anthropicApiKey: "",
    openaiApiKey: "sk-openai-placeholder",
    deepseekApiKey: "sk-deepseek-placeholder",
  });
  assert.deepEqual(plan, { kind: "live", provider: "openai", modelId: "gpt-5.6-sol" });
  const selection = selectAgentModelFromPlan(plan, "sk-deepseek-placeholder", () => {
    throw new Error("fixture must not run");
  }, vendors);
  assert.deepEqual(calls.openai, ["gpt-5.6-sol"]);
  assert.deepEqual(calls.anthropic, []);
  assert.equal((selection as { model: { provider: string } }).model.provider, "openai-stub");
});

test("selectAgentModelFromPlan: DeepSeek live plan + key observes production DeepSeek model; openai never called", () => {
  const { vendors, calls } = makeVendorStubs();
  const plan = planHamsterModel({
    modelId: "deepseek-chat",
    provider: "deepseek",
    anthropicApiKey: "",
    openaiApiKey: "sk-openai-placeholder",
    deepseekApiKey: "sk-deepseek-placeholder",
  });
  assert.deepEqual(plan, { kind: "live", provider: "deepseek", modelId: "deepseek-chat" });
  const selection = selectAgentModelFromPlan(plan, "sk-deepseek-placeholder", () => {
    throw new Error("fixture must not run");
  }, vendors);
  assert.equal(selection.model.modelId, "deepseek-chat");
  assert.ok(String(selection.model.provider).startsWith("deepseek"));
  assert.deepEqual(calls.openai, []);
  assert.deepEqual(calls.anthropic, []);
});

test("selectAgentModelFromPlan: DeepSeek live plan + missing key fails DEEPSEEK_API_KEY; openai never called", () => {
  const { vendors, calls } = makeVendorStubs();
  const plan = planHamsterModel({
    modelId: "deepseek-chat",
    provider: "deepseek",
    anthropicApiKey: "",
    openaiApiKey: "sk-openai-placeholder",
    deepseekApiKey: "",
  });
  assert.equal(plan.kind, "live");
  assert.throws(
    () =>
      selectAgentModelFromPlan(plan, null, () => {
        throw new Error("fixture must not run");
      }, vendors),
    /DEEPSEEK_API_KEY/,
  );
  assert.deepEqual(calls.openai, []);
});

test("network-deny harness: local mocked http/https/fetch/net calls throw NETWORK_DENIED (no endpoint contact)", () => {
  resetNetworkDenyStats();
  const before = getNetworkDenyStats();

  // CJS + default-import aliases (mutable export object patched by harness).
  assert.throws(
    () => httpCjs.request({ host: "127.0.0.1", port: 9, path: "/" }),
    new RegExp(NETWORK_DENIED_PREFIX),
  );
  assert.throws(
    () => httpCjs.get({ host: "127.0.0.1", port: 9, path: "/" }),
    new RegExp(NETWORK_DENIED_PREFIX),
  );
  assert.throws(
    () => httpsCjs.request({ host: "127.0.0.1", port: 9, path: "/" }),
    new RegExp(NETWORK_DENIED_PREFIX),
  );
  assert.throws(
    () => httpsCjs.get({ host: "127.0.0.1", port: 9, path: "/" }),
    new RegExp(NETWORK_DENIED_PREFIX),
  );
  assert.throws(
    () => httpDefault.request({ host: "127.0.0.1", port: 9, path: "/" }),
    new RegExp(NETWORK_DENIED_PREFIX),
  );
  assert.throws(
    () => httpsDefault.get({ host: "127.0.0.1", port: 9, path: "/" }),
    new RegExp(NETWORK_DENIED_PREFIX),
  );
  assert.throws(
    () => netCjs.connect({ host: "127.0.0.1", port: 9 }),
    new RegExp(NETWORK_DENIED_PREFIX),
  );
  assert.throws(
    () => netCjs.createConnection({ host: "127.0.0.1", port: 9 }),
    new RegExp(NETWORK_DENIED_PREFIX),
  );
  assert.throws(
    () => netDefault.connect({ host: "127.0.0.1", port: 9 }),
    new RegExp(NETWORK_DENIED_PREFIX),
  );
  assert.throws(
    () => {
      const socket = new netCjs.Socket();
      socket.connect({ host: "127.0.0.1", port: 9 });
    },
    new RegExp(NETWORK_DENIED_PREFIX),
  );
  assert.throws(
    () => globalThis.fetch("https://example.invalid/offline-deny-sanity"),
    new RegExp(NETWORK_DENIED_PREFIX),
  );

  // ESM namespace facades are read-only: http → net backstop; https → tls.connect backstop.
  assert.throws(
    () => httpNs.request({ host: "127.0.0.1", port: 9, path: "/" }),
    new RegExp(NETWORK_DENIED_PREFIX),
  );
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
  assert.throws(
    () => netNs.connect({ host: "127.0.0.1", port: 9 }),
    new RegExp(NETWORK_DENIED_PREFIX),
  );
  assert.throws(
    () => tlsCjs.connect({ host: "127.0.0.1", port: 9 }),
    new RegExp(NETWORK_DENIED_PREFIX),
  );

  const after = getNetworkDenyStats();
  // Design proof: denied counters advanced — calls throw before contacting endpoints.
  assert.ok(after.httpRequest > before.httpRequest);
  assert.ok(after.httpGet > before.httpGet);
  assert.ok(after.httpsRequest > before.httpsRequest);
  assert.ok(after.httpsGet > before.httpsGet);
  assert.ok(after.netConnect > before.netConnect);
  assert.ok(after.netCreateConnection > before.netCreateConnection);
  assert.ok(after.socketConnect > before.socketConnect);
  assert.ok(after.tlsConnect > before.tlsConnect);
  assert.ok(after.fetch > before.fetch);
});
