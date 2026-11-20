import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { internalCall, policyCheck } from "../../lib/internal.js";

export default defineTool({
  description:
    "HIGH-RISK. Publish the task's dashboard asset to the shared workspace. Requires human approval for this exact action and these exact parameters. The ticket is bound to the task's execution target (targetId).",
  inputSchema: z.object({
    taskId: z.string().min(1),
    assetId: z.string().min(1),
    channel: z.string().min(1).max(200),
    targetId: z.string().min(1),
  }),
  // eve gate: the call pauses for a human. This is the inner gate; the outer gate
  // is the control plane policy check below, which requires an approved, unconsumed,
  // unexpired ticket bound to these exact parameters and to the task's execution target.
  approval: always(),
  async execute(input) {
    // Params must match the approval ticket bound to this exact call input
    // (including taskId + execution targetId), or the control plane returns no_valid_ticket.
    const decision = await policyCheck(input.taskId, "publish_dashboard", {
      taskId: input.taskId,
      assetId: input.assetId,
      channel: input.channel,
      targetId: input.targetId,
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
