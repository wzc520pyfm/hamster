import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDeepSeekModel } from "./deepseek.ts";

/** Deny any accidental real provider network during offline unit tests. */
const originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async () => {
    throw new Error("NETWORK_DENIED: agent-deepseek-branch tests must not call providers");
  };
});
after(() => {
  globalThis.fetch = originalFetch;
});

const agentSrcPath = join(dirname(fileURLToPath(import.meta.url)), "../agent/agent.ts");

test("agent.ts DeepSeek liveSelection branch calls createDeepSeekModel and never openai()", () => {
  const src = readFileSync(agentSrcPath, "utf8");
  assert.match(src, /import \{ createDeepSeekModel \} from "\.\.\/lib\/deepseek\.js"/);
  assert.match(src, /deepseekApiKey:\s*process\.env\.DEEPSEEK_API_KEY/);

  const liveMatch = src.match(/function liveSelection\([\s\S]*?\n\}/);
  assert.ok(liveMatch, "liveSelection function must exist");
  const liveBody = liveMatch[0];

  assert.match(liveBody, /if \(provider === "deepseek"\)/);
  assert.match(liveBody, /createDeepSeekModel\(\{ apiKey: deepseekApiKey, modelId \}\)/);

  const dsBlock = liveBody.match(/if \(provider === "deepseek"\) \{([\s\S]*?)\n  \}/);
  assert.ok(dsBlock, "deepseek if-block must exist");
  // Call sites only — comments may mention openai()/anthropic() by name.
  assert.ok(!dsBlock[1].includes("openai(modelId)"), "DeepSeek branch must never call openai(modelId)");
  assert.ok(!dsBlock[1].includes("anthropic(modelId)"), "DeepSeek branch must never call anthropic(modelId)");
  assert.ok(dsBlock[1].includes("createDeepSeekModel"), "DeepSeek branch must use createDeepSeekModel");
  assert.ok(dsBlock[1].includes("return { model, reasoning"), "DeepSeek branch must return before openai fallback");

  // openai(modelId) remains only for the non-deepseek fallback path after the deepseek return.
  const afterDeepseek = liveBody.slice(liveBody.indexOf('if (provider === "deepseek")'));
  const openaiAt = afterDeepseek.indexOf("openai(modelId)");
  const createAt = afterDeepseek.indexOf("createDeepSeekModel");
  const returnAt = afterDeepseek.indexOf("return { model, reasoning");
  assert.ok(createAt >= 0 && returnAt > createAt && openaiAt > returnAt, "createDeepSeekModel must return before openai() fallback");
});

test("DeepSeek liveSelection equivalent: placeholder key builds deepseek model without openai()", () => {
  // Mirrors agent.ts liveSelection deepseek branch; proves implementation path, not rejection-only.
  const model = createDeepSeekModel({ apiKey: "sk-deepseek-placeholder", modelId: "deepseek-chat" });
  assert.equal(model.modelId, "deepseek-chat");
  assert.ok(model.provider.startsWith("deepseek"));
  assert.ok(!model.provider.startsWith("openai"));
});

test("DeepSeek liveSelection equivalent: missing key throws DEEPSEEK_API_KEY (OpenAI key alone insufficient)", () => {
  assert.throws(
    () => createDeepSeekModel({ apiKey: null, modelId: "deepseek-chat" }),
    /DEEPSEEK_API_KEY/,
  );
});
