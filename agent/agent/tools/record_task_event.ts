import { defineTool } from "eve/tools";
import { z } from "zod";
import { internalCall, policyCheck } from "../../lib/internal.js";

const STEP_DELAY_MS = Number(process.env.HAMSTER_STEP_DELAY_MS ?? "5000");

export default defineTool({
  description:
    "Record one durable checkpoint for a long-running Hamster task. Progress asked later reads these persisted events.",
  inputSchema: z.object({
    taskId: z.string().min(1),
    kind: z.enum(["checkpoint", "note", "failure"]).default("checkpoint"),
    step: z.number().int().positive().optional(),
    total: z.number().int().positive().optional(),
    message: z.string().min(1).max(500),
  }),
  async execute(input) {
    const decision = await policyCheck(input.taskId, "record_task_event", {
      kind: input.kind,
      step: input.step ?? null,
    });
    if (!decision.allow) {
      throw new Error(`Control plane denied record_task_event: ${decision.reason ?? "denied"}`);
    }
    // Simulate durable work for checkpoints only. Failures must land immediately
    // so the Task card can show Failed with the reason.
    if (input.kind !== "failure" && STEP_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, STEP_DELAY_MS));
    }
    return internalCall("/internal/events", {
      taskId: input.taskId,
      kind: input.kind,
      step: input.step ?? null,
      total: input.total ?? null,
      message: input.message,
    });
  },
});
