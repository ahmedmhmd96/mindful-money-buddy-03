import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_recurring_commitments",
  title: "List recurring commitments",
  description:
    "List the signed-in user's recurring income and expense commitments (e.g. salary, rent, subscriptions). Amounts in EGP.",
  inputSchema: {
    active_only: z.boolean().default(true).describe("Only return active commitments."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ active_only }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    let q = supabaseForUser(ctx)
      .from("recurring_items")
      .select("id, name, kind, amount, frequency, active")
      .order("name");
    if (active_only) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { commitments: data ?? [] },
    };
  },
});
