import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeepSeekModel, DEEPSEEK_OFFICIAL_BASE_URL, DEFAULT_DEEPSEEK_MODEL_ID } from "./deepseek.ts";

function clearProviderEnv() {
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
}

test("deepseek factory refuses to run without a DEEPSEEK_API_KEY", () => {
  clearProviderEnv();
  assert.throws(
    () => createDeepSeekModel({ apiKey: null, modelId: "deepseek-flash" }),
    /DEEPSEEK_API_KEY/,
  );
  assert.throws(
    () => createDeepSeekModel({ apiKey: "", modelId: "deepseek-flash" }),
    /DEEPSEEK_API_KEY/,
  );
});

test("deepseek factory authenticates with the DEEPSEEK key only and never borrows OPENAI_API_KEY", () => {
  clearProviderEnv();
  // A bogus OPENAI key must not satisfy the DeepSeek path.
  process.env.OPENAI_API_KEY = "sk-openai-bogus";
  delete process.env.DEEPSEEK_API_KEY;
  assert.throws(
    () => createDeepSeekModel({ apiKey: process.env.DEEPSEEK_API_KEY, modelId: "deepseek-flash" }),
    /DEEPSEEK_API_KEY/,
  );
  // With the DeepSeek key present, the DeepSeek model is constructed (no live call made).
  process.env.DEEPSEEK_API_KEY = "sk-deepseek-placeholder";
  const model = createDeepSeekModel({ apiKey: process.env.DEEPSEEK_API_KEY, modelId: "deepseek-flash" });
  assert.equal(model.modelId, "deepseek-flash");
  assert.ok(model.provider.startsWith("deepseek"));
  assert.ok(!model.provider.startsWith("openai"));
});

test("deepseek factory exposes the deepseek provider label and the native model id", () => {
  clearProviderEnv();
  process.env.DEEPSEEK_API_KEY = "sk-deepseek-placeholder";
  const model = createDeepSeekModel({ apiKey: "sk-deepseek-placeholder", modelId: "deepseek-flash" });
  assert.equal(model.modelId, "deepseek-flash");
  assert.equal(model.provider, "deepseek.chat");
});

test("deepseek factory defaults to the recommended deepseek-flash model id", () => {
  clearProviderEnv();
  process.env.DEEPSEEK_API_KEY = "sk-deepseek-placeholder";
  const model = createDeepSeekModel({ apiKey: "sk-deepseek-placeholder" });
  assert.equal(model.modelId, DEFAULT_DEEPSEEK_MODEL_ID);
  assert.equal(DEFAULT_DEEPSEEK_MODEL_ID, "deepseek-flash");
});

test("deepseek factory targets the official DeepSeek OpenAI-compatible endpoint", () => {
  assert.equal(DEEPSEEK_OFFICIAL_BASE_URL, "https://api.deepseek.com");
});
