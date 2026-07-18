import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "confirm_commitment",
  title: "Confirm / update commitment",
  description:
    "Mark a recurring commitment occurrence as paid, delayed to a new date, skipped, or paid with a changed amount. Adjusts the user's balance unless already reflected.",
  inputSchema: {
    id: z.string().uuid().describe("Recurring occurrence UUID."),
    action: z.enum(["paid", "delayed", "skipped", "changed"]),
    actual_amount: z
      .number()
      .positive()
      .optional()
      .describe("Required when action is 'changed'."),
    new_due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Required when action is 'delayed'."),
    reflected: z
      .boolean()
      .optional()
      .describe("If true, payment already deducted from balance — do not deduct again."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  handler: async ({ id, action, actual_amount, new_due_date, reflected }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    const { data: occ, error: fErr } = await supabase
      .from("recurring_occurrences")
      .select("*, recurring_items(name, category_id)")
      .eq("id", id)
      .maybeSingle();
    if (fErr) return { content: [{ type: "text", text: fErr.message }], isError: true };
    if (!occ) return { content: [{ type: "text", text: "Commitment not found." }], isError: true };

    if (action === "delayed") {
      if (!new_due_date)
        return { content: [{ type: "text", text: "new_due_date required." }], isError: true };
      const { error } = await supabase
        .from("recurring_occurrences")
        .update({ status: "delayed", due_date: new_due_date })
        .eq("id", id);
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      return { content: [{ type: "text", text: `Delayed to ${new_due_date}.` }] };
    }
    if (action === "skipped") {
      const { error } = await supabase
        .from("recurring_occurrences")
        .update({ status: "skipped" })
        .eq("id", id);
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      return { content: [{ type: "text", text: "Skipped." }] };
    }

    if (action === "changed" && actual_amount == null)
      return {
        content: [{ type: "text", text: "actual_amount required for 'changed'." }],
        isError: true,
      };
    const amount = action === "changed" ? actual_amount! : Number(occ.expected_amount);
    const rec = (occ as { recurring_items?: { name?: string; category_id?: string | null } })
      .recurring_items;

    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .insert({
        user_id: ctx.getUserId()!,
        kind: "expense",
        amount,
        category_id: rec?.category_id ?? null,
        note: `Commitment: ${rec?.name ?? "Recurring"}${reflected ? " (already reflected)" : ""}`,
        occurred_on: occ.due_date,
        accuracy_type: "exact",
      })
      .select("id")
      .maybeSingle();
    if (txErr) return { content: [{ type: "text", text: txErr.message }], isError: true };

    await supabase
      .from("recurring_occurrences")
      .update({
        status: "confirmed",
        actual_amount: amount,
        transaction_id: tx?.id ?? null,
        reflected_in_balance: reflected === true,
      })
      .eq("id", id);

    if (!reflected) {
      const { data: s } = await supabase
        .from("user_settings")
        .select("current_balance")
        .eq("user_id", ctx.getUserId()!)
        .maybeSingle();
      if (s?.current_balance != null) {
        const next = Number(s.current_balance) - amount;
        await supabase
          .from("user_settings")
          .update({ current_balance: next, balance_updated_at: new Date().toISOString() })
          .eq("user_id", ctx.getUserId()!);
      }
    }
    return {
      content: [{ type: "text", text: `Confirmed ${amount} EGP.` }],
      structuredContent: { amount, reflected: reflected === true },
    };
  },
});
