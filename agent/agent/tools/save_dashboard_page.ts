import { defineTool } from "eve/tools";
import { z } from "zod";
import { internalCall, policyCheck } from "../../lib/internal.js";

export default defineTool({
  description:
    "Persist the task's dashboard as a fixed OpenUI page with a stable assetId. Idempotent per (taskId, title): calling again returns the same assetId.",
  inputSchema: z.object({
    taskId: z.string().min(1),
    title: z.string().min(1).max(200),
  }),
  async execute(input) {
    const decision = await policyCheck(input.taskId, "save_dashboard_page", { title: input.title });
    if (!decision.allow) {
      throw new Error(`Control plane denied save_dashboard_page: ${decision.reason ?? "denied"}`);
    }
    return internalCall("/internal/assets", { taskId: input.taskId, title: input.title });
  },
});
