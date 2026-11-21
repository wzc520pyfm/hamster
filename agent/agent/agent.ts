import { defineAgent } from "eve";
import { mockModel } from "eve/evals";
import { anthropic } from "eve/models/anthropic";
import { openai } from "eve/models/openai";
import { createDeepSeekModel } from "../lib/deepseek.js";
import { planHamsterModel, type HamsterLiveProvider } from "../lib/model.js";

// Hamster P0 agent.
//
// Model selection:
// - Default: eve's deterministic fixture model (mockModel) with the script below.
//   There is NO model provider key in the environment, and P0 must not fake results.
//   The fixture replays a fixed, honest tool sequence for worker sessions and returns
//   plainly-labeled templated text for chat. It never invents task progress or approvals.
// - With HAMSTER_MODEL_ID set, the resolver plans a DIRECT provider model and the agent
//   passes that model instance into defineAgent via the official direct helper for the chosen
//   provider (`anthropic` from "eve/models/anthropic", `openai` from "eve/models/openai"),
//   or the DeepSeek factory from "lib/deepseek.ts" for the DeepSeek vendor path.
//   The instance goes provider-direct (no Vercel AI Gateway). HAMSTER_MODEL_ID is a NATIVE
//   model id (e.g. "claude-sonnet-5", "deepseek-chat"); provider-qualified strings such as
//   "anthropic/claude-…" are stripped to the native id, and documentation shows native ids only.
// - With HAMSTER_MODEL_ID set but no provider determinable, the agent fails clearly and
//   explicitly instead of silently falling back to the AI Gateway.
const agentModelPlan = planHamsterModel({
  modelId: process.env.HAMSTER_MODEL_ID,
  provider: process.env.HAMSTER_MODEL_PROVIDER,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
});

const FIXTURE_MODEL_ID = "hamster-scripted";
const FIXTURE_PROVIDER = "hamster-fixture";

function fixtureSelection() {
  return {
    model: mockModel({
      modelId: FIXTURE_MODEL_ID,
      provider: FIXTURE_PROVIDER,
      respond: (request) => scriptedRespond(request as unknown as ScriptedRequest),
    }),
    reasoning: "low" as const,
  };
}

function liveSelection(provider: HamsterLiveProvider, modelId: string, deepseekApiKey: string | null) {
  if (provider === "deepseek") {
    // DeepSeek path: official OpenAI-compatible endpoint, DeepSeek key only, provider
    // labeled "deepseek". Never routed through eve's `openai()` helper (that would mislabel
    // the provider as openai / read OPENAI_API_KEY).
    const model = createDeepSeekModel({ apiKey: deepseekApiKey, modelId });
    return { model, reasoning: "low" as const };
  }
  const model = provider === "anthropic" ? anthropic(modelId) : openai(modelId);
  return { model, reasoning: "low" as const };
}

function agentModelSelection() {
  if (agentModelPlan.kind === "fixture") {
    return fixtureSelection();
  }
  if (agentModelPlan.kind === "live") {
    const deepseekApiKey = agentModelPlan.provider === "deepseek" ? process.env.DEEPSEEK_API_KEY ?? null : null;
    return liveSelection(agentModelPlan.provider, agentModelPlan.modelId, deepseekApiKey);
  }
  throw new Error(agentModelPlan.message);
}

interface ToolResultLike {
  name: string;
  isError: boolean;
  output?: unknown;
}

interface ScriptedRequest {
  lastUserMessage: string | null;
  messages: Array<{ role: string; text: string }>;
  toolResults: ToolResultLike[];
}

function parseOutput(output: unknown): Record<string, unknown> | null {
  if (output == null) return null;
  if (typeof output === "object") {
    const value = (output as { value?: unknown }).value ?? output;
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
    return null;
  }
  if (typeof output === "string") {
    try {
      return JSON.parse(output) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

const CHECKPOINT_NOTES = [
  "Collected weekly metrics from the metrics_weekly named query",
  "Analyzed week-over-week deltas and flagged exceptions",
  "Composed the OpenUI dashboard page (layout v1, stable assetId)",
];

function scriptedRespond(request: ScriptedRequest) {
  const { lastUserMessage, messages, toolResults } = request;
  const userMessages = messages.filter((m) => m.role === "user").map((m) => m.text);
  const isWorker =
    userMessages.some((m) => m.startsWith("[hamster-worker") || m.startsWith("[hamster-control"));

  const text = lastUserMessage ?? "";

  // Control receipts: acknowledge a steer exactly once per controlSeq, then
  // continue the worker loop when this is a worker session (steer must not
  // terminate the independent task).
  const steer = text.match(/CONTROL-STEER taskId=\S+ controlSeq=(\d+)/);
  if (steer) {
    const controlSeq = Number(steer[1]);
    const taskMatch = text.match(/taskId=(\S+)/);
    const taskId = taskMatch?.[1] ?? "";
    const already = toolResults.some(
      (r) => r.name === "acknowledge_control" && parseOutput(r.output)?.controlSeq === controlSeq,
    );
    if (!already) {
      return { toolCalls: [{ name: "acknowledge_control", input: { taskId, controlSeq } }] };
    }
    if (!isWorker) {
      return { text: `Steer #${controlSeq} applied for task ${taskId}.` };
    }
    // Fall through to resume worker checkpoints after the receipt is Applied.
  }

  if (/CONTROL-CANCEL/.test(text)) {
    return { text: "Cancel acknowledged. No new tool calls will run for this task." };
  }

  if (!isWorker) {
    return {
      text:
        `(Scripted demo model — no model provider key is configured.) You said: "${text}". ` +
        "The Hamster control plane is live; the model layer is running eve's deterministic fixture model. " +
        "Set HAMSTER_MODEL_ID (and provider credentials) to use a real model. Task progress questions typed " +
        "as “progress” are answered by the control plane from persisted state, not by a model.",
    };
  }

  const taskMatch = userMessages
    .find((m) => m.startsWith("[hamster-worker"))
    ?.match(/taskId=(\S+)/);
  const taskId = taskMatch?.[1] ?? "";
  const titleMatch = userMessages
    .find((m) => m.startsWith("[hamster-worker"))
    ?.match(/title=([^\]]+)/);
  const title = (titleMatch?.[1] ?? "Weekly metrics dashboard").trim();

  const errored = toolResults.find((r) => r.isError);
  if (errored) {
    const failureReason =
      errored.name === "publish_dashboard"
        ? `Publishing the dashboard for “${title}” was not approved or was denied, so it did not run.`
        : `“${title}” failed while running ${errored.name.replaceAll("_", " ")}.`;
    const erroredIndex = toolResults.indexOf(errored);
    const failureRecorded = toolResults.some(
      (r, idx) =>
        idx > erroredIndex && r.name === "record_task_event" && !r.isError,
    );
    if (!failureRecorded) {
      return {
        toolCalls: [
          {
            name: "record_task_event",
            input: {
              taskId,
              kind: "failure",
              message: failureReason,
            },
          },
        ],
      };
    }
    // Name the task in chat so a Failed card is never confused with a still-Running sibling.
    return {
      text: `Failed: “${title}” (${taskId}) — ${failureReason}`,
    };
  }

  const count = (name: string) => toolResults.filter((r) => r.name === name).length;
  const saveResult = toolResults.find((r) => r.name === "save_dashboard_page");
  const publishResult = toolResults.find((r) => r.name === "publish_dashboard");

  if (publishResult) {
    const assetId = parseOutput(saveResult?.output)?.assetId ?? "unknown";
    return {
      text: `Task complete. Dashboard ${String(assetId)} saved and publish step settled (approved and ran, or denied).`,
    };
  }
  if (saveResult) {
    const assetId = parseOutput(saveResult.output)?.assetId;
    if (!assetId) {
      return {
        text: "Task failed: save_dashboard_page returned no assetId. This should not happen; check the control plane logs.",
      };
    }
    return {
      toolCalls: [
        {
          name: "publish_dashboard",
          input: { taskId, assetId: String(assetId), channel: "shared workspace" },
        },
      ],
    };
  }
  const recorded = count("record_task_event");
  if (recorded >= 3) {
    return { toolCalls: [{ name: "save_dashboard_page", input: { taskId, title } }] };
  }
  const step = recorded + 1;
  return {
    toolCalls: [
      {
        name: "record_task_event",
        input: {
          taskId,
          kind: "checkpoint",
          step,
          total: 3,
          message: CHECKPOINT_NOTES[step - 1] ?? `Checkpoint ${step}`,
        },
      },
    ],
  };
}

export default defineAgent(agentModelSelection());
