import { test } from "node:test";
import assert from "node:assert/strict";
import { planHamsterModel } from "./model.ts";

test("empty HAMSTER_MODEL_ID resolves to the fixture plan", () => {
  const plan = planHamsterModel({ modelId: "", provider: "", anthropicApiKey: "", openaiApiKey: "" });
  assert.deepEqual(plan, { kind: "fixture" });
});

test("empty/absent HAMSTER_MODEL_ID resolves to the fixture plan (default env)", () => {
  const plan = planHamsterModel({ modelId: null, provider: null, anthropicApiKey: null, openaiApiKey: null });
  assert.deepEqual(plan, { kind: "fixture" });
});

test("set HAMSTER_MODEL_ID with no provider and no keys fails clearly (no Gateway fallback)", () => {
  const plan = planHamsterModel({ modelId: "claude-sonnet-5", provider: "", anthropicApiKey: "", openaiApiKey: "" });
  assert.equal(plan.kind, "error");
  if (plan.kind === "error") {
    assert.match(plan.message, /no model provider could be determined/);
    assert.match(plan.message, /HAMSTER_MODEL_PROVIDER/);
    assert.match(plan.message, /DEEPSEEK_API_KEY/);
    assert.match(plan.message, /Vercel AI Gateway/);
  } else {
    assert.fail("expected error plan");
  }
});

test("provider unset + ANTHROPIC_API_KEY set selects the anthropic live plan with native id", () => {
  const plan = planHamsterModel({
    modelId: "claude-sonnet-5",
    provider: "",
    anthropicApiKey: "sk-ant-placeholder",
    openaiApiKey: "",
  });
  assert.deepEqual(plan, { kind: "live", provider: "anthropic", modelId: "claude-sonnet-5" });
});

test("provider unset + only OPENAI_API_KEY set selects the openai live plan with native id", () => {
  const plan = planHamsterModel({
    modelId: "gpt-5.6-sol",
    provider: "",
    anthropicApiKey: "",
    openaiApiKey: "sk-openai-placeholder",
  });
  assert.deepEqual(plan, { kind: "live", provider: "openai", modelId: "gpt-5.6-sol" });
});

test("explicit HAMSTER_MODEL_PROVIDER=anthropic selects the anthropic live plan", () => {
  const plan = planHamsterModel({
    modelId: "claude-sonnet-5",
    provider: "anthropic",
    anthropicApiKey: "",
    openaiApiKey: "",
  });
  assert.deepEqual(plan, { kind: "live", provider: "anthropic", modelId: "claude-sonnet-5" });
});

test("explicit HAMSTER_MODEL_PROVIDER=openai selects the openai live plan", () => {
  const plan = planHamsterModel({
    modelId: "gpt-5.6-sol",
    provider: "openai",
    anthropicApiKey: "sk-ant-placeholder",
    openaiApiKey: "sk-openai-placeholder",
  });
  assert.deepEqual(plan, { kind: "live", provider: "openai", modelId: "gpt-5.6-sol" });
});

test("HAMSTER_MODEL_ID with an anthropic/ prefix strips to the native model id", () => {
  const plan = planHamsterModel({
    modelId: "anthropic/claude-sonnet-5",
    provider: "anthropic",
    anthropicApiKey: "sk-ant-placeholder",
    openaiApiKey: "",
  });
  assert.deepEqual(plan, { kind: "live", provider: "anthropic", modelId: "claude-sonnet-5" });
});

test("HAMSTER_MODEL_ID with an openai/ prefix strips to the native model id", () => {
  const plan = planHamsterModel({
    modelId: "openai/gpt-5.6-sol",
    provider: "openai",
    anthropicApiKey: "",
    openaiApiKey: "sk-openai-placeholder",
  });
  assert.deepEqual(plan, { kind: "live", provider: "openai", modelId: "gpt-5.6-sol" });
});

test("provider-qualified or slash-containing model ids are rejected as invalid native ids", () => {
  const plan = planHamsterModel({ modelId: "anthropic/claude/sonnet-5", provider: "anthropic", anthropicApiKey: "sk-ant-placeholder", openaiApiKey: "" });
  assert.equal(plan.kind, "error");
});

test("unsupported HAMSTER_MODEL_PROVIDER fails clearly instead of guessing", () => {
  const plan = planHamsterModel({ modelId: "claude-sonnet-5", provider: "google", anthropicApiKey: "sk-ant-placeholder", openaiApiKey: "" });
  assert.equal(plan.kind, "error");
  if (plan.kind === "error") assert.match(plan.message, /not supported/);
});

test("explicit HAMSTER_MODEL_PROVIDER=deepseek selects the deepseek live plan with native id", () => {
  const plan = planHamsterModel({
    modelId: "deepseek-chat",
    provider: "deepseek",
    anthropicApiKey: "",
    openaiApiKey: "",
    deepseekApiKey: "sk-deepseek-placeholder",
  });
  assert.deepEqual(plan, { kind: "live", provider: "deepseek", modelId: "deepseek-chat" });
});

test("provider unset + only DEEPSEEK_API_KEY set selects the deepseek live plan with native id", () => {
  const plan = planHamsterModel({
    modelId: "deepseek-chat",
    provider: "",
    anthropicApiKey: "",
    openaiApiKey: "",
    deepseekApiKey: "sk-deepseek-placeholder",
  });
  assert.deepEqual(plan, { kind: "live", provider: "deepseek", modelId: "deepseek-chat" });
});

test("HAMSTER_MODEL_ID with a deepseek/ prefix strips to the native model id", () => {
  const plan = planHamsterModel({
    modelId: "deepseek/deepseek-chat",
    provider: "deepseek",
    anthropicApiKey: "",
    openaiApiKey: "",
    deepseekApiKey: "sk-deepseek-placeholder",
  });
  assert.deepEqual(plan, { kind: "live", provider: "deepseek", modelId: "deepseek-chat" });
});

test("unsupported HAMSTER_MODEL_PROVIDER error lists deepseek as supported", () => {
  const plan = planHamsterModel({ modelId: "claude-sonnet-5", provider: "google", anthropicApiKey: "sk-ant-placeholder", openaiApiKey: "" });
  assert.equal(plan.kind, "error");
  if (plan.kind === "error") {
    assert.match(plan.message, /not supported/);
    assert.match(plan.message, /deepseek/);
    assert.match(plan.message, /anthropic/);
    assert.match(plan.message, /openai/);
  } else {
    assert.fail("expected error plan");
  }
});

test("empty HAMSTER_MODEL_ID still resolves to the fixture plan even with a DeepSeek key present", () => {
  const plan = planHamsterModel({
    modelId: "",
    provider: "deepseek",
    anthropicApiKey: "",
    openaiApiKey: "",
    deepseekApiKey: "sk-deepseek-placeholder",
  });
  assert.deepEqual(plan, { kind: "fixture" });
});

test("DeepSeek key present does not change an explicit anthropic plan", () => {
  const plan = planHamsterModel({
    modelId: "claude-sonnet-5",
    provider: "anthropic",
    anthropicApiKey: "sk-ant-placeholder",
    openaiApiKey: "",
    deepseekApiKey: "sk-deepseek-placeholder",
  });
  assert.deepEqual(plan, { kind: "live", provider: "anthropic", modelId: "claude-sonnet-5" });
});

test("DeepSeek key present does not change an explicit openai plan", () => {
  const plan = planHamsterModel({
    modelId: "gpt-5.6-sol",
    provider: "openai",
    anthropicApiKey: "",
    openaiApiKey: "sk-openai-placeholder",
    deepseekApiKey: "sk-deepseek-placeholder",
  });
  assert.deepEqual(plan, { kind: "live", provider: "openai", modelId: "gpt-5.6-sol" });
});

test("provider deepseek + placeholder key routes live (not fixture/error)", () => {
  const plan = planHamsterModel({
    modelId: "deepseek-chat",
    provider: "deepseek",
    anthropicApiKey: "",
    openaiApiKey: "sk-openai-placeholder",
    deepseekApiKey: "sk-deepseek-placeholder",
  });
  assert.deepEqual(plan, { kind: "live", provider: "deepseek", modelId: "deepseek-chat" });
});
