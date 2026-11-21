// Hamster production-shared live model selection.
//
// Extracted so offline behavioral tests can EXECUTE the same selection logic the
// agent wires, without importing agent/agent/agent.ts (that module calls
// defineAgent(...) at load time — a real side effect / SEAM_BLOCKER).
//
// DeepSeek always goes through createDeepSeekModel (never eve openai()).
// Anthropic/OpenAI go through the vendor helpers; tests may stub only those
// external boundaries via the optional `vendors` argument. Production callers
// omit `vendors` and use the default eve helpers.

import { anthropic } from "eve/models/anthropic";
import { openai } from "eve/models/openai";
// Local .ts extensions: tsconfig allowImportingTsExtensions + node --test strip-types.
import { createDeepSeekModel } from "./deepseek.ts";
import type { HamsterLiveProvider, HamsterModelPlan } from "./model.ts";

export type VendorModelFns = {
  readonly anthropic: (modelId: string) => unknown;
  readonly openai: (modelId: string) => unknown;
};

const defaultVendors: VendorModelFns = {
  anthropic: anthropic as VendorModelFns["anthropic"],
  openai: openai as VendorModelFns["openai"],
};

export type LiveModelSelection = {
  readonly model: { readonly modelId: string; readonly provider: string; readonly [key: string]: unknown };
  readonly reasoning: "low";
};

/**
 * Production live-path selector. DeepSeek uses createDeepSeekModel + DeepSeek key
 * only; missing key throws DEEPSEEK_API_KEY and never falls back to openai().
 */
export function liveSelection(
  provider: HamsterLiveProvider,
  modelId: string,
  deepseekApiKey: string | null,
  vendors: VendorModelFns = defaultVendors,
): LiveModelSelection {
  if (provider === "deepseek") {
    // DeepSeek path: official OpenAI-compatible endpoint, DeepSeek key only, provider
    // labeled "deepseek". Never routed through eve's `openai()` helper (that would mislabel
    // the provider as openai / read OPENAI_API_KEY).
    const model = createDeepSeekModel({ apiKey: deepseekApiKey, modelId });
    return { model: model as LiveModelSelection["model"], reasoning: "low" as const };
  }
  const model = provider === "anthropic" ? vendors.anthropic(modelId) : vendors.openai(modelId);
  return { model: model as LiveModelSelection["model"], reasoning: "low" as const };
}

/**
 * Plan-driven selection used by the agent. Fixture plans invoke the caller's
 * fixture factory; live DeepSeek plans pass the DeepSeek key only when provider
 * is deepseek (never borrow for anthropic/openai).
 */
export function selectAgentModelFromPlan<TFixture>(
  plan: HamsterModelPlan,
  deepseekApiKey: string | null,
  fixtureSelection: () => TFixture,
  vendors: VendorModelFns = defaultVendors,
): TFixture | LiveModelSelection {
  if (plan.kind === "fixture") {
    return fixtureSelection();
  }
  if (plan.kind === "live") {
    const keyForLive = plan.provider === "deepseek" ? deepseekApiKey : null;
    return liveSelection(plan.provider, plan.modelId, keyForLive, vendors);
  }
  throw new Error(plan.message);
}
