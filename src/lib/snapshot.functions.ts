import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { computeSafeToSpend, type OpenCommitment, type SafeToSpendResult } from "./safe-to-spend";

// ---------- helpers ----------

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function occurrencesBetween(
  frequency: "monthly" | "weekly",
  dayOfMonth: number | null,
  dayOfWeek: number | null,
  from: Date,
  to: Date,
): Date[] {
  const out: Date[] = [];
  if (frequency === "monthly") {
    const dom = Math.max(1, Math.min(31, dayOfMonth ?? 1));
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    while (cursor <= to) {
      const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const d = new Date(cursor.getFullYear(), cursor.getMonth(), Math.min(dom, last));
      if (d >= from && d <= to) out.push(d);
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    const dow = Math.max(0, Math.min(6, dayOfWeek ?? 1));
    const cursor = new Date(from);
    while (cursor <= to) {
      if (cursor.getDay() === dow) out.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return out;
}

// ---------- snapshot ----------

export const getSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // Ensure settings row exists.
    let { data: settings } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (!settings) {
      await supabase.from("user_settings").insert({ user_id: userId, cycle_end_day: 31 });
      const r = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      settings = r.data;
    }

    // Generate upcoming occurrences up to horizon (next income or +45d).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = settings?.next_income_date
      ? new Date(settings.next_income_date + "T00:00:00")
      : new Date(today.getTime() + 45 * 86400000);
    if (horizon >= today) {
      const { data: items } = await supabase
        .from("recurring_items")
        .select("*")
        .eq("active", true);
      const rows: {
        user_id: string;
        recurring_id: string;
        due_date: string;
        expected_amount: number;
        status: string;
      }[] = [];
      for (const it of items ?? []) {
        if (it.kind !== "expense") continue;
        const dates = occurrencesBetween(
          it.frequency as "monthly" | "weekly",
          it.day_of_month,
          it.day_of_week,
          today,
          horizon,
        );
        for (const d of dates) {
          rows.push({
            user_id: userId,
            recurring_id: it.id,
            due_date: isoDate(d),
            expected_amount: Number(it.amount),
            status: "expected",
          });
        }
      }
      if (rows.length > 0) {
        // Upsert: ignore duplicates on (recurring_id, due_date).
        await supabase
          .from("recurring_occurrences")
          .upsert(rows, { onConflict: "recurring_id,due_date", ignoreDuplicates: true });
      }
    }

    // Load open occurrences (not skipped).
    const { data: occs } = await supabase
      .from("recurring_occurrences")
      .select("*, recurring_items(name, template, kind)")
      .neq("status", "skipped")
      .order("due_date", { ascending: true });

    const openCommitments: OpenCommitment[] = (occs ?? []).map((o) => ({
      id: o.id,
      due_date: o.due_date,
      expected_amount: Number(o.expected_amount),
      actual_amount: o.actual_amount != null ? Number(o.actual_amount) : null,
      status: o.status as OpenCommitment["status"],
      name: (o as { recurring_items?: { name?: string } }).recurring_items?.name,
    }));

    const safe = computeSafeToSpend({
      currentBalance: settings?.current_balance != null ? Number(settings.current_balance) : null,
      balanceUpdatedAt: settings?.balance_updated_at ?? null,
      nextIncomeDate: settings?.next_income_date ?? null,
      nextIncomeAmount:
        settings?.next_income_amount != null ? Number(settings.next_income_amount) : null,
      flexAmount:
        settings?.flex_spend_amount != null ? Number(settings.flex_spend_amount) : null,
      flexFrequency: (settings?.flex_spend_frequency as SafeToSpendResult extends object
        ? "daily" | "weekly" | "monthly" | null
        : never) ?? null,
      openCommitments,
    });

    return { settings, occurrences: occs ?? [], safe };
  });

// ---------- update snapshot fields ----------

const snapshotFieldsSchema = z.object({
  current_balance: z.number().nullable().optional(),
  next_income_amount: z.number().nullable().optional(),
  next_income_date: z.string().nullable().optional(),
  next_income_label: z.string().max(80).nullable().optional(),
  flex_spend_amount: z.number().nullable().optional(),
  flex_spend_frequency: z.enum(["daily", "weekly", "monthly"]).nullable().optional(),
  cycle_end_day: z.number().int().min(1).max(31).optional(),
  mark_onboarded: z.boolean().optional(),
});

export const updateSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof snapshotFieldsSchema>) => snapshotFieldsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
    if (data.current_balance !== undefined) {
      patch.current_balance = data.current_balance;
      patch.balance_updated_at = new Date().toISOString();
    }
    if (data.next_income_amount !== undefined) patch.next_income_amount = data.next_income_amount;
    if (data.next_income_date !== undefined) patch.next_income_date = data.next_income_date;
    if (data.next_income_label !== undefined) patch.next_income_label = data.next_income_label;
    if (data.flex_spend_amount !== undefined) patch.flex_spend_amount = data.flex_spend_amount;
    if (data.flex_spend_frequency !== undefined)
      patch.flex_spend_frequency = data.flex_spend_frequency;
    if (data.cycle_end_day !== undefined) patch.cycle_end_day = data.cycle_end_day;
    if (data.mark_onboarded) patch.onboarded_at = new Date().toISOString();

    const { error } = await supabase.from("user_settings").upsert(patch, { onConflict: "user_id" });
    if (error) throw error;
    return { ok: true };
  });

// ---------- balance correction ----------

export const correctBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { new_balance: number; note?: string }) =>
    z.object({ new_balance: z.number(), note: z.string().max(200).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Fetch previous
    const { data: prev } = await supabase
      .from("user_settings")
      .select("current_balance")
      .eq("user_id", userId)
      .maybeSingle();
    const prevBal = prev?.current_balance != null ? Number(prev.current_balance) : null;
    const now = new Date().toISOString();

    const { error: upErr } = await supabase.from("user_settings").upsert(
      {
        user_id: userId,
        current_balance: data.new_balance,
        balance_updated_at: now,
        updated_at: now,
      },
      { onConflict: "user_id" },
    );
    if (upErr) throw upErr;

    // Audit transaction for the delta.
    if (prevBal != null) {
      const delta = data.new_balance - prevBal;
      if (delta !== 0) {
        await supabase.from("transactions").insert({
          user_id: userId,
          kind: delta >= 0 ? "income" : "expense",
          amount: Math.abs(delta),
          accuracy_type: "balance_correction",
          occurred_on: isoDate(new Date()),
          note: data.note ?? "Balance correction",
          source: "Balance correction",
        });
      }
    }
    return { ok: true, previous: prevBal, next: data.new_balance };
  });

// ---------- log a transaction (adjusts balance) ----------

export const logQuickTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      kind: "expense" | "income";
      amount: number;
      category_id?: string | null;
      note?: string;
      source?: string;
      occurred_on: string;
      accuracy_type?: "exact" | "daily_total" | "category_total";
      period_start?: string;
      period_end?: string;
    }) =>
      z
        .object({
          kind: z.enum(["expense", "income"]),
          amount: z.number().positive(),
          category_id: z.string().uuid().nullish(),
          note: z.string().max(200).optional(),
          source: z.string().max(80).optional(),
          occurred_on: z.string(),
          accuracy_type: z.enum(["exact", "daily_total", "category_total"]).optional(),
          period_start: z.string().optional(),
          period_end: z.string().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("transactions").insert({
      user_id: userId,
      kind: data.kind,
      amount: data.amount,
      category_id: data.kind === "income" ? null : (data.category_id ?? null),
      note: data.note ?? null,
      source: data.source ?? null,
      occurred_on: data.occurred_on,
      accuracy_type: data.accuracy_type ?? "exact",
      period_start: data.period_start ?? null,
      period_end: data.period_end ?? null,
    });
    if (error) throw error;

    // Adjust current balance to keep safe-to-spend accurate.
    const { data: s } = await supabase
      .from("user_settings")
      .select("current_balance")
      .eq("user_id", userId)
      .maybeSingle();
    if (s?.current_balance != null) {
      const cur = Number(s.current_balance);
      const next = data.kind === "income" ? cur + data.amount : cur - data.amount;
      await supabase
        .from("user_settings")
        .update({ current_balance: next, balance_updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    }
    return { ok: true };
  });

// ---------- occurrence lifecycle ----------

export const confirmOccurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id: string;
      action: "paid" | "delayed" | "skipped" | "changed";
      actual_amount?: number;
    }) =>
      z
        .object({
          id: z.string().uuid(),
          action: z.enum(["paid", "delayed", "skipped", "changed"]),
          actual_amount: z.number().positive().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: occ, error: fErr } = await supabase
      .from("recurring_occurrences")
      .select("*, recurring_items(name, category_id, kind)")
      .eq("id", data.id)
      .maybeSingle();
    if (fErr) throw fErr;
    if (!occ) throw new Error("Commitment not found");

    if (data.action === "delayed") {
      await supabase
        .from("recurring_occurrences")
        .update({ status: "delayed" })
        .eq("id", data.id);
      return { ok: true };
    }
    if (data.action === "skipped") {
      await supabase
        .from("recurring_occurrences")
        .update({ status: "skipped" })
        .eq("id", data.id);
      return { ok: true };
    }

    // paid / changed → create tx and adjust balance
    const amount = data.action === "changed" ? (data.actual_amount ?? 0) : Number(occ.expected_amount);
    if (amount <= 0) throw new Error("Amount is required");
    const rec = (occ as { recurring_items?: { name?: string; category_id?: string | null; kind?: string } })
      .recurring_items;
    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        kind: "expense",
        amount,
        category_id: rec?.category_id ?? null,
        note: `Commitment: ${rec?.name ?? "Recurring"}`,
        occurred_on: occ.due_date,
        accuracy_type: "exact",
      })
      .select("id")
      .maybeSingle();
    if (txErr) throw txErr;

    await supabase
      .from("recurring_occurrences")
      .update({
        status: "confirmed",
        actual_amount: amount,
        transaction_id: tx?.id ?? null,
      })
      .eq("id", data.id);

    // Adjust balance.
    const { data: s } = await supabase
      .from("user_settings")
      .select("current_balance")
      .eq("user_id", userId)
      .maybeSingle();
    if (s?.current_balance != null) {
      const next = Number(s.current_balance) - amount;
      await supabase
        .from("user_settings")
        .update({ current_balance: next, balance_updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    }
    return { ok: true };
  });

// ---------- confirm expected income ----------

export const confirmIncome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { actual_amount?: number }) =>
    z.object({ actual_amount: z.number().positive().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: s } = await supabase
      .from("user_settings")
      .select("next_income_amount, next_income_label, next_income_date, current_balance")
      .eq("user_id", userId)
      .maybeSingle();
    if (!s?.next_income_amount) throw new Error("No expected income to confirm");
    const amount = data.actual_amount ?? Number(s.next_income_amount);
    await supabase.from("transactions").insert({
      user_id: userId,
      kind: "income",
      amount,
      source: s.next_income_label ?? "Income",
      occurred_on: s.next_income_date ?? isoDate(new Date()),
      accuracy_type: "exact",
    });
    const newBal =
      s.current_balance != null ? Number(s.current_balance) + amount : amount;
    await supabase
      .from("user_settings")
      .update({
        current_balance: newBal,
        balance_updated_at: new Date().toISOString(),
        next_income_amount: null,
        next_income_date: null,
        next_income_label: null,
      })
      .eq("user_id", userId);
    return { ok: true };
  });

// ---------- create commitment from onboarding template ----------

export const addCommitment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { name: string; amount: number; due_date: string; template?: string }) =>
      z
        .object({
          name: z.string().min(1).max(80),
          amount: z.number().positive(),
          due_date: z.string(),
          template: z.string().max(40).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const day = new Date(data.due_date + "T00:00:00").getDate();
    const { data: rec, error } = await supabase
      .from("recurring_items")
      .insert({
        user_id: userId,
        kind: "expense",
        amount: data.amount,
        name: data.name,
        frequency: "monthly",
        day_of_month: day,
        active: true,
        template: data.template ?? null,
      })
      .select("id")
      .maybeSingle();
    if (error) throw error;
    // Also create the first occurrence explicitly on that date.
    if (rec?.id) {
      await supabase.from("recurring_occurrences").upsert(
        {
          user_id: userId,
          recurring_id: rec.id,
          due_date: data.due_date,
          expected_amount: data.amount,
          status: "expected",
        },
        { onConflict: "recurring_id,due_date", ignoreDuplicates: true },
      );
    }
    return { ok: true };
  });
