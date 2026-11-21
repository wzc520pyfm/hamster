import "./testSupport/networkDeny.harness.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDeepSeekModel } from "./deepseek.ts";


const libDir = dirname(fileURLToPath(import.meta.url));
const agentSrcPath = join(libDir, "../agent/agent.ts");
const liveSelectionSrcPath = join(libDir, "liveSelection.ts");

test("agent.ts wires production-shared selectAgentModelFromPlan (no forked selector)", () => {
  const src = readFileSync(agentSrcPath, "utf8");
  assert.match(src, /^import \{ selectAgentModelFromPlan \} from "\.\.\/lib\/liveSelection\.js";$/m);
  assert.match(src, /return selectAgentModelFromPlan\(/);
  assert.match(src, /deepseekApiKey:\s*process\.env\.DEEPSEEK_API_KEY/);
  // Must not keep a private duplicate liveSelection in agent.ts after the seam extract.
  assert.equal(/^function liveSelection\s*\(/m.test(src), false);
  assert.equal(/^import .+ from "eve\/models\/openai";$/m.test(src), false);
  assert.equal(/^import .+ from "\.\.\/lib\/deepseek\.(js|ts)";$/m.test(src), false);
});

test("liveSelection.ts DeepSeek branch calls createDeepSeekModel and never openai(modelId)", () => {
  const src = readFileSync(liveSelectionSrcPath, "utf8");
  assert.match(src, /import \{ createDeepSeekModel \} from "\.\/deepseek\.ts"/);

  const liveMatch = src.match(/export function liveSelection\([\s\S]*?\n\}/);
  assert.ok(liveMatch, "liveSelection function must exist in shared module");
  const liveBody = liveMatch[0];

  assert.match(liveBody, /if \(provider === "deepseek"\)/);
  assert.match(liveBody, /createDeepSeekModel\(\{ apiKey: deepseekApiKey, modelId \}\)/);

  const dsBlock = liveBody.match(/if \(provider === "deepseek"\) \{([\s\S]*?)\n  \}/);
  assert.ok(dsBlock, "deepseek if-block must exist");
  assert.ok(!dsBlock[1].includes("openai(modelId)"), "DeepSeek branch must never call openai(modelId)");
  assert.ok(!dsBlock[1].includes("vendors.openai"), "DeepSeek branch must never call vendors.openai");
  assert.ok(dsBlock[1].includes("createDeepSeekModel"), "DeepSeek branch must use createDeepSeekModel");
});

test("DeepSeek factory: placeholder key builds deepseek model without openai provider label", () => {
  const model = createDeepSeekModel({ apiKey: "sk-deepseek-placeholder", modelId: "deepseek-chat" });
  assert.equal(model.modelId, "deepseek-chat");
  assert.ok(model.provider.startsWith("deepseek"));
  assert.ok(!model.provider.startsWith("openai"));
});

test("DeepSeek factory: missing key throws DEEPSEEK_API_KEY (OpenAI key alone insufficient)", () => {
  assert.throws(
    () => createDeepSeekModel({ apiKey: null, modelId: "deepseek-chat" }),
    /DEEPSEEK_API_KEY/,
  );
});
