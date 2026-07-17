import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import { Trash2, ChevronDown, ScanLine } from "lucide-react";
import { OcrIntakeSheet } from "@/components/OcrIntakeSheet";
import {
  deleteTransaction,
  listCategories,
  listTransactions,
} from "@/lib/budget.functions";
import {
  correctBalance,
  getSnapshot,
  logQuickTransaction,
} from "@/lib/snapshot.functions";
import { AccuracyBadge } from "@/components/AccuracyBadge";
import { formatEGP, monthRange } from "@/lib/format";

export const Route = createFileRoute("/transactions")({
  head: () => ({ meta: [{ title: "Transactions — My Budget" }] }),
  component: TransactionsPage,
});

type Filter = "week" | "month" | "all";
type Accuracy = "exact" | "daily_total" | "category_total" | "balance_correction";

function TransactionsPage() {
  const qc = useQueryClient();
  const listCatsFn = useServerFn(listCategories);
  const listTxFn = useServerFn(listTransactions);
  const logFn = useServerFn(logQuickTransaction);
  const correctFn = useServerFn(correctBalance);
  const delFn = useServerFn(deleteTransaction);
  const snapFn = useServerFn(getSnapshot);

  const [filter, setFilter] = useState<Filter>("month");
  const [ocrOpen, setOcrOpen] = useState(false);
  const range = useMemo<{ from?: string; to?: string }>(() => {
    if (filter === "all") return {};
    if (filter === "month") {
      const { start, end } = monthRange();
      return { from: start, to: end };
    }
    const end = new Date();
    end.setDate(end.getDate() + 1);
    const start = new Date();
    start.setDate(start.getDate() - 6);
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }, [filter]);

  const catsQ = useQuery({ queryKey: ["categories"], queryFn: () => listCatsFn({ data: undefined }) });
  const snapQ = useQuery({ queryKey: ["snapshot"], queryFn: () => snapFn({ data: undefined }) });
  const txQ = useQuery({
    queryKey: ["transactions", filter],
    queryFn: () => listTxFn({ data: range }),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["snapshot"] });
  };

  const beforeSafe = snapQ.data?.safe.dailyAmount ?? null;
  const logM = useMutation({
    mutationFn: (d: Parameters<typeof logFn>[0]["data"]) => logFn({ data: d }),
    onSuccess: async () => {
      const prev = beforeSafe;
      invalidateAll();
      const fresh = await snapFn({ data: undefined });
      const next = fresh.safe.dailyAmount;
      if (prev != null && Number.isFinite(prev) && Number.isFinite(next)) {
        toast.success(
          `Saved. Safe daily spend: ${formatEGP(prev)} → ${formatEGP(next)}`,
        );
      } else {
        toast.success("Saved.");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const correctM = useMutation({
    mutationFn: (v: number) => correctFn({ data: { new_balance: v } }),
    onSuccess: (res) => {
      invalidateAll();
      toast.success(
        res.previous != null
          ? `Balance updated: ${formatEGP(res.previous)} → ${formatEGP(res.next)}`
          : "Balance set.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delM = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: invalidateAll,
    onError: (e: Error) => toast.error(e.message),
  });

  // Form state
  const [accuracy, setAccuracy] = useState<Accuracy>("exact");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [note, setNote] = useState("");
  const [source, setSource] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [newBalance, setNewBalance] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (accuracy === "balance_correction") {
      const n = Number(newBalance);
      if (!Number.isFinite(n)) {
        toast.error("Enter a valid balance");
        return;
      }
      correctM.mutate(n);
      setNewBalance("");
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    logM.mutate(
      {
        kind,
        amount: amt,
        category_id: kind === "expense" ? categoryId || null : null,
        note: note || undefined,
        source: kind === "income" ? source || undefined : undefined,
        occurred_on: date,
        accuracy_type: accuracy,
        period_start: accuracy === "category_total" ? periodStart || undefined : undefined,
        period_end: accuracy === "category_total" ? periodEnd || undefined : undefined,
      },
      {
        onSuccess: () => {
          setAmount("");
          setNote("");
          setSource("");
        },
      },
    );
  }

  const cats = catsQ.data ?? [];
  const tx = txQ.data ?? [];

  // Recent tap-to-repeat chips (unique by category+amount for expenses)
  const recentChips = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; label: string; amount: number; category_id: string | null }[] = [];
    for (const t of tx) {
      if (t.kind !== "expense") continue;
      const key = `${t.category_id ?? ""}-${t.amount}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cat = cats.find((c) => c.id === t.category_id);
      out.push({
        key,
        label: `${cat?.name ?? "Other"} · ${formatEGP(Number(t.amount))}`,
        amount: Number(t.amount),
        category_id: t.category_id,
      });
      if (out.length >= 6) break;
    }
    return out;
  }, [tx, cats]);

  function repeat(chip: { amount: number; category_id: string | null }) {
    logM.mutate({
      kind: "expense",
      amount: chip.amount,
      category_id: chip.category_id,
      occurred_on: new Date().toISOString().slice(0, 10),
      accuracy_type: "exact",
    });
  }

  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <Button variant="outline" size="sm" onClick={() => setOcrOpen(true)}>
          <ScanLine className="mr-2 h-4 w-4" /> Scan & import
        </Button>
      </div>

      <OcrIntakeSheet open={ocrOpen} onOpenChange={setOcrOpen} />


      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Quick add</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={accuracy} onValueChange={(v) => setAccuracy(v as Accuracy)} className="mb-3">
              <TabsList className="grid w-full grid-cols-4 text-xs">
                <TabsTrigger value="exact">Exact</TabsTrigger>
                <TabsTrigger value="daily_total">Day total</TabsTrigger>
                <TabsTrigger value="category_total">Category total</TabsTrigger>
                <TabsTrigger value="balance_correction">Balance</TabsTrigger>
              </TabsList>
            </Tabs>

            <form onSubmit={submit} className="space-y-3">
              {accuracy === "balance_correction" ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Missed some transactions? Enter what you have now — we'll recalculate the forecast.
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="nb">Current balance (EGP)</Label>
                    <Input
                      id="nb"
                      type="number"
                      value={newBalance}
                      onChange={(e) => setNewBalance(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={correctM.isPending}>
                    Update balance
                  </Button>
                </>
              ) : (
                <>
                  <Tabs value={kind} onValueChange={(v) => setKind(v as "expense" | "income")}>
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="expense">Expense</TabsTrigger>
                      <TabsTrigger value="income">Income</TabsTrigger>
                    </TabsList>
                  </Tabs>

                  <div className="space-y-1.5">
                    <Label htmlFor="amt">Amount (EGP)</Label>
                    <Input
                      id="amt"
                      type="number"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      required
                    />
                  </div>

                  {kind === "expense" && (
                    <div className="space-y-1.5">
                      <Label>Category</Label>
                      <Select value={categoryId} onValueChange={setCategoryId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {cats.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="date">Date</Label>
                    <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>

                  {accuracy === "category_total" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="ps">Period start</Label>
                        <Input id="ps" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pe">Period end</Label>
                        <Input id="pe" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
                      </div>
                    </div>
                  )}

                  <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="ghost" size="sm" className="w-full justify-between">
                        More details
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${moreOpen ? "rotate-180" : ""}`}
                        />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-3 pt-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="note">Note</Label>
                        <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
                      </div>
                      {kind === "income" && (
                        <div className="space-y-1.5">
                          <Label htmlFor="src">Source</Label>
                          <Input
                            id="src"
                            value={source}
                            onChange={(e) => setSource(e.target.value)}
                            placeholder="Salary, freelance…"
                          />
                        </div>
                      )}
                    </CollapsibleContent>
                  </Collapsible>

                  <Button type="submit" className="w-full" disabled={logM.isPending}>
                    {logM.isPending ? "Saving…" : "Save"}
                  </Button>
                </>
              )}
            </form>

            {accuracy !== "balance_correction" && recentChips.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 text-xs text-muted-foreground">Repeat recent</div>
                <div className="flex flex-wrap gap-1.5">
                  {recentChips.map((c) => (
                    <Button
                      key={c.key}
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => repeat(c)}
                    >
                      {c.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>History</CardTitle>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <TabsList>
                <TabsTrigger value="week">Week</TabsTrigger>
                <TabsTrigger value="month">Month</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {tx.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transactions in this range.</p>
            ) : (
              <ul className="divide-y">
                {tx.map((t) => {
                  const cat = cats.find((c) => c.id === t.category_id);
                  const acc = (t as { accuracy_type?: string }).accuracy_type ?? "exact";
                  return (
                    <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 truncate font-medium">
                          {t.kind === "income"
                            ? (t.source ?? "Income")
                            : (cat?.name ?? "Uncategorized")}
                          <AccuracyBadge kind="actual" />
                          {acc !== "exact" && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                              {acc.replace("_", " ")}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t.occurred_on}
                          {t.note ? ` · ${t.note}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={
                            t.kind === "income" ? "text-emerald-600" : "text-foreground"
                          }
                        >
                          {t.kind === "income" ? "+" : "−"}
                          {formatEGP(Number(t.amount))}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => delM.mutate(t.id)}
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
