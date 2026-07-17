import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_transactions",
  title: "List transactions",
  description:
    "List the signed-in user's recent transactions (income and expenses), newest first. Amounts are in Egyptian Pounds (EGP).",
  inputSchema: {
    limit: z.number().int().min(1).max(200).default(50).describe("Maximum rows to return."),
    kind: z.enum(["income", "expense"]).optional().describe("Filter by transaction kind."),
    since: z
      .string()
      .optional()
      .describe("ISO date (YYYY-MM-DD). Only return transactions on or after this date."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, kind, since }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    let q = supabaseForUser(ctx)
      .from("transactions")
      .select("id, occurred_on, kind, amount, note, category_id")
      .order("occurred_on", { ascending: false })
      .limit(limit);
    if (kind) q = q.eq("kind", kind);
    if (since) q = q.gte("occurred_on", since);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { transactions: data ?? [] },
    };
  },
});
