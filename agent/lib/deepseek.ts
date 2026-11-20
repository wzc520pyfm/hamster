// Hamster P1 direct DeepSeek model factory.
//
// Builds the live language model for the DeepSeek vendor path. It talks to the
// OFFICIAL DeepSeek OpenAI-compatible endpoint directly:
//   - base URL: https://api.deepseek.com
//   - chat completions path (official first-call shape): POST https://api.deepseek.com/chat/completions
//   - auth: DeepSeek API key only (sent as `Authorization: Bearer <key>`).
//
// It is deliberately NOT built through eve's `openai()` helper from
// `eve/models/openai`: that helper resolves its credential from the OpenAI
// fields (`OPENAI_API_KEY`) via eve's OpenAI direct transport and labels the
// provider as `openai`, which would mislabel the DeepSeek path (or borrow the
// wrong credential). This factory uses `createOpenAI` from `@ai-sdk/openai` as a
// direct dependency of the agent and points it at the DeepSeek host with the
// provider name `deepseek`, so the model is labeled for DeepSeek, never OpenAI.
//
// No Vercel Gateway / AI Gateway configuration lives here.

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV4 } from "@ai-sdk/provider";

/** Provider id used by the Hamster planner / live selection for DeepSeek. */
export const DEEPSEEK_PROVIDER_ID = "deepseek";

/** Official DeepSeek OpenAI-compatible base URL (no `/v1` needed; SDK appends the path). */
export const DEEPSEEK_OFFICIAL_BASE_URL = "https://api.deepseek.com";

/**
 * Default native DeepSeek model id when the planner omits one.
 * Matches the id used in a recent live check that succeeded (deepseek-chat).
 * deepseek-flash was not tested in that check. This is not an official recommendation
 * and does not claim any model id is retired or current.
 */
export const DEFAULT_DEEPSEEK_MODEL_ID = "deepseek-chat";

export interface DeepSeekModelInput {
  /** DeepSeek API key. Only this credential is ever read for the DeepSeek path. */
  readonly apiKey?: string | null;
  /** Native DeepSeek model id (e.g. "deepseek-chat"). Defaults to DEFAULT_DEEPSEEK_MODEL_ID. */
  readonly modelId?: string | null;
}

function trimmed(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Creates a DeepSeek live language model via the official OpenAI-compatible
 * endpoint, preferring the documented Chat Completions path
 * (`POST https://api.deepseek.com/chat/completions`).
 *
 * Fails clearly when no DeepSeek key is supplied; it never falls back to a
 * borrowed key or to the OpenAI/Anthropic fields.
 */
export function createDeepSeekModel(input: DeepSeekModelInput): LanguageModelV4 {
  const apiKey = trimmed(input.apiKey);
  if (!apiKey) {
    throw new Error(
      "DeepSeek live model selected but the DEEPSEEK_API_KEY is not set. " +
        "Set DEEPSEEK_API_KEY in the agent environment and retry. DeepSeek keys must not be written into OPENAI_API_KEY or ANTHROPIC_API_KEY. No /login fallback or borrowed key is used on the DeepSeek path.",
    );
  }

  const modelId = trimmed(input.modelId) || DEFAULT_DEEPSEEK_MODEL_ID;
  const deepseekProvider = createOpenAI({
    apiKey,
    baseURL: DEEPSEEK_OFFICIAL_BASE_URL,
    name: DEEPSEEK_PROVIDER_ID,
  });
  const model = deepseekProvider.chat(modelId);
  if (model.modelId !== modelId) {
    throw new Error(`DeepSeek model id mismatch: expected "${modelId}", got "${model.modelId}".`);
  }
  return model;
}
