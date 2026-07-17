import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "add_transaction",
  title: "Add transaction",
  description:
    "Record a new income or expense transaction for the signed-in user. Amount is in Egyptian Pounds (EGP).",
  inputSchema: {
    kind: z.enum(["income", "expense"]).describe("Whether the transaction is income or expense."),
    amount: z.number().positive().describe("Amount in EGP (positive number)."),
    occurred_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Date the transaction occurred (YYYY-MM-DD)."),
    note: z.string().max(500).optional().describe("Optional short note."),
    category_id: z.string().uuid().optional().describe("Optional category UUID."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  handler: async ({ kind, amount, occurred_on, note, category_id }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const { data, error } = await supabaseForUser(ctx)
      .from("transactions")
      .insert({
        user_id: ctx.getUserId()!,
        kind,
        amount,
        occurred_on,
        note: note ?? null,
        category_id: category_id ?? null,
      })
      .select()
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Added ${kind} of ${amount} EGP on ${occurred_on}.` }],
      structuredContent: { transaction: data },
    };
  },
});
