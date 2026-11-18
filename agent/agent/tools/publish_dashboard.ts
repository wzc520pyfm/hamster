import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { internalCall, policyCheck } from "../../lib/internal.js";

export default defineTool({
  description:
    "HIGH-RISK. Publish the task's dashboard asset to the shared workspace. Requires human approval for this exact action and these exact parameters.",
  inputSchema: z.object({
    taskId: z.string().min(1),
    assetId: z.string().min(1),
    channel: z.string().min(1).max(200),
  }),
  // eve gate: the call pauses for a human. This is the inner gate; the outer gate
  // is the control plane policy check below, which requires an approved, unconsumed,
  // unexpired ticket bound to these exact parameters.
  approval: always(),
  async execute(input) {
    const decision = await policyCheck(input.taskId, "publish_dashboard", {
      assetId: input.assetId,
      channel: input.channel,
    });
    if (!decision.allow) {
      throw new Error(`Control plane denied publish_dashboard: ${decision.reason ?? "denied"}`);
    }
    return internalCall(`/internal/assets/${encodeURIComponent(input.assetId)}/publish`, {
      taskId: input.taskId,
      channel: input.channel,
    });
  },
});
