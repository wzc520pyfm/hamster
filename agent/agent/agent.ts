import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

// Hamster P0 agent.
//
// Model selection:
// - Default: eve's deterministic fixture model (mockModel) with the script below.
//   There is NO model provider key in the environment, and P0 must not fake results.
//   The fixture replays a fixed, honest tool sequence for worker sessions and returns
//   plainly-labeled templated text for chat. It never invents task progress or approvals.
// - With HAMSTER_MODEL_ID set (e.g. "anthropic/claude-opus-5.5" through the AI Gateway,
//   or another provider string/instance), that model is used instead. See README.
const modelId = process.env.HAMSTER_MODEL_ID;

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
    return {
      text: `Task halted: tool ${errored.name} reported an error. See the task timeline for details.`,
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

export default defineAgent(
  modelId
    ? {
        model: modelId,
        reasoning: "low",
      }
    : {
        model: mockModel({
          modelId: "hamster-scripted",
          provider: "hamster-fixture",
          respond: (request) => scriptedRespond(request as unknown as ScriptedRequest),
        }),
        reasoning: "low",
      },
);
