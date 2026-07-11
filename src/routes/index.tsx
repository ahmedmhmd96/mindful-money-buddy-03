import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { type ReactNode, useEffect, useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import {
  getSettings,
  listCategories,
  listRecurring,
  listTransactions,
  runRecurring,
} from "@/lib/budget.functions";
import { getBudgetAdvice } from "@/lib/advice.functions";
import { listGoals } from "@/lib/goals.functions";
import { cycleInfo, formatEGP, monthRange } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — My Budget" }] }),
  component: Dashboard,
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

function Dashboard() {
  const qc = useQueryClient();
  const run = useServerFn(runRecurring);
  const listCatsFn = useServerFn(listCategories);
  const listTxFn = useServerFn(listTransactions);
  const listRecFn = useServerFn(listRecurring);
  const adviceFn = useServerFn(getBudgetAdvice);
  const settingsFn = useServerFn(getSettings);
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => settingsFn({ data: undefined }) });

  const { start, end } = useMemo(() => monthRange(), []);

  useEffect(() => {
    run({ data: undefined })
      .then((res) => {
        if (res.generated > 0) {
          toast.success(`Added ${res.generated} recurring transaction(s).`);
          qc.invalidateQueries({ queryKey: ["transactions"] });
        }
      })
      .catch(() => {});
  }, [run, qc]);

  const catsQ = useQuery({ queryKey: ["categories"], queryFn: () => listCatsFn({ data: undefined }) });
  const txQ = useQuery({
    queryKey: ["transactions", "month", start],
    queryFn: () => listTxFn({ data: { from: start, to: end } }),
  });
  const recentQ = useQuery({
    queryKey: ["transactions", "recent"],
    queryFn: () => listTxFn({ data: { limit: 8 } }),
  });
  const recQ = useQuery({ queryKey: ["recurring"], queryFn: () => listRecFn({ data: undefined }) });
  const listGoalsFn = useServerFn(listGoals);
  const goalsQ = useQuery({ queryKey: ["goals"], queryFn: () => listGoalsFn({ data: undefined }) });

  const advice = useMutation({
    mutationFn: () => adviceFn({ data: undefined }),
    onSuccess: (res) => {
      if (!res.ok) toast.error(res.error);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cats = catsQ.data ?? [];
  const tx = txQ.data ?? [];
  const recurring = (recQ.data ?? []).filter((r) => r.active);

  // Actual (posted) tallies this month
  let incomeActual = 0;
  let spendActual = 0;
  let spendRecurringActual = 0;
  let incomeRecurringActual = 0;
  const perCat = new Map<string, number>();
  const perCatRecurringActual = new Map<string, number>();
  const incomeBySource = new Map<string, number>();
  for (const t of tx) {
    const amt = Number(t.amount);
    if (t.kind === "income") {
      incomeActual += amt;
      const src = t.source ?? "Income";
      incomeBySource.set(src, (incomeBySource.get(src) ?? 0) + amt);
      if (isRecurringTx(t.note)) incomeRecurringActual += amt;
    } else {
      spendActual += amt;
      if (t.category_id) {
        perCat.set(t.category_id, (perCat.get(t.category_id) ?? 0) + amt);
        if (isRecurringTx(t.note)) {
          perCatRecurringActual.set(
            t.category_id,
            (perCatRecurringActual.get(t.category_id) ?? 0) + amt,
          );
        }
      }
      if (isRecurringTx(t.note)) spendRecurringActual += amt;
    }
  }
  const oneOffSpend = spendActual - spendRecurringActual;

  // Expected monthly totals from recurring items (full-month projection)
  const expectedRecurring = recurring.map((r) => {
    const amt = Number(r.amount);
    const monthlyAmt =
      r.frequency === "monthly"
        ? amt
        : amt * weeklyOccurrencesThisMonth(r.day_of_week ?? 1);
    return { ...r, monthlyAmt };
  });
  const expectedRecurringExpense = expectedRecurring
    .filter((r) => r.kind === "expense")
    .reduce((s, r) => s + r.monthlyAmt, 0);
  const expectedRecurringIncome = expectedRecurring
    .filter((r) => r.kind === "income")
    .reduce((s, r) => s + r.monthlyAmt, 0);

  // Expected recurring expense per category (full-month projection)
  const expectedRecurringPerCat = new Map<string, number>();
  for (const r of expectedRecurring) {
    if (r.kind !== "expense" || !r.category_id) continue;
    expectedRecurringPerCat.set(
      r.category_id,
      (expectedRecurringPerCat.get(r.category_id) ?? 0) + r.monthlyAmt,
    );
  }

  // Projected totals: actual one-offs + full expected recurring
  const projectedIncome = (incomeActual - incomeRecurringActual) + expectedRecurringIncome;
  const projectedSpend = oneOffSpend + expectedRecurringExpense;
  const projectedNet = projectedIncome - projectedSpend;

  // Daily spending limit derived from projected net over the remaining days of the cycle
  const cycleEndDay = settingsQ.data?.cycle_end_day ?? 31;
  const { cycleEnd, daysLeft } = cycleInfo(cycleEndDay);
  const savingsTarget = (goalsQ.data ?? [])
    .filter((g) => g.kind === "savings")
    .reduce((s, g) => s + Number(g.target_amount), 0);
  const dailyLimit = projectedNet / daysLeft;
  const dailyLimitWithGoal = (projectedNet - savingsTarget) / daysLeft;
  const cycleEndLabel = cycleEnd.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">This month's summary in EGP.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Income"
          value={formatEGP(projectedIncome)}
          tone="text-emerald-600"
          sub={`Actual ${formatEGP(incomeActual)} · Recurring ${formatEGP(expectedRecurringIncome)}`}
        />
        <StatCard
          label="Spending"
          value={formatEGP(projectedSpend)}
          tone="text-rose-600"
          sub={`One-off ${formatEGP(oneOffSpend)} · Recurring ${formatEGP(expectedRecurringExpense)}`}
        />
        <StatCard
          label="Projected Net"
          value={formatEGP(projectedNet)}
          tone={projectedNet >= 0 ? "text-emerald-600" : "text-rose-600"}
          sub={`Posted so far ${formatEGP(incomeActual - spendActual)}`}
        />
        <StatCard
          label={`Daily limit (until ${cycleEndLabel})`}
          value={formatEGP(dailyLimit)}
          tone={dailyLimit >= 0 ? "text-primary" : "text-rose-600"}
          sub={
            <>
              {daysLeft} day{daysLeft === 1 ? "" : "s"} left ·{" "}
              <Link to="/budget" className="text-primary hover:underline">
                cycle end day {cycleEndDay}
              </Link>
              {savingsTarget > 0 && (
                <>
                  <br />
                  Spend up to{" "}
                  <span className={dailyLimitWithGoal >= 0 ? "text-emerald-600" : "text-rose-600"}>
                    {formatEGP(dailyLimitWithGoal)}/day
                  </span>{" "}
                  to save {formatEGP(savingsTarget)}
                </>
              )}
            </>
          }
        />

      </div>


      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Category budgets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {cats.length === 0 && (
              <p className="text-sm text-muted-foreground">No categories yet.</p>
            )}
            {cats.map((c) => {
              const actual = perCat.get(c.id) ?? 0;
              const recActual = perCatRecurringActual.get(c.id) ?? 0;
              const recExpected = expectedRecurringPerCat.get(c.id) ?? 0;
              const projected = actual - recActual + recExpected;
              const lim = Number(c.monthly_limit);
              const pct = lim > 0 ? Math.min(100, Math.round((projected / lim) * 100)) : 0;
              const over = lim > 0 && projected > lim;
              return (
                <div key={c.id}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                      {c.name}
                    </span>
                    <span className={over ? "text-rose-600" : "text-muted-foreground"}>
                      {formatEGP(projected)}
                      {lim > 0 && <> / {formatEGP(lim)}</>}
                    </span>
                  </div>
                  {recExpected > 0 && (
                    <div className="mb-1 text-xs text-muted-foreground">
                      Actual {formatEGP(actual)} · Recurring {formatEGP(recExpected)}
                    </div>
                  )}
                  {lim > 0 && <Progress value={pct} />}
                </div>
              );
            })}
            <Link to="/budget" className="mt-2 inline-block text-xs text-primary hover:underline">
              Manage categories & limits →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recurring commitments (this month)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {expectedRecurring.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No recurring items yet.{" "}
                <Link to="/budget" className="text-primary hover:underline">
                  Add one →
                </Link>
              </p>
            )}
            {expectedRecurring.length > 0 && (
              <>
                <ul className="divide-y">
                  {expectedRecurring.map((r) => (
                    <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.kind === "income" ? "Income" : "Expense"} ·{" "}
                          {r.frequency === "monthly"
                            ? `Monthly (day ${r.day_of_month ?? 1})`
                            : `Weekly × ${weeklyOccurrencesThisMonth(r.day_of_week ?? 1)}`}
                        </div>
                      </div>
                      <div className={r.kind === "income" ? "text-emerald-600" : "text-rose-600"}>
                        {r.kind === "income" ? "+" : "−"}
                        {formatEGP(r.monthlyAmt)}
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between border-t pt-3 text-sm font-medium">
                  <span>Net recurring</span>
                  <span
                    className={
                      expectedRecurringIncome - expectedRecurringExpense >= 0
                        ? "text-emerald-600"
                        : "text-rose-600"
                    }
                  >
                    {formatEGP(expectedRecurringIncome - expectedRecurringExpense)}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Income this month</CardTitle>
          </CardHeader>
          <CardContent>
            {incomeBySource.size === 0 ? (
              <p className="text-sm text-muted-foreground">
                No income posted yet.{" "}
                <Link to="/transactions" className="text-primary hover:underline">
                  Add income →
                </Link>
              </p>
            ) : (
              <ul className="divide-y">
                {[...incomeBySource.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([src, amt]) => (
                    <li key={src} className="flex items-center justify-between py-2 text-sm">
                      <span>{src}</span>
                      <span className="text-emerald-600">+{formatEGP(amt)}</span>
                    </li>
                  ))}
                <li className="flex items-center justify-between border-t py-2 pt-3 text-sm font-medium">
                  <span>Total</span>
                  <span className="text-emerald-600">+{formatEGP(incomeActual)}</span>
                </li>
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>AI budgeting advice</CardTitle>
            <Button size="sm" onClick={() => advice.mutate()} disabled={advice.isPending}>
              {advice.isPending ? "Thinking…" : "Get advice"}
            </Button>
          </CardHeader>
          <CardContent>
            {advice.data?.ok && (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown>{advice.data.advice}</ReactMarkdown>
              </div>
            )}
            {!advice.data && !advice.isPending && (
              <p className="text-sm text-muted-foreground">
                Get personalized tips based on your month so far.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Goals</CardTitle>
          <Link to="/goals" className="text-xs text-primary hover:underline">
            Manage →
          </Link>
        </CardHeader>
        <CardContent className="space-y-3">
          {(goalsQ.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              No goals yet.{" "}
              <Link to="/goals" className="text-primary hover:underline">
                Set a savings target →
              </Link>
            </p>
          )}
          {(goalsQ.data ?? []).map((g) => {
            const target = Number(g.target_amount);
            let projected: number;
            let onTrack: boolean;
            let label: string;
            let hint: string;
            if (g.kind === "savings") {
              projected = projectedNet;
              onTrack = projected >= target;
              label = "Monthly savings";
              hint = onTrack
                ? `On track — ${formatEGP(projected - target)} above target`
                : `Short by ${formatEGP(target - projected)}`;
            } else {
              const catActual = g.category_id ? perCat.get(g.category_id) ?? 0 : 0;
              const catRecActual = g.category_id ? perCatRecurringActual.get(g.category_id) ?? 0 : 0;
              const catRecExpected = g.category_id ? expectedRecurringPerCat.get(g.category_id) ?? 0 : 0;
              projected = catActual - catRecActual + catRecExpected;
              onTrack = projected <= target;
              const catName = cats.find((c) => c.id === g.category_id)?.name ?? "Category";
              label = `${catName} cap`;
              hint = onTrack
                ? `Within cap — ${formatEGP(target - projected)} remaining`
                : `Over cap by ${formatEGP(projected - target)}`;
            }
            const pct = target > 0 ? Math.min(100, Math.max(0, (projected / target) * 100)) : 0;
            return (
              <div key={g.id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{label}</span>
                  <span className={onTrack ? "text-emerald-600" : "text-rose-600"}>
                    {formatEGP(projected)} / {formatEGP(target)}
                  </span>
                </div>
                <Progress value={pct} />
                <div className={`mt-1 text-xs ${onTrack ? "text-emerald-600" : "text-rose-600"}`}>
                  {hint}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>


      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent transactions</CardTitle>
          <Link to="/transactions" className="text-xs text-primary hover:underline">
            View all →
          </Link>
        </CardHeader>
        <CardContent>
          {recentQ.data?.length ? (
            <ul className="divide-y">
              {recentQ.data.map((t) => {
                const cat = cats.find((c) => c.id === t.category_id);
                return (
                  <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <div className="font-medium">
                        {t.kind === "income"
                          ? (t.source ?? "Income")
                          : (cat?.name ?? "Uncategorized")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t.occurred_on}
                        {t.note ? ` · ${t.note}` : ""}
                      </div>
                    </div>
                    <div className={t.kind === "income" ? "text-emerald-600" : "text-foreground"}>
                      {t.kind === "income" ? "+" : "−"}
                      {formatEGP(Number(t.amount))}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

function StatCard({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: string;
  sub?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
