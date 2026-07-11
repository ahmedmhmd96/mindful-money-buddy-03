import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { listCategories, listRecurring, listTransactions } from "@/lib/budget.functions";
import { deleteGoal, listGoals, upsertGoal } from "@/lib/goals.functions";
import { formatEGP, monthRange } from "@/lib/format";

export const Route = createFileRoute("/goals")({
  head: () => ({ meta: [{ title: "Goals — My Budget" }] }),
  component: GoalsPage,
});

function weeklyOccurrencesThisMonth(dayOfWeek: number, d = new Date()): number {
  const year = d.getFullYear();
  const month = d.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let day = 1; day <= lastDay; day++) {
    if (new Date(year, month, day).getDay() === dayOfWeek) count++;
  }
  return count;
}
function isRecurringTx(note: string | null | undefined): boolean {
  return !!note && note.startsWith("Recurring:");
}

function GoalsPage() {
  const qc = useQueryClient();
  const listCatsFn = useServerFn(listCategories);
  const listTxFn = useServerFn(listTransactions);
  const listRecFn = useServerFn(listRecurring);
  const listGoalsFn = useServerFn(listGoals);
  const upsertFn = useServerFn(upsertGoal);
  const deleteFn = useServerFn(deleteGoal);

  const { start, end } = useMemo(() => monthRange(), []);

  const catsQ = useQuery({ queryKey: ["categories"], queryFn: () => listCatsFn({ data: undefined }) });
  const txQ = useQuery({
    queryKey: ["transactions", "month", start],
    queryFn: () => listTxFn({ data: { from: start, to: end } }),
  });
  const recQ = useQuery({ queryKey: ["recurring"], queryFn: () => listRecFn({ data: undefined }) });
  const goalsQ = useQuery({ queryKey: ["goals"], queryFn: () => listGoalsFn({ data: undefined }) });

  const [kind, setKind] = useState<"savings" | "category_cap">("savings");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");

  const upsert = useMutation({
    mutationFn: upsertFn,
    onSuccess: () => {
      toast.success("Goal saved");
      setAmount("");
      setCategoryId("");
      qc.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: deleteFn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });

  const progress = useGoalProgress({
    goals: goalsQ.data ?? [],
    tx: txQ.data ?? [],
    recurring: (recQ.data ?? []).filter((r) => r.active),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) return toast.error("Enter a valid amount");
    if (kind === "category_cap" && !categoryId) return toast.error("Pick a category");
    upsert.mutate({
      data: {
        kind,
        target_amount: amt,
        category_id: kind === "category_cap" ? categoryId : null,
      },
    });
  }

  const cats = catsQ.data ?? [];

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Goals</h1>
        <p className="text-sm text-muted-foreground">
          Track savings targets and category spending caps against your projected net.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Add goal</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label>Goal type</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="savings">Monthly savings target</SelectItem>
                    <SelectItem value="category_cap">Category spending cap</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {kind === "category_cap" && (
                <div>
                  <Label>Category</Label>
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      {cats.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>Target amount (EGP)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 2000"
                />
              </div>
              <Button type="submit" disabled={upsert.isPending}>
                {upsert.isPending ? "Saving…" : "Add goal"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your goals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {progress.length === 0 && (
              <p className="text-sm text-muted-foreground">No goals yet. Add one to start tracking.</p>
            )}
            {progress.map((g) => {
              const catName = cats.find((c) => c.id === g.category_id)?.name;
              const label =
                g.kind === "savings"
                  ? "Monthly savings"
                  : `${catName ?? "Category"} cap`;
              const positive = g.onTrack;
              return (
                <div key={g.id} className="rounded-md border p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground">
                        Target {formatEGP(g.target)} · Projected {formatEGP(g.projected)}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => del.mutate({ data: { id: g.id } })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Progress value={Math.min(100, Math.max(0, g.pct))} />
                  <div className={`mt-1 text-xs ${positive ? "text-emerald-600" : "text-rose-600"}`}>
                    {g.kind === "savings"
                      ? positive
                        ? `On track — projected ${formatEGP(g.projected - g.target)} above target`
                        : `Short by ${formatEGP(g.target - g.projected)}`
                      : positive
                        ? `Within cap — ${formatEGP(g.target - g.projected)} remaining`
                        : `Over cap by ${formatEGP(g.projected - g.target)}`}
                  </div>
                </div>
              );
            })}
            <Link to="/" className="mt-2 inline-block text-xs text-primary hover:underline">
              ← Back to dashboard
            </Link>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

type Goal = { id: string; kind: string; target_amount: number; category_id: string | null };
type Tx = { kind: string; amount: number; category_id: string | null; note: string | null };
type Rec = {
  kind: string;
  amount: number;
  category_id: string | null;
  frequency: string;
  day_of_week: number | null;
  active: boolean;
};

export function useGoalProgress(input: {
  goals: Goal[];
  tx: Tx[];
  recurring: Rec[];
}) {
  const { goals, tx, recurring } = input;
  let incomeActual = 0;
  let spendActual = 0;
  let spendRecActual = 0;
  let incomeRecActual = 0;
  const perCat = new Map<string, number>();
  const perCatRec = new Map<string, number>();
  for (const t of tx) {
    const amt = Number(t.amount);
    if (t.kind === "income") {
      incomeActual += amt;
      if (isRecurringTx(t.note)) incomeRecActual += amt;
    } else {
      spendActual += amt;
      if (t.category_id) {
        perCat.set(t.category_id, (perCat.get(t.category_id) ?? 0) + amt);
        if (isRecurringTx(t.note)) perCatRec.set(t.category_id, (perCatRec.get(t.category_id) ?? 0) + amt);
      }
      if (isRecurringTx(t.note)) spendRecActual += amt;
    }
  }
  let expIncome = 0;
  let expExpense = 0;
  const expPerCat = new Map<string, number>();
  for (const r of recurring) {
    const amt = Number(r.amount);
    const monthlyAmt =
      r.frequency === "monthly" ? amt : amt * weeklyOccurrencesThisMonth(r.day_of_week ?? 1);
    if (r.kind === "income") expIncome += monthlyAmt;
    else {
      expExpense += monthlyAmt;
      if (r.category_id) expPerCat.set(r.category_id, (expPerCat.get(r.category_id) ?? 0) + monthlyAmt);
    }
  }
  const projectedIncome = incomeActual - incomeRecActual + expIncome;
  const oneOffSpend = spendActual - spendRecActual;
  const projectedSpend = oneOffSpend + expExpense;
  const projectedNet = projectedIncome - projectedSpend;

  return goals.map((g) => {
    const target = Number(g.target_amount);
    let projected = 0;
    let onTrack = false;
    if (g.kind === "savings") {
      projected = projectedNet;
      onTrack = projected >= target;
    } else {
      const catActual = g.category_id ? perCat.get(g.category_id) ?? 0 : 0;
      const catRecActual = g.category_id ? perCatRec.get(g.category_id) ?? 0 : 0;
      const catRecExpected = g.category_id ? expPerCat.get(g.category_id) ?? 0 : 0;
      projected = catActual - catRecActual + catRecExpected;
      onTrack = projected <= target;
    }
    const pct = target > 0
      ? g.kind === "savings"
        ? (projected / target) * 100
        : (projected / target) * 100
      : 0;
    return { ...g, target, projected, pct, onTrack };
  });
}
