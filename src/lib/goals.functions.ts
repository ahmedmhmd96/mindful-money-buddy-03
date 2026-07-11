import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listGoals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("goals")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const upsertGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id?: string;
      kind: "savings" | "category_cap";
      target_amount: number;
      category_id?: string | null;
      active?: boolean;
    }) =>
      z
        .object({
          id: z.string().uuid().optional(),
          kind: z.enum(["savings", "category_cap"]),
          target_amount: z.number().min(0),
          category_id: z.string().uuid().nullish(),
          active: z.boolean().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const payload = {
      kind: data.kind,
      target_amount: data.target_amount,
      category_id: data.kind === "category_cap" ? (data.category_id ?? null) : null,
      active: data.active ?? true,
      updated_at: new Date().toISOString(),
    };
    if (data.id) {
      const { error } = await supabase.from("goals").update(payload).eq("id", data.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("goals").insert({ ...payload, user_id: userId });
      if (error) throw error;
    }
    return { ok: true };
  });

export const deleteGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("goals").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
