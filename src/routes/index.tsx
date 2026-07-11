import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import {
  listCategories,
  listTransactions,
  runRecurring,
} from "@/lib/budget.functions";
import { getBudgetAdvice } from "@/lib/advice.functions";
import { formatEGP, monthRange } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — My Budget" }] }),
  component: Dashboard,
});

function Dashboard() {
  const qc = useQueryClient();
  const run = useServerFn(runRecurring);
  const listCatsFn = useServerFn(listCategories);
  const listTxFn = useServerFn(listTransactions);
  const adviceFn = useServerFn(getBudgetAdvice);

  const { start, end } = useMemo(() => monthRange(), []);

  // Run recurring on mount, then invalidate transactions
  useEffect(() => {
    run({ data: undefined }).then((res) => {
      if (res.generated > 0) {
        toast.success(`Added ${res.generated} recurring transaction(s).`);
        qc.invalidateQueries({ queryKey: ["transactions"] });
      }
    }).catch(() => {});
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

  const advice = useMutation({
    mutationFn: () => adviceFn({ data: undefined }),
    onSuccess: (res) => {
      if (!res.ok) toast.error(res.error);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cats = catsQ.data ?? [];
  const tx = txQ.data ?? [];

  let income = 0;
  let spend = 0;
  const perCat = new Map<string, number>();
  for (const t of tx) {
    const amt = Number(t.amount);
    if (t.kind === "income") income += amt;
    else {
      spend += amt;
      if (t.category_id) perCat.set(t.category_id, (perCat.get(t.category_id) ?? 0) + amt);
    }
  }
  const net = income - spend;

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">This month's summary in EGP.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Income" value={formatEGP(income)} tone="text-emerald-600" />
        <StatCard label="Spending" value={formatEGP(spend)} tone="text-rose-600" />
        <StatCard
          label="Net"
          value={formatEGP(net)}
          tone={net >= 0 ? "text-emerald-600" : "text-rose-600"}
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
              const s = perCat.get(c.id) ?? 0;
              const lim = Number(c.monthly_limit);
              const pct = lim > 0 ? Math.min(100, Math.round((s / lim) * 100)) : 0;
              const over = lim > 0 && s > lim;
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
                      {formatEGP(s)}
                      {lim > 0 && <> / {formatEGP(lim)}</>}
                    </span>
                  </div>
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
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>AI budgeting advice</CardTitle>
            <Button
              size="sm"
              onClick={() => advice.mutate()}
              disabled={advice.isPending}
            >
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

function StatCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
