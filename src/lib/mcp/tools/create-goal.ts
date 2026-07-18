import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "create_goal",
  title: "Create savings goal",
  description:
    "Create a savings goal or category spending cap for the signed-in user. Amounts in EGP.",
  inputSchema: {
    kind: z.enum(["savings", "category_cap"]),
    target_amount: z.number().min(0).describe("Target amount in EGP."),
    category_id: z
      .string()
      .uuid()
      .optional()
      .describe("Required when kind is category_cap."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  handler: async ({ kind, target_amount, category_id }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    if (kind === "category_cap" && !category_id)
      return {
        content: [{ type: "text", text: "category_id is required for category_cap goals." }],
        isError: true,
      };
    const { data, error } = await supabaseForUser(ctx)
      .from("goals")
      .insert({
        user_id: ctx.getUserId()!,
        kind,
        target_amount,
        category_id: kind === "category_cap" ? category_id! : null,
        active: true,
      })
      .select()
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Created ${kind} goal for ${target_amount} EGP.` }],
      structuredContent: { goal: data },
    };
  },
});
