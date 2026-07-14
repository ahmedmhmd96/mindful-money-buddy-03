import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  correctBalance,
  confirmIncome,
  confirmOccurrence,
  getSnapshot,
} from "@/lib/snapshot.functions";
import { SafeToSpendCard } from "@/components/SafeToSpendCard";
import { AccuracyBadge } from "@/components/AccuracyBadge";
import { formatEGP } from "@/lib/format";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Safe to spend — My Budget" }] }),
  component: Dashboard,
});

function Dashboard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const snapFn = useServerFn(getSnapshot);
  const correctFn = useServerFn(correctBalance);
  const confirmOccFn = useServerFn(confirmOccurrence);
  const confirmIncomeFn = useServerFn(confirmIncome);

  const snapQ = useQuery({ queryKey: ["snapshot"], queryFn: () => snapFn({ data: undefined }) });

  const settings = snapQ.data?.settings;
  const safe = snapQ.data?.safe;
  const occurrences = snapQ.data?.occurrences ?? [];

  // Redirect to onboarding when the user hasn't set anything up yet.
  useEffect(() => {
    if (!snapQ.data) return;
    if (!settings?.onboarded_at && settings?.current_balance == null) {
      navigate({ to: "/onboarding" });
    }
  }, [snapQ.data, settings, navigate]);

  const [balanceOpen, setBalanceOpen] = useState(false);
  const [balanceInput, setBalanceInput] = useState("");

  const correctM = useMutation({
    mutationFn: (v: number) => correctFn({ data: { new_balance: v } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["snapshot"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      setBalanceOpen(false);
      if (res.previous != null) {
        toast.success(
          `Balance updated: ${formatEGP(res.previous)} → ${formatEGP(res.next)}. Safe daily spend recalculated.`,
        );
      } else {
        toast.success("Balance set.");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmOccM = useMutation({
    mutationFn: (v: Parameters<typeof confirmOccFn>[0]["data"]) => confirmOccFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["snapshot"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Commitment updated. Safe daily spend recalculated.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmIncomeM = useMutation({
    mutationFn: (amt?: number) => confirmIncomeFn({ data: { actual_amount: amt } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["snapshot"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Income confirmed. Balance updated.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!snapQ.data || !safe) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  const openOccs = occurrences.filter((o) => o.status !== "confirmed" && o.status !== "skipped");
  const today = new Date().toISOString().slice(0, 10);
  const totalCommitted = openOccs
    .filter((o) => o.due_date <= (settings?.next_income_date ?? "9999-12-31"))
    .reduce((s, o) => s + Number(o.expected_amount), 0);
  const projectedEnd =
    (settings?.current_balance != null ? Number(settings.current_balance) : 0) - totalCommitted;

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Your money right now</h1>
        <p className="text-sm text-muted-foreground">All amounts in EGP.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SafeToSpendCard
            safe={safe}
            nextIncomeDate={settings?.next_income_date ?? null}
            onUpdateBalance={() => {
              setBalanceInput(String(settings?.current_balance ?? ""));
              setBalanceOpen(true);
            }}
          />
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Current balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {settings?.current_balance != null
                ? formatEGP(Number(settings.current_balance))
                : "—"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {settings?.balance_updated_at
                ? `Updated ${new Date(settings.balance_updated_at).toLocaleDateString()}`
                : "Not set yet"}
            </div>
            <Button
              variant="link"
              className="mt-2 h-auto p-0 text-primary"
              onClick={() => {
                setBalanceInput(String(settings?.current_balance ?? ""));
                setBalanceOpen(true);
              }}
            >
              Missed some transactions? Update balance
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Upcoming commitments</CardTitle>
            <AccuracyBadge kind="expected" />
          </CardHeader>
          <CardContent>
            {openOccs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing coming up. Add a commitment from{" "}
                <Link to="/budget" className="text-primary hover:underline">
                  Budget
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y">
                {openOccs.slice(0, 8).map((o) => {
                  const rec = (o as { recurring_items?: { name?: string } }).recurring_items;
                  const isPastDue = o.due_date < today && o.status === "expected";
                  return (
                    <li key={o.id} className="py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium">{rec?.name ?? "Commitment"}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatEGP(Number(o.expected_amount))} · due {o.due_date}
                            {isPastDue && (
                              <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-rose-800">
                                past due
                              </span>
                            )}
                            {o.status === "delayed" && (
                              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                                delayed
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              confirmOccM.mutate({ id: o.id, action: "paid" })
                            }
                          >
                            Paid
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const v = window.prompt("Actual amount paid (EGP):");
                              const n = Number(v);
                              if (!v || !Number.isFinite(n) || n <= 0) return;
                              confirmOccM.mutate({ id: o.id, action: "changed", actual_amount: n });
                            }}
                          >
                            Changed
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              confirmOccM.mutate({ id: o.id, action: "delayed" })
                            }
                          >
                            Delay
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              confirmOccM.mutate({ id: o.id, action: "skipped" })
                            }
                          >
                            Skip
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Expected income</CardTitle>
              <AccuracyBadge kind="expected" />
            </CardHeader>
            <CardContent>
              {settings?.next_income_amount ? (
                <>
                  <div className="text-lg font-semibold">
                    {formatEGP(Number(settings.next_income_amount))}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {settings.next_income_label ?? "Income"} on {settings.next_income_date}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        confirmIncomeM.mutate(Number(settings.next_income_amount))
                      }
                    >
                      Yes, it arrived
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const v = window.prompt("Actual amount received:");
                        const n = Number(v);
                        if (!v || !Number.isFinite(n) || n <= 0) return;
                        confirmIncomeM.mutate(n);
                      }}
                    >
                      Amount changed
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    No expected income set. Add one from{" "}
                    <Link to="/settings" className="text-primary hover:underline">
                      Settings
                    </Link>
                    .
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Projected balance before next income
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{formatEGP(projectedEnd)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                After {formatEGP(totalCommitted)} of upcoming commitments.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={balanceOpen} onOpenChange={setBalanceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update current balance</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Missed some transactions? Enter your current available balance and we'll recalculate
            your forecast — no need to add every missing entry.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="nb">New balance (EGP)</Label>
            <Input
              id="nb"
              type="number"
              value={balanceInput}
              onChange={(e) => setBalanceInput(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBalanceOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const n = Number(balanceInput);
                if (!Number.isFinite(n)) {
                  toast.error("Enter a valid number");
                  return;
                }
                correctM.mutate(n);
              }}
              disabled={correctM.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
