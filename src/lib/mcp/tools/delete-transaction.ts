import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "delete_transaction",
  title: "Delete transaction",
  description: "Permanently delete one of the signed-in user's transactions by ID.",
  inputSchema: { id: z.string().uuid().describe("Transaction UUID.") },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  handler: async ({ id }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const { error } = await supabaseForUser(ctx).from("transactions").delete().eq("id", id);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return { content: [{ type: "text", text: `Deleted transaction ${id}.` }] };
  },
});
