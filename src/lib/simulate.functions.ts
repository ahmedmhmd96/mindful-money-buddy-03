import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const kind = z.enum(["income", "expense"]);
const name60 = z.string().trim().max(60);

const ForecastRowSchema = z.object({
  label: z.string().trim().max(40),
  income: z.number().finite(),
  expense: z.number().finite(),
  net: z.number().finite(),
  cumulative: z.number().finite(),
  hasScenario: z.boolean(),
  partial: z.boolean(),
});

const ExplainScenarioSchema = z.object({
  startingBalance: z.number().finite(),
  incomeMultiplier: z.number().finite(),
  incomeAddend: z.number().finite(),
  oneOffs: z
    .array(
      z.object({
        kind,
        name: name60,
        amount: z.number().finite(),
        monthLabel: z.string().trim().max(20),
      }),
    )
    .max(24),
  disabledRecurring: z.array(name60).max(24),
  overriddenRecurring: z
    .array(
      z.object({
        name: name60,
        from: z.number().finite(),
        to: z.number().finite(),
      }),
    )
    .max(24),
  newRecurring: z
    .array(
      z.object({
        kind,
        name: name60,
        monthlyAmount: z.number().finite(),
        startLabel: z.string().trim().max(20),
        endLabel: z.string().trim().max(20).nullable(),
      }),
    )
    .max(12),
});

const ExplainInputSchema = z.object({
  forecast: z.array(ForecastRowSchema).max(24),
  scenario: ExplainScenarioSchema,
});

export type ForecastRow = z.infer<typeof ForecastRowSchema>;
export type ExplainScenario = z.infer<typeof ExplainScenarioSchema>;
export type ExplainInput = z.infer<typeof ExplainInputSchema>;

export const explainForecast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ExplainInputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const { forecast, scenario } = data;

    const rowsText = forecast
      .map(
        (r) =>
          `- ${r.label}${r.partial ? " (partial)" : ""}${r.hasScenario ? " [scenario]" : ""}: income ${r.income.toFixed(0)}, expense ${r.expense.toFixed(0)}, net ${r.net.toFixed(0)}, cumulative ${r.cumulative.toFixed(0)}`,
      )
      .join("\n");

    const scenarioLines: string[] = [];
    scenarioLines.push(`- Starting balance: ${scenario.startingBalance.toFixed(0)} EGP`);
    if (scenario.incomeMultiplier !== 100)
      scenarioLines.push(`- Income multiplier: ${scenario.incomeMultiplier}%`);
    if (scenario.incomeAddend !== 0)
      scenarioLines.push(`- Extra monthly income: ${scenario.incomeAddend.toFixed(0)} EGP`);
    for (const o of scenario.oneOffs)
      scenarioLines.push(`- One-off ${o.kind}: ${o.name || "(unnamed)"} ${o.amount.toFixed(0)} EGP in ${o.monthLabel}`);
    for (const d of scenario.disabledRecurring) scenarioLines.push(`- Disabled recurring: ${d}`);
    for (const ov of scenario.overriddenRecurring)
      scenarioLines.push(`- Override ${ov.name}: ${ov.from.toFixed(0)} → ${ov.to.toFixed(0)} EGP`);
    for (const nr of scenario.newRecurring)
      scenarioLines.push(
        `- New recurring ${nr.kind}: ${nr.name || "(unnamed)"} ${nr.monthlyAmount.toFixed(0)} EGP/mo from ${nr.startLabel}${nr.endLabel ? ` until ${nr.endLabel}` : " (ongoing)"}`,
      );

    const prompt = `You are a personal budgeting coach explaining a 12-month cash-flow forecast to a non-technical person. All amounts are in Egyptian Pounds (EGP).

Scenario adjustments:
${scenarioLines.join("\n") || "(none — pure baseline)"}

Monthly forecast:
${rowsText}

Write a short, plain-language narrative (max ~180 words) that walks the user through what will happen. Follow this style:
- Start with the overall trajectory (are they growing wealth, breaking even, or shrinking?).
- Call out specific months by name where something notable happens (a big expense hits, a windfall arrives, cumulative dips negative, etc.).
- Use the pattern "You will face X in month Y, however the expected Z in month F adds A to cover it" when relevant — connect risks to the income or events that offset them.
- End with 1-2 sentences of practical takeaway ("think about it" style — what to plan for).

Use short paragraphs or bullets. Concrete EGP amounts and month names. No preamble, no generic advice, no headings.`;

    try {
      const gateway = createLovableAiGatewayProvider(key);
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        prompt,
      });
      return { ok: true as const, explanation: text };
    } catch (e) {
      const err = e as { statusCode?: number; message?: string };
      if (err.statusCode === 429)
        return { ok: false as const, error: "Rate limit reached. Try again in a moment." };
      if (err.statusCode === 402)
        return { ok: false as const, error: "AI credits exhausted. Add credits in workspace billing settings." };
      return { ok: false as const, error: err.message ?? "Failed to explain forecast." };
    }
  });
