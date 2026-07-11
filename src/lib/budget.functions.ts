import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---------- Settings ----------

export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("user_settings")
      .select("cycle_end_day")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) {
      await supabase.from("user_settings").insert({ user_id: userId, cycle_end_day: 31 });
      return { cycle_end_day: 31 };
    }
    return { cycle_end_day: data.cycle_end_day };
  });

export const updateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cycle_end_day: number }) =>
    z.object({ cycle_end_day: z.number().int().min(1).max(31) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_settings")
      .upsert({ user_id: userId, cycle_end_day: data.cycle_end_day, updated_at: new Date().toISOString() });
    if (error) throw error;
    return { ok: true };
  });

const DEFAULT_CATEGORIES = [
  { name: "Food", color: "#f97316" },
  { name: "Transport", color: "#3b82f6" },
  { name: "Groceries", color: "#10b981" },
  { name: "Bills", color: "#ef4444" },
  { name: "Entertainment", color: "#a855f7" },
  { name: "Health", color: "#ec4899" },
  { name: "Shopping", color: "#eab308" },
  { name: "Other", color: "#64748b" },
];

// ---------- Categories ----------

export const listCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // Seed defaults if user has none
    const { data: existing } = await supabase.from("categories").select("id").limit(1);
    if (!existing || existing.length === 0) {
      await supabase
        .from("categories")
        .insert(DEFAULT_CATEGORIES.map((c) => ({ ...c, user_id: userId, monthly_limit: 0 })));
    }
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

export const upsertCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id?: string; name: string; monthly_limit: number; color?: string }) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(60),
        monthly_limit: z.number().min(0),
        color: z.string().max(20).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.id) {
      const { error } = await supabase
        .from("categories")
        .update({ name: data.name, monthly_limit: data.monthly_limit, color: data.color })
        .eq("id", data.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("categories").insert({
        user_id: userId,
        name: data.name,
        monthly_limit: data.monthly_limit,
        color: data.color ?? "#64748b",
      });
      if (error) throw error;
    }
    return { ok: true };
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("categories").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Transactions ----------

export const listTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { from?: string; to?: string; limit?: number }) =>
    z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("transactions")
      .select("*")
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false });
    if (data.from) q = q.gte("occurred_on", data.from);
    if (data.to) q = q.lt("occurred_on", data.to);
    if (data.limit) q = q.limit(data.limit);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const addTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    kind: "expense" | "income";
    amount: number;
    category_id?: string | null;
    note?: string;
    occurred_on: string;
    source?: string;
  }) =>
    z
      .object({
        kind: z.enum(["expense", "income"]),
        amount: z.number().min(0),
        category_id: z.string().uuid().nullish(),
        note: z.string().max(200).optional(),
        occurred_on: z.string(),
        source: z.string().max(60).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("transactions").insert({
      user_id: context.userId,
      kind: data.kind,
      amount: data.amount,
      category_id: data.kind === "income" ? null : (data.category_id ?? null),
      note: data.note ?? null,
      occurred_on: data.occurred_on,
      source: data.source ?? null,
    });
    if (error) throw error;
    return { ok: true };
  });

export const deleteTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("transactions").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Recurring items ----------

export const listRecurring = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("recurring_items")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const upsertRecurring = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id?: string;
      kind: "expense" | "income";
      amount: number;
      category_id?: string | null;
      name: string;
      frequency: "monthly" | "weekly";
      day_of_month?: number | null;
      day_of_week?: number | null;
      active?: boolean;
    }) =>
      z
        .object({
          id: z.string().uuid().optional(),
          kind: z.enum(["expense", "income"]),
          amount: z.number().min(0),
          category_id: z.string().uuid().nullish(),
          name: z.string().min(1).max(80),
          frequency: z.enum(["monthly", "weekly"]),
          day_of_month: z.number().int().min(1).max(31).nullish(),
          day_of_week: z.number().int().min(0).max(6).nullish(),
          active: z.boolean().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const payload = {
      kind: data.kind,
      amount: data.amount,
      category_id: data.kind === "income" ? null : (data.category_id ?? null),
      name: data.name,
      frequency: data.frequency,
      day_of_month: data.frequency === "monthly" ? (data.day_of_month ?? 1) : null,
      day_of_week: data.frequency === "weekly" ? (data.day_of_week ?? 1) : null,
      active: data.active ?? true,
    };
    if (data.id) {
      const { error } = await supabase.from("recurring_items").update(payload).eq("id", data.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("recurring_items")
        .insert({ ...payload, user_id: userId });
      if (error) throw error;
    }
    return { ok: true };
  });

export const deleteRecurring = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("recurring_items").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Recurring generator ----------

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function occurrencesBetween(
  frequency: "monthly" | "weekly",
  dayOfMonth: number | null,
  dayOfWeek: number | null,
  after: Date,
  through: Date,
): Date[] {
  const out: Date[] = [];
  if (frequency === "monthly") {
    const dom = Math.max(1, Math.min(31, dayOfMonth ?? 1));
    // Start scanning from the month of `after`
    const cursor = new Date(after.getFullYear(), after.getMonth(), 1);
    while (cursor <= through) {
      const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const day = Math.min(dom, lastDay);
      const occ = new Date(cursor.getFullYear(), cursor.getMonth(), day);
      if (occ > after && occ <= through) out.push(occ);
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    const dow = Math.max(0, Math.min(6, dayOfWeek ?? 1));
    const cursor = new Date(after);
    cursor.setDate(cursor.getDate() + 1);
    while (cursor <= through) {
      if (cursor.getDay() === dow) out.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return out;
}

export const runRecurring = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: items, error } = await supabase
      .from("recurring_items")
      .select("*")
      .eq("active", true);
    if (error) throw error;
    if (!items || items.length === 0) return { generated: 0 };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let generated = 0;

    for (const item of items) {
      const startAfter = item.last_generated_on
        ? new Date(item.last_generated_on + "T00:00:00")
        : new Date(item.created_at);
      const occs = occurrencesBetween(
        item.frequency as "monthly" | "weekly",
        item.day_of_month,
        item.day_of_week,
        startAfter,
        today,
      );
      if (occs.length === 0) continue;
      const rows = occs.map((d) => ({
        user_id: userId,
        kind: item.kind,
        amount: item.amount,
        category_id: item.kind === "income" ? null : item.category_id,
        note: `Recurring: ${item.name}`,
        occurred_on: isoDate(d),
        source: item.kind === "income" ? item.name : null,
      }));
      const { error: insErr } = await supabase.from("transactions").insert(rows);
      if (insErr) throw insErr;
      const { error: updErr } = await supabase
        .from("recurring_items")
        .update({ last_generated_on: isoDate(occs[occs.length - 1]) })
        .eq("id", item.id);
      if (updErr) throw updErr;
      generated += rows.length;
    }
    return { generated };
  });
