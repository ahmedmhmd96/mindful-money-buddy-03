import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser, unauthenticated } from "../supabase";
import {
  calculateFinancialPosition,
  type CommitmentInput,
} from "@/lib/financial-position";

export default defineTool({
  name: "get_safe_to_spend",
  title: "Get safe-to-spend position",
  description:
    "Return the signed-in user's current financial position in EGP: safe-to-spend today, daily limit, projected balance before next income, upcoming commitments, and health status.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    const userId = ctx.getUserId()!;

    const { data: settings } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    const { data: occs } = await supabase
      .from("recurring_occurrences")
      .select("*, recurring_items(name, priority)")
      .order("due_date", { ascending: true });

    const commitments: CommitmentInput[] = (occs ?? []).map((o) => {
      const rec = (o as { recurring_items?: { name?: string; priority?: string } })
        .recurring_items;
      return {
        id: o.id,
        due_date: o.due_date,
        expected_amount: Number(o.expected_amount),
        actual_amount: o.actual_amount != null ? Number(o.actual_amount) : null,
        status: o.status as CommitmentInput["status"],
        priority: (rec?.priority as CommitmentInput["priority"]) ?? "mandatory",
        reflected_in_balance: Boolean(
          (o as { reflected_in_balance?: boolean }).reflected_in_balance,
        ),
        name: rec?.name,
      };
    });

    // Essential actuals inside window (mirrors snapshot logic)
    let essentialActualsInWindow = 0;
    if (settings?.next_income_date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const end = new Date(settings.next_income_date + "T00:00:00");
      end.setDate(end.getDate() - 1);
      const { data: txs } = await supabase
        .from("transactions")
        .select("amount, kind, accuracy_type, note")
        .eq("user_id", userId)
        .eq("kind", "expense")
        .gte("occurred_on", today.toISOString().slice(0, 10))
        .lte("occurred_on", end.toISOString().slice(0, 10));
      for (const t of txs ?? []) {
        const note = (t as { note?: string | null }).note ?? "";
        if (note.startsWith("Commitment:")) continue;
        if (t.accuracy_type === "balance_correction") continue;
        essentialActualsInWindow += Number(t.amount);
      }
    }

    const position = calculateFinancialPosition({
      currentBalance: settings?.current_balance != null ? Number(settings.current_balance) : null,
      balanceUpdatedAt: settings?.balance_updated_at ?? null,
      nextIncomeDate: settings?.next_income_date ?? null,
      nextIncomeAmount:
        settings?.next_income_amount != null ? Number(settings.next_income_amount) : null,
      nextIncomeConfirmed: false,
      includeIncomeDay: Boolean(
        (settings as { include_income_day?: boolean } | null)?.include_income_day,
      ),
      essentialAmount:
        settings?.flex_spend_amount != null ? Number(settings.flex_spend_amount) : null,
      essentialFrequency:
        (settings?.flex_spend_frequency as "daily" | "weekly" | "monthly" | null) ?? null,
      essentialUpdatedAt: settings?.updated_at ?? null,
      essentialActualsInWindow,
      safetyBuffer:
        (settings as { safety_buffer_amount?: number | null } | null)?.safety_buffer_amount != null
          ? Number((settings as { safety_buffer_amount?: number | null }).safety_buffer_amount)
          : null,
      commitments,
    });

    const summary =
      `Safe to spend: ${position.spendableAmount.toFixed(0)} EGP total ` +
      `(${position.safeToSpendPerDay.toFixed(0)} EGP/day over ${position.remainingDays} day${position.remainingDays === 1 ? "" : "s"}). ` +
      `Projected balance before next income: ${position.projectedBalance.toFixed(0)} EGP. ` +
      `Status: ${position.financialHealth}. ${position.healthReason}`;

    return {
      content: [{ type: "text", text: summary }],
      structuredContent: { position },
    };
  },
});
