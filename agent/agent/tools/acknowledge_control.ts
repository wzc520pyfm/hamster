import { defineTool } from "eve/tools";
import { z } from "zod";
import { internalCall, policyCheck } from "../../lib/internal.js";

export default defineTool({
  description:
    "Mark a steering control (controlSeq) as applied for a task. Call only after the task has actually absorbed the instruction.",
  inputSchema: z.object({
    taskId: z.string().min(1),
    controlSeq: z.number().int().positive(),
  }),
  async execute(input) {
    const decision = await policyCheck(input.taskId, "acknowledge_control", {
      controlSeq: input.controlSeq,
    });
    if (!decision.allow) {
      throw new Error(`Control plane denied acknowledge_control: ${decision.reason ?? "denied"}`);
    }
    return internalCall(`/internal/controls/${encodeURIComponent(input.taskId)}/${input.controlSeq}/applied`, {});
  },
});
