import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { cycleInfo, monthRange } from "./format";

export const getBudgetAdvice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const { supabase, userId } = context;
    const { start, end } = monthRange();

    const [{ data: cats }, { data: txs }, { data: rec }, { data: settings }] = await Promise.all([
      supabase.from("categories").select("id, name, monthly_limit"),
      supabase
        .from("transactions")
        .select("kind, amount, category_id, occurred_on")
        .gte("occurred_on", start)
        .lt("occurred_on", end),
      supabase.from("recurring_items").select("kind, amount, name, frequency").eq("active", true),
      supabase.from("user_settings").select("cycle_end_day").eq("user_id", userId).maybeSingle(),
    ]);

    const catMap = new Map((cats ?? []).map((c) => [c.id, c]));
    let income = 0;
    let spend = 0;
    const perCat = new Map<string, number>();
    for (const t of txs ?? []) {
      const amt = Number(t.amount);
      if (t.kind === "income") income += amt;
      else {
        spend += amt;
        if (t.category_id) perCat.set(t.category_id, (perCat.get(t.category_id) ?? 0) + amt);
      }
    }

    const categoryLines = (cats ?? [])
      .map((c) => {
        const s = perCat.get(c.id) ?? 0;
        const lim = Number(c.monthly_limit);
        const pct = lim > 0 ? Math.round((s / lim) * 100) : null;
        return `- ${c.name}: spent ${s.toFixed(2)} EGP${lim > 0 ? ` / ${lim.toFixed(2)} EGP (${pct}%)` : " (no limit)"}`;
      })
      .join("\n");

    const recLines = (rec ?? [])
      .map((r) => `- ${r.name}: ${r.kind} ${Number(r.amount).toFixed(2)} EGP ${r.frequency}`)
      .join("\n");

    const cycleEndDay = settings?.cycle_end_day ?? 31;
    const { cycleEnd, daysLeft } = cycleInfo(cycleEndDay);
    const cycleEndLabel = cycleEnd.toISOString().slice(0, 10);

    const prompt = `You are a personal budgeting coach. All amounts are in Egyptian Pounds (EGP).

Current month summary:
- Total income so far: ${income.toFixed(2)} EGP
- Total spending so far: ${spend.toFixed(2)} EGP
- Net: ${(income - spend).toFixed(2)} EGP
- Budget cycle ends: ${cycleEndLabel} (day ${cycleEndDay} of the month)
- Days left in cycle: ${daysLeft}

Category spending vs. monthly limits:
${categoryLines || "(no categories yet)"}

Active recurring items:
${recLines || "(none)"}

Give 3-5 concrete, actionable budgeting recommendations tailored to this data. Be specific with EGP amounts and category names. Highlight overspending, suggest daily caps for the rest of the month, and note if recurring commitments threaten the budget. Use short markdown bullets. No preamble.`;

    try {
      const gateway = createLovableAiGatewayProvider(key);
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        prompt,
      });
      return { ok: true as const, advice: text };
    } catch (e) {
      const err = e as { statusCode?: number; message?: string };
      const status = err.statusCode;
      if (status === 429)
        return { ok: false as const, error: "Rate limit reached. Try again in a moment." };
      if (status === 402)
        return {
          ok: false as const,
          error: "AI credits exhausted. Add credits in workspace billing settings.",
        };
      return { ok: false as const, error: err.message ?? "Failed to get advice." };
    }
  });
