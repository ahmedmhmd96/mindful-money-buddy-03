import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, RotateCcw, Info, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  listCategories,
  listRecurring,
  listTransactions,
} from "@/lib/budget.functions";
import { explainForecast, type ExplainInput } from "@/lib/simulate.functions";
import { formatEGP, monthRange } from "@/lib/format";

export const Route = createFileRoute("/simulate")({
  head: () => ({ meta: [{ title: "Simulate — My Budget" }] }),
  component: SimulatePage,
});

type OneOff = {
  id: string;
  kind: "income" | "expense";
  name: string;
  amount: number;
  monthOffset: number; // 0 = this month
};

type RecOverride = {
  disabled?: boolean;
  amount?: number; // override monthly amount
};

type NewRecurring = {
  id: string;
  kind: "income" | "expense";
  name: string;
  monthlyAmount: number;
  startOffset: number; // months from now
  endOffset: number | null; // months from now, null = forever
};

function weeklyOccurrencesInMonth(dayOfWeek: number, year: number, month: number): number {
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

function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function SimulatePage() {
  const listCatsFn = useServerFn(listCategories);
  const listRecFn = useServerFn(listRecurring);
  const listTxFn = useServerFn(listTransactions);

  const { start, end } = useMemo(() => monthRange(), []);

  const catsQ = useQuery({ queryKey: ["categories"], queryFn: () => listCatsFn({ data: undefined }) });
  const recQ = useQuery({ queryKey: ["recurring"], queryFn: () => listRecFn({ data: undefined }) });
  const txQ = useQuery({
    queryKey: ["transactions", "month", start],
    queryFn: () => listTxFn({ data: { from: start, to: end } }),
  });

  // Adjustments
  const [incomeMultiplier, setIncomeMultiplier] = useState<number>(100);
  const [incomeAddend, setIncomeAddend] = useState<number>(0);
  const [startingBalance, setStartingBalance] = useState<number>(0);
  const [oneOffs, setOneOffs] = useState<OneOff[]>([]);
  const [recOverrides, setRecOverrides] = useState<Record<string, RecOverride>>({});
  const [newRecurring, setNewRecurring] = useState<NewRecurring[]>([]);

  const recurring = recQ.data ?? [];
  const tx = txQ.data ?? [];

  // Compute current month's actuals (one-off only — recurring is projected separately)
  const { oneOffIncomeThisMonth, oneOffSpendThisMonth } = useMemo(() => {
    let inc = 0;
    let spd = 0;
    for (const t of tx) {
      const isRec = isRecurringTx(t.note);
      if (isRec) continue;
      const amt = Number(t.amount);
      if (t.kind === "income") inc += amt;
      else spd += amt;
    }
    return { oneOffIncomeThisMonth: inc, oneOffSpendThisMonth: spd };
  }, [tx]);

  const forecast = useMemo(() => {
    const today = new Date();
    const rows: {
      key: string;
      label: string;
      income: number;
      expense: number;
      net: number;
      cumulative: number;
      hasScenario: boolean;
      partial: boolean;
    }[] = [];
    let cumulative = startingBalance;
    for (let i = 0; i < 12; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const year = d.getFullYear();
      const month = d.getMonth();
      let hasScenario = false;

      // Recurring (existing) — apply overrides
      let recIncome = 0;
      let recExpense = 0;
      for (const r of recurring) {
        if (!r.active) continue;
        const ov = recOverrides[r.id] ?? {};
        const original = Number(r.amount);
        // Override to 0 behaves the same as disable
        const effectivelyDisabled = ov.disabled || ov.amount === 0;
        if (effectivelyDisabled) { hasScenario = true; continue; }
        const base = ov.amount ?? original;
        // Only flag as scenario when the override actually differs from base
        if (ov.amount !== undefined && ov.amount !== original) hasScenario = true;
        const monthly =
          r.frequency === "monthly"
            ? base
            : base * weeklyOccurrencesInMonth(r.day_of_week ?? 1, year, month);
        if (r.kind === "income") recIncome += monthly;
        else recExpense += monthly;
      }

      // New hypothetical recurring
      for (const nr of newRecurring) {
        // Skip invalid windows (end before start)
        if (nr.endOffset != null && nr.endOffset < nr.startOffset) continue;
        if (i < nr.startOffset) continue;
        if (nr.endOffset != null && i > nr.endOffset) continue;
        if (nr.monthlyAmount === 0) continue;
        hasScenario = true;
        if (nr.kind === "income") recIncome += nr.monthlyAmount;
        else recExpense += nr.monthlyAmount;
      }

      // Apply income adjustments
      if (incomeMultiplier !== 100 || incomeAddend !== 0) hasScenario = true;
      let income = recIncome * (incomeMultiplier / 100) + incomeAddend;
      let expense = recExpense;

      // One-offs assigned to this month
      for (const o of oneOffs) {
        if (o.monthOffset !== i) continue;
        hasScenario = true;
        if (o.kind === "income") income += o.amount;
        else expense += o.amount;
      }

      // Include the current month's already-posted one-off actuals for i === 0
      if (i === 0) {
        income += oneOffIncomeThisMonth;
        expense += oneOffSpendThisMonth;
      }

      const net = income - expense;
      cumulative += net;
      rows.push({
        key: `${year}-${month}`,
        label: monthLabel(year, month),
        income,
        expense,
        net,
        cumulative,
        hasScenario,
        partial: i === 0,
      });
    }
    return rows;
  }, [
    recurring,
    recOverrides,
    newRecurring,
    incomeMultiplier,
    incomeAddend,
    oneOffs,
    startingBalance,
    oneOffIncomeThisMonth,
    oneOffSpendThisMonth,
  ]);

  const totals = useMemo(() => {
    const income = forecast.reduce((s, r) => s + r.income, 0);
    const expense = forecast.reduce((s, r) => s + r.expense, 0);
    return { income, expense, net: income - expense, endBalance: forecast[forecast.length - 1]?.cumulative ?? 0 };
  }, [forecast]);

  const explainFn = useServerFn(explainForecast);
  const [lastExplanation, setLastExplanation] = useState<string | null>(null);
  const explainM = useMutation({
    mutationFn: (payload: ExplainInput) => explainFn({ data: payload }),
    onSuccess: (res) => {
      if (res.ok) setLastExplanation(res.explanation);
      else toast.error(res.error);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function runExplain() {
    explainM.mutate({
      forecast: forecast.map((r) => ({
        label: r.label,
        income: r.income,
        expense: r.expense,
        net: r.net,
        cumulative: r.cumulative,
        hasScenario: r.hasScenario,
        partial: r.partial,
      })),
      scenario: {
        startingBalance,
        incomeMultiplier,
        incomeAddend,
        oneOffs: oneOffs.map((o) => ({
          kind: o.kind,
          name: o.name,
          amount: o.amount,
          monthLabel: monthOptions[o.monthOffset]?.label ?? `+${o.monthOffset}mo`,
        })),
        disabledRecurring: recurring
          .filter((r) => recOverrides[r.id]?.disabled)
          .map((r) => r.name),
        overriddenRecurring: recurring
          .filter((r) => recOverrides[r.id]?.amount !== undefined)
          .map((r) => ({
            name: r.name,
            from: Number(r.amount),
            to: Number(recOverrides[r.id]!.amount),
          })),
        newRecurring: newRecurring.map((nr) => ({
          kind: nr.kind,
          name: nr.name,
          monthlyAmount: nr.monthlyAmount,
          startLabel: monthOptions[nr.startOffset]?.label ?? `+${nr.startOffset}mo`,
          endLabel: nr.endOffset != null ? monthOptions[nr.endOffset]?.label ?? `+${nr.endOffset}mo` : null,
        })),
      },
    });
  }

  function addOneOff() {
    setOneOffs((p) => [
      ...p,
      { id: crypto.randomUUID(), kind: "expense", name: "", amount: 0, monthOffset: 0 },
    ]);
  }
  function addNewRecurring() {
    setNewRecurring((p) => [
      ...p,
      {
        id: crypto.randomUUID(),
        kind: "expense",
        name: "",
        monthlyAmount: 0,
        startOffset: 0,
        endOffset: null,
      },
    ]);
  }
  function resetAll() {
    setIncomeMultiplier(100);
    setIncomeAddend(0);
    setStartingBalance(0);
    setOneOffs([]);
    setRecOverrides({});
    setNewRecurring([]);
  }

  const monthOptions = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      return { value: i, label: monthLabel(d.getFullYear(), d.getMonth()) };
    });
  }, []);

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cash flow simulation</h1>
          <p className="text-sm text-muted-foreground">
            Explore what-if scenarios for the next 12 months. Changes are not saved.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={resetAll}>
          <RotateCcw className="mr-1.5 h-4 w-4" /> Reset scenario
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Projected income (12 mo)" value={formatEGP(totals.income)} tone="text-emerald-600" />
        <StatCard label="Projected spend (12 mo)" value={formatEGP(totals.expense)} tone="text-rose-600" />
        <StatCard
          label="Projected net (12 mo)"
          value={formatEGP(totals.net)}
          tone={totals.net >= 0 ? "text-emerald-600" : "text-rose-600"}
        />
        <StatCard
          label="End balance"
          value={formatEGP(totals.endBalance)}
          tone={totals.endBalance >= 0 ? "text-primary" : "text-rose-600"}
          sub={`Starting ${formatEGP(startingBalance)}`}
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>12-month forecast</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={forecast} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" fontSize={11} stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  formatter={(v: number) => formatEGP(v)}
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="income" name="Income" stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="expense" name="Expense" stroke="#ef4444" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="net" name="Net" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line
                  type="monotone"
                  dataKey="cumulative"
                  name="Cumulative"
                  stroke="#a855f7"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Income & starting balance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Income multiplier (%)</Label>
                <NumberInput
                  value={incomeMultiplier}
                  onChange={setIncomeMultiplier}
                  allowEmpty={false}
                  emptyValue={100}
                />
                <p className="mt-1 text-xs text-muted-foreground">e.g. 110 = 10% raise</p>
              </div>
              <div>
                <Label className="text-xs">Extra monthly income (EGP)</Label>
                <NumberInput value={incomeAddend} onChange={setIncomeAddend} placeholder="0" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Starting balance (EGP)</Label>
              <NumberInput value={startingBalance} onChange={setStartingBalance} placeholder="0" />
            </div>

          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>One-off items</CardTitle>
            <Button size="sm" variant="outline" onClick={addOneOff}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {oneOffs.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Add hypothetical purchases or windfalls (e.g. "buy laptop 30,000 next month").
              </p>
            )}
            {oneOffs.map((o) => (
              <div key={o.id} className="grid grid-cols-12 items-end gap-2">
                <div className="col-span-3">
                  <Select
                    value={o.kind}
                    onValueChange={(v) =>
                      setOneOffs((p) => p.map((x) => (x.id === o.id ? { ...x, kind: v as "income" | "expense" } : x)))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Expense</SelectItem>
                      <SelectItem value="income">Income</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-4">
                  <Input
                    placeholder="Name"
                    value={o.name}
                    onChange={(e) =>
                      setOneOffs((p) => p.map((x) => (x.id === o.id ? { ...x, name: e.target.value } : x)))
                    }
                  />
                </div>
                <div className="col-span-2">
                  <NumberInput
                    placeholder="Amount"
                    value={o.amount}
                    onChange={(n) =>
                      setOneOffs((p) => p.map((x) => (x.id === o.id ? { ...x, amount: n } : x)))
                    }
                  />
                </div>

                <div className="col-span-2">
                  <Select
                    value={String(o.monthOffset)}
                    onValueChange={(v) =>
                      setOneOffs((p) => p.map((x) => (x.id === o.id ? { ...x, monthOffset: Number(v) } : x)))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {monthOptions.map((m) => (
                        <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="col-span-1"
                  onClick={() => setOneOffs((p) => p.filter((x) => x.id !== o.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recurring items (override)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {recurring.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No recurring items yet. Add them on the Budget page to include in the simulation.
            </p>
          )}
          {recurring.map((r) => {
            const ov = recOverrides[r.id] ?? {};
            const enabled = !ov.disabled;
            return (
              <div key={r.id} className="grid grid-cols-12 items-center gap-2">
                <div className="col-span-5">
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.kind === "income" ? "Income" : "Expense"} · {r.frequency}
                  </div>
                </div>
                <div className="col-span-3">
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder={String(Number(r.amount))}
                    value={ov.amount ?? ""}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw !== "" && !/^-?\d*\.?\d*$/.test(raw)) return;
                      const val = raw === "" ? undefined : Number(raw);
                      setRecOverrides((p) => ({ ...p, [r.id]: { ...p[r.id], amount: val } }));
                    }}
                  />
                </div>

                <div className="col-span-3 text-xs text-muted-foreground">
                  base {formatEGP(Number(r.amount))}
                </div>
                <div className="col-span-1 flex justify-end">
                  <Switch
                    checked={enabled}
                    onCheckedChange={(v) =>
                      setRecOverrides((p) => ({ ...p, [r.id]: { ...p[r.id], disabled: !v } }))
                    }
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>New hypothetical recurring</CardTitle>
          <Button size="sm" variant="outline" onClick={addNewRecurring}>
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {newRecurring.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Simulate a new subscription, salary, or bill without saving it.
            </p>
          )}
          {newRecurring.map((nr) => {
            const invalidWindow = nr.endOffset != null && nr.endOffset < nr.startOffset;
            return (
            <div key={nr.id} className="space-y-1">
            <div className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-2">
                <Select
                  value={nr.kind}
                  onValueChange={(v) =>
                    setNewRecurring((p) =>
                      p.map((x) => (x.id === nr.id ? { ...x, kind: v as "income" | "expense" } : x)),
                    )
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">Expense</SelectItem>
                    <SelectItem value="income">Income</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3">
                <Input
                  placeholder="Name"
                  value={nr.name}
                  onChange={(e) =>
                    setNewRecurring((p) => p.map((x) => (x.id === nr.id ? { ...x, name: e.target.value } : x)))
                  }
                />
              </div>
              <div className="col-span-2">
                <NumberInput
                  placeholder="Monthly"
                  value={nr.monthlyAmount}
                  onChange={(n) =>
                    setNewRecurring((p) =>
                      p.map((x) => (x.id === nr.id ? { ...x, monthlyAmount: n } : x)),
                    )
                  }
                />
              </div>

              <div className="col-span-2">
                <Label className="text-xs">Start</Label>
                <Select
                  value={String(nr.startOffset)}
                  onValueChange={(v) =>
                    setNewRecurring((p) => p.map((x) => (x.id === nr.id ? { ...x, startOffset: Number(v) } : x)))
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((m) => (
                      <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">End</Label>
                <Select
                  value={nr.endOffset == null ? "none" : String(nr.endOffset)}
                  onValueChange={(v) =>
                    setNewRecurring((p) =>
                      p.map((x) => (x.id === nr.id ? { ...x, endOffset: v === "none" ? null : Number(v) } : x)),
                    )
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ongoing</SelectItem>
                    {monthOptions.map((m) => (
                      <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="col-span-1"
                onClick={() => setNewRecurring((p) => p.filter((x) => x.id !== nr.id))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {invalidWindow && (
              <p className="pl-1 text-xs text-rose-600">
                End month is before start — this item won't contribute to the forecast. Adjust the dates or set End to Ongoing.
              </p>
            )}
            </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Plain-language explanation
          </CardTitle>
          <Button size="sm" onClick={runExplain} disabled={explainM.isPending}>
            {explainM.isPending ? "Thinking…" : "Explain this forecast"}
          </Button>
        </CardHeader>
        <CardContent>
          {lastExplanation ? (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown>{lastExplanation}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Click <span className="font-medium text-foreground">Explain this forecast</span> to get a plain-language walk-through of the months above — which are tight, which windfalls offset them, and what to plan for.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Monthly breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
              <Info className="h-3.5 w-3.5" /> How to read this table
            </div>
            <ul className="ml-4 list-disc space-y-0.5">
              <li><span className="font-medium text-foreground">Income / Expense</span> — projected totals for the month from recurring items, income adjustments, and any one-offs you added.</li>
              <li><span className="font-medium text-foreground">Net</span> = Income − Expense for that month.</li>
              <li><span className="font-medium text-foreground">Cumulative</span> = Starting balance + running sum of Net. This is your projected balance at month-end.</li>
              <li>The first month is <span className="font-medium text-foreground">partial</span>: it includes one-off transactions already posted this month plus the full month's recurring items.</li>
              <li>Rows tagged <Badge variant="secondary" className="mx-0.5 h-4 px-1.5 py-0 text-[10px]">scenario</Badge> include your hypothetical adjustments (overrides, one-offs, new recurring, income tweaks).</li>
            </ul>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Month</th>
                  <th className="py-2 text-right" title="Projected income for the month">Income</th>
                  <th className="py-2 text-right" title="Projected expenses for the month">Expense</th>
                  <th className="py-2 text-right" title="Net = Income − Expense">Net</th>
                  <th className="py-2 text-right" title="Cumulative = Starting balance + running sum of Net">Cumulative</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <td className="py-2 italic">Starting balance</td>
                  <td className="py-2 text-right">—</td>
                  <td className="py-2 text-right">—</td>
                  <td className="py-2 text-right">—</td>
                  <td className={`py-2 text-right font-medium ${startingBalance >= 0 ? "text-primary" : "text-rose-600"}`}>
                    {formatEGP(startingBalance)}
                  </td>
                </tr>
                {forecast.map((r) => (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{r.label}</span>
                        {r.partial && (
                          <Badge variant="outline" className="h-4 px-1.5 py-0 text-[10px]" title="Includes only the remainder of the current month plus already-posted one-offs">
                            partial
                          </Badge>
                        )}
                        {r.hasScenario && (
                          <Badge variant="secondary" className="h-4 px-1.5 py-0 text-[10px]" title="This month is affected by scenario adjustments">
                            scenario
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-2 text-right text-emerald-600">{formatEGP(r.income)}</td>
                    <td className="py-2 text-right text-rose-600">{formatEGP(r.expense)}</td>
                    <td className={`py-2 text-right ${r.net >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {formatEGP(r.net)}
                    </td>
                    <td className={`py-2 text-right ${r.cumulative >= 0 ? "text-primary" : "text-rose-600"}`}>
                      {formatEGP(r.cumulative)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {catsQ.data && (
            <p className="mt-3 text-xs text-muted-foreground">
              Baseline uses your active recurring items and current-month one-off transactions. Scenario inputs (income multiplier/addend, overrides, disabled items, one-offs, and new hypothetical recurring) are layered on top.
            </p>
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
  sub?: string;
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

function NumberInput({
  value,
  onChange,
  placeholder,
  allowEmpty = true,
  emptyValue = 0,
}: {
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  emptyValue?: number;
}) {
  const [text, setText] = useState<string>(value === 0 && allowEmpty ? "" : String(value));

  // Sync when parent resets/changes value externally
  useEffect(() => {
    const parsed = text === "" ? emptyValue : Number(text);
    if (!Number.isNaN(parsed) && parsed === value) return;
    setText(value === 0 && allowEmpty ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      value={text}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const raw = e.target.value;
        // allow empty, digits, one dot, optional leading minus
        if (raw !== "" && !/^-?\d*\.?\d*$/.test(raw)) return;
        setText(raw);
        if (raw === "" || raw === "-" || raw === "." || raw === "-.") {
          onChange(emptyValue);
        } else {
          const n = Number(raw);
          if (!Number.isNaN(n)) onChange(n);
        }
      }}
      onBlur={() => {
        if (text === "" || text === "-" || text === "." || text === "-.") {
          if (!allowEmpty) setText(String(emptyValue));
        }
      }}
    />
  );
}

