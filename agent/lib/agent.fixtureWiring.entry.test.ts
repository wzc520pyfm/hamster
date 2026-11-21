/**
 * Offline production ENTRY fixture-wiring regression.
 *
 * Executes the actual value passed to defineAgent in agent/agent/agent.ts
 * (module-scope `export default defineAgent(agentModelSelection())`) by
 * importing that production module under:
 *   1) official networkDeny.preload (keys/proxies cleared; http/https/fetch/net/tls denied)
 *   2) tests-only authoredTsResolve.preload (.js→.ts remap for authored sources)
 *
 * Does NOT re-call selectAgentModelFromPlan, does NOT supply a test fixture
 * callback, and does NOT use regex-on-source as the pass criterion.
 *
 * Empty HAMSTER_MODEL_ID must yield this file's production fixtureSelection:
 * modelId hamster-scripted, provider hamster-fixture.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

test("production agent.ts entry: empty HAMSTER_MODEL_ID yields fixtureSelection via defineAgent argument", async () => {
  // Preload must already have installed the network-deny guard before this file loaded.
  const flag = (globalThis as Record<string, unknown>).__HAMSTER_NETWORK_DENY_INSTALLED__ as
    | { installed?: boolean }
    | undefined;
  assert.equal(flag?.installed, true, "official network-deny preload must be active");

  // Absence-only checks; do not read or print secret values.
  assert.equal(process.env.HAMSTER_MODEL_ID, undefined);
  assert.equal(process.env.DEEPSEEK_API_KEY, undefined);
  assert.equal(process.env.OPENAI_API_KEY, undefined);
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(process.env.HTTP_PROXY, undefined);
  assert.equal(process.env.HTTPS_PROXY, undefined);

  // Import production entry. Module evaluation runs:
  //   planHamsterModel(env) → fixture
  //   agentModelSelection() → fixtureSelection() → mockModel(...)
  //   defineAgent(selection)  // pure brand; returns same object
  const mod = await import("../agent/agent.ts");
  const passedToDefineAgent = mod.default as {
    reasoning?: string;
    model?: { modelId?: string; provider?: string };
  };

  assert.equal(passedToDefineAgent.reasoning, "low");
  assert.equal(passedToDefineAgent.model?.modelId, "hamster-scripted");
  assert.equal(passedToDefineAgent.model?.provider, "hamster-fixture");
  assert.equal(
    Reflect.get(passedToDefineAgent, Symbol.for("eve.defined-agent")),
    true,
    "defineAgent must have branded the production selection object",
  );
});
