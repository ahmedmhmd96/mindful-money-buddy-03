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
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  addTransaction,
  deleteTransaction,
  listCategories,
  listTransactions,
} from "@/lib/budget.functions";
import { formatEGP, monthRange } from "@/lib/format";

export const Route = createFileRoute("/transactions")({
  head: () => ({ meta: [{ title: "Transactions — My Budget" }] }),
  component: TransactionsPage,
});

type Filter = "week" | "month" | "all";

function TransactionsPage() {
  const qc = useQueryClient();
  const listCatsFn = useServerFn(listCategories);
  const listTxFn = useServerFn(listTransactions);
  const addFn = useServerFn(addTransaction);
  const delFn = useServerFn(deleteTransaction);

  const [filter, setFilter] = useState<Filter>("month");
  const range = useMemo(() => {
    if (filter === "all") return {};
    if (filter === "month") return monthRange();
    // week: last 7 days including today
    const end = new Date();
    end.setDate(end.getDate() + 1);
    const start = new Date();
    start.setDate(start.getDate() - 6);
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }, [filter]);

  const catsQ = useQuery({ queryKey: ["categories"], queryFn: () => listCatsFn({ data: undefined }) });
  const txQ = useQuery({
    queryKey: ["transactions", filter],
    queryFn: () => listTxFn({ data: range }),
  });

  const addM = useMutation({
    mutationFn: (d: Parameters<typeof addFn>[0]["data"]) => addFn({ data: d }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delM = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transactions"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  // Form state
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [note, setNote] = useState("");
  const [source, setSource] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    addM.mutate(
      {
        kind,
        amount: amt,
        category_id: kind === "expense" ? categoryId || null : null,
        note: note || undefined,
        source: kind === "income" ? source || undefined : undefined,
        occurred_on: date,
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

  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold">Transactions</h1>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Add transaction</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-3">
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

              {kind === "expense" ? (
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
              ) : (
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

              <div className="space-y-1.5">
                <Label htmlFor="date">Date</Label>
                <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="note">Note (optional)</Label>
                <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>

              <Button type="submit" className="w-full" disabled={addM.isPending}>
                {addM.isPending ? "Saving…" : "Add"}
              </Button>
            </form>
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
                  return (
                    <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {t.kind === "income"
                            ? (t.source ?? "Income")
                            : (cat?.name ?? "Uncategorized")}
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
