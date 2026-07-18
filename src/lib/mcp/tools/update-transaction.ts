import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "update_transaction",
  title: "Update transaction",
  description:
    "Update fields on an existing transaction owned by the signed-in user. Only provided fields change.",
  inputSchema: {
    id: z.string().uuid().describe("Transaction UUID."),
    amount: z.number().positive().optional().describe("New amount in EGP."),
    kind: z.enum(["income", "expense"]).optional(),
    occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    note: z.string().max(500).nullish(),
    category_id: z.string().uuid().nullish(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  handler: async ({ id, ...rest }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) patch[k] = v;
    if (Object.keys(patch).length === 0)
      return { content: [{ type: "text", text: "No fields to update." }], isError: true };
    const { data, error } = await supabaseForUser(ctx)
      .from("transactions")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(patch as any)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data)
      return { content: [{ type: "text", text: "Transaction not found." }], isError: true };
    return {
      content: [{ type: "text", text: `Updated transaction ${id}.` }],
      structuredContent: { transaction: data },
    };
  },
});
