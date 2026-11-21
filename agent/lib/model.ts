// Hamster P0 direct vendor model resolver.
//
// Pure planning logic for which language model the agent should use. No eve
// imports here on purpose: this module is unit-testable without keys, without a
// live model, and without booting the agent.
//
// Contract (P0 hard constraint: no Vercel hosted service / AI Gateway):
// - HAMSTER_MODEL_ID empty -> fixture plan (eve mockModel / scriptedRespond).
// - HAMSTER_MODEL_ID set -> live plan via the direct vendor provider helpers
//   (`anthropic()` / `openai()` from `eve/models/*`, or the DeepSeek factory in
//   `agent/lib/deepseek.ts`), which bypass the AI Gateway. The model id must be a
//   NATIVE provider model id (e.g. "claude-sonnet-5", "deepseek-chat").
//   Model-id availability is unverified; a recent live check used deepseek-chat
//   successfully; deepseek-flash was not tested. No id is treated as officially recommended.
// - No provider determinable -> explicit error. Never silently fall back to the
//   Vercel AI Gateway.

export type HamsterLiveProvider = "anthropic" | "openai" | "deepseek";

export type HamsterModelPlan =
  | { readonly kind: "fixture" }
  | { readonly kind: "live"; readonly provider: HamsterLiveProvider; readonly modelId: string }
  | { readonly kind: "error"; readonly message: string };

export interface HamsterModelEnvInput {
  readonly modelId?: string | null;
  readonly provider?: string | null;
  readonly anthropicApiKey?: string | null;
  readonly openaiApiKey?: string | null;
  readonly deepseekApiKey?: string | null;
}

const FIXTURE_PLAN: HamsterModelPlan = { kind: "fixture" };

function trimmed(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Strips a legacy `anthropic/`, `openai/`, or `deepseek/` prefix from a model id and
 * returns the native id. Returns null when nothing usable remains or when a further "/"
 * remains in the value (provider-qualified ids beyond the single prefix are invalid native ids
 * for this path).
 */
function stripProviderPrefix(modelId: string): string | null {
  const native = modelId
    .replace(/^anthropic\//i, "")
    .replace(/^openai\//i, "")
    .replace(/^deepseek\//i, "")
    .trim();
  if (!native || native.includes("/")) return null;
  return native;
}

function resolveLiveProvider(env: HamsterModelEnvInput): HamsterLiveProvider | null {
  const requested = trimmed(env.provider).toLowerCase();
  if (requested) {
    if (requested !== "anthropic" && requested !== "openai" && requested !== "deepseek") return null;
    return requested;
  }
  const anthropicKey = trimmed(env.anthropicApiKey);
  const openaiKey = trimmed(env.openaiApiKey);
  const deepseekKey = trimmed(env.deepseekApiKey);
  if (anthropicKey) return "anthropic";
  if (openaiKey) return "openai";
  if (deepseekKey) return "deepseek";
  return null;
}

export function planHamsterModel(env: HamsterModelEnvInput): HamsterModelPlan {
  const modelId = trimmed(env.modelId);
  if (!modelId) return FIXTURE_PLAN;

  const nativeModelId = stripProviderPrefix(modelId);
  if (nativeModelId === null) {
    return {
      kind: "error",
      message:
        `HAMSTER_MODEL_ID "${modelId}" is not a valid native model id. ` +
        "Use a bare provider model id without a provider prefix or further slashes, e.g. \"claude-sonnet-5\".",
    };
  }

  const provider = resolveLiveProvider(env);
  if (provider === null) {
    const requested = trimmed(env.provider);
    if (requested) {
      return {
        kind: "error",
        message: `HAMSTER_MODEL_PROVIDER "${requested}" is not supported. Set HAMSTER_MODEL_PROVIDER to "anthropic", "openai", or "deepseek".`,
      };
    }
    return {
      kind: "error",
      message:
        `HAMSTER_MODEL_ID "${modelId}" is set but no model provider could be determined. ` +
        'Set HAMSTER_MODEL_PROVIDER to "anthropic", "openai", or "deepseek", or configure the matching provider key (ANTHROPIC_API_KEY, OPENAI_API_KEY, or DEEPSEEK_API_KEY). ' +
        "Refusing to fall back to the Vercel AI Gateway.",
    };
  }

  return { kind: "live", provider, modelId: nativeModelId };
}
