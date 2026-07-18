import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "create_recurring_commitment",
  title: "Create recurring commitment",
  description:
    "Create a recurring income or expense (e.g. salary, rent, subscription) for the signed-in user. Amounts in EGP.",
  inputSchema: {
    name: z.string().min(1).max(80),
    kind: z.enum(["income", "expense"]),
    amount: z.number().positive().describe("Amount per occurrence in EGP."),
    frequency: z.enum(["monthly", "weekly"]),
    day_of_month: z
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe("Required for monthly frequency (1-31)."),
    day_of_week: z
      .number()
      .int()
      .min(0)
      .max(6)
      .optional()
      .describe("Required for weekly frequency (0=Sun..6=Sat)."),
    category_id: z.string().uuid().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const { data, error } = await supabaseForUser(ctx)
      .from("recurring_items")
      .insert({
        user_id: ctx.getUserId()!,
        name: input.name,
        kind: input.kind,
        amount: input.amount,
        frequency: input.frequency,
        day_of_month: input.frequency === "monthly" ? (input.day_of_month ?? 1) : null,
        day_of_week: input.frequency === "weekly" ? (input.day_of_week ?? 1) : null,
        category_id: input.kind === "income" ? null : (input.category_id ?? null),
        active: true,
      })
      .select()
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Created recurring ${input.kind}: ${input.name}.` }],
      structuredContent: { recurring: data },
    };
  },
});
