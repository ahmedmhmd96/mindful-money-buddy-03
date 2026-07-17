import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
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
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  correctBalance,
  confirmIncome,
  confirmOccurrence,
  getSnapshot,
} from "@/lib/snapshot.functions";
import type { CommitmentInput } from "@/lib/financial-position";
import { SafeToSpendCard } from "@/components/SafeToSpendCard";
import { AccuracyBadge } from "@/components/AccuracyBadge";
import { OcrIntakeSheet } from "@/components/OcrIntakeSheet";
import { formatEGP } from "@/lib/format";
import { ScanLine } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Safe to spend — My Budget" }] }),
  component: Dashboard,
});

type OccRow = {
  id: string;
  due_date: string;
  expected_amount: number;
  status: "expected" | "confirmed" | "delayed" | "skipped";
  recurring_items?: { name?: string } | null;
};

function Dashboard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const snapFn = useServerFn(getSnapshot);
  const correctFn = useServerFn(correctBalance);
  const confirmOccFn = useServerFn(confirmOccurrence);
  const confirmIncomeFn = useServerFn(confirmIncome);

  const snapQ = useQuery({ queryKey: ["snapshot"], queryFn: () => snapFn({ data: undefined }) });

  const settings = snapQ.data?.settings;
  const position = snapQ.data?.position;

  useEffect(() => {
    if (!snapQ.data) return;
    if (!settings?.onboarded_at && settings?.current_balance == null) {
      navigate({ to: "/onboarding" });
    }
  }, [snapQ.data, settings, navigate]);

  const [balanceOpen, setBalanceOpen] = useState(false);
  const [balanceInput, setBalanceInput] = useState("");

  const tomorrowISO = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [delayFor, setDelayFor] = useState<{ id: string; name: string } | null>(null);
  const [delayDate, setDelayDate] = useState<string>(tomorrowISO);

  // "Paid" dialog — captures the reflected-in-balance question so we never
  // double-deduct a payment that already appears in the balance.
  const [paidFor, setPaidFor] = useState<
    | { id: string; name: string; amount: number; mode: "paid" | "changed"; changedAmount?: string }
    | null
  >(null);

  // Income "Not yet" dialog — captures a revised expected date instead of
  // silently assuming the income arrived.
  const [incomeNotYet, setIncomeNotYet] = useState<{ date: string } | null>(null);

  // Track previous safe-to-spend for impact toasts.
  const [prevSafe, setPrevSafe] = useState<number | null>(null);

  const correctM = useMutation({
    mutationFn: (v: number) => correctFn({ data: { new_balance: v } }),
    onSuccess: async (res) => {
      const before = position?.safeToSpendPerDay ?? null;
      qc.invalidateQueries({ queryKey: ["snapshot"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      setBalanceOpen(false);
      const fresh = await snapFn({ data: undefined });
      const after = fresh.position?.safeToSpendPerDay ?? null;
      toast.success(
        `Balance ${res.previous != null ? `${formatEGP(res.previous)} → ` : ""}${formatEGP(res.next)}. ` +
          (before != null && after != null
            ? `Safe daily spend: ${formatEGP(before)} → ${formatEGP(after)}`
            : "Recalculated."),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmOccM = useMutation({
    mutationFn: (v: Parameters<typeof confirmOccFn>[0]["data"]) => confirmOccFn({ data: v }),
    onSuccess: async () => {
      const before = prevSafe ?? position?.safeToSpendPerDay ?? null;
      qc.invalidateQueries({ queryKey: ["snapshot"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      const fresh = await snapFn({ data: undefined });
      const after = fresh.position?.safeToSpendPerDay ?? null;
      if (before != null && after != null) {
        toast.success(`Safe daily spend: ${formatEGP(before)} → ${formatEGP(after)}`);
      } else {
        toast.success("Commitment updated.");
      }
      setPrevSafe(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmIncomeM = useMutation({
    mutationFn: (v: Parameters<typeof confirmIncomeFn>[0]["data"]) =>
      confirmIncomeFn({ data: v }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["snapshot"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      if (res.action === "not_yet") toast.success("Expected income moved. Safe-to-spend recalculated.");
      else if (res.action === "skipped") toast.success("Expected income cleared.");
      else toast.success(`Income confirmed. Balance updated by ${formatEGP(res.amount ?? 0)}.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!snapQ.data || !position) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const commitmentName = (o: OccRow) => o.recurring_items?.name ?? "Commitment";

  const orderedForList: CommitmentInput[] = [
    ...position.buckets.overdueUnresolved,
    ...position.buckets.dueToday,
    ...position.buckets.beforeNextIncome,
  ];
  const afterIncome = position.buckets.afterNextIncome;

  const bucketLabel = (c: CommitmentInput): { text: string; className: string } | null => {
    if (position.buckets.overdueUnresolved.some((x) => x.id === c.id))
      return { text: "overdue", className: "bg-rose-100 text-rose-800" };
    if (position.buckets.dueToday.some((x) => x.id === c.id))
      return { text: "today", className: "bg-amber-100 text-amber-800" };
    if (c.status === "delayed")
      return { text: "delayed", className: "bg-amber-100 text-amber-800" };
    return null;
  };

  const startPaid = (c: CommitmentInput) => {
    setPrevSafe(position.safeToSpendPerDay);
    setPaidFor({
      id: c.id,
      name: c.name ?? "Commitment",
      amount: Number(c.expected_amount),
      mode: "paid",
    });
  };

  const startChanged = (c: CommitmentInput) => {
    setPrevSafe(position.safeToSpendPerDay);
    setPaidFor({
      id: c.id,
      name: c.name ?? "Commitment",
      amount: Number(c.expected_amount),
      mode: "changed",
      changedAmount: String(c.expected_amount),
    });
  };

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Your money right now</h1>
        <p className="text-sm text-muted-foreground">All amounts in EGP.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SafeToSpendCard
            position={position}
            onUpdateBalance={() => {
              setBalanceInput(String(settings?.current_balance ?? ""));
              setBalanceOpen(true);
            }}
          />
        </div>

        <div className="space-y-4">
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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Projected balance before next income
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-semibold ${position.projectedBalance < 0 ? "text-rose-700" : ""}`}
              >
                {formatEGP(position.projectedBalance)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                After {formatEGP(position.mandatoryCommitments)} of upcoming commitments
                {position.essentialReserveRemaining > 0
                  ? ` + ${formatEGP(position.essentialReserveRemaining)} essential reserve`
                  : ""}
                .
              </div>
              {position.projectedShortfall > 0 && (
                <div className="mt-2 text-xs text-rose-700">
                  Shortfall of {formatEGP(position.projectedShortfall)}.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Upcoming commitments</CardTitle>
            <AccuracyBadge kind="expected" />
          </CardHeader>
          <CardContent>
            {orderedForList.length === 0 && afterIncome.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing coming up. Add a commitment from{" "}
                <Link to="/budget" className="text-primary hover:underline">
                  Budget
                </Link>
                .
              </p>
            ) : (
              <>
                <ul className="divide-y">
                  {orderedForList.slice(0, 10).map((c) => {
                    const label = bucketLabel(c);
                    return (
                      <li key={c.id} className="py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium">{c.name ?? "Commitment"}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatEGP(Number(c.expected_amount))} · due {c.due_date}
                              {label && (
                                <span
                                  className={`ml-2 rounded px-1.5 py-0.5 ${label.className}`}
                                >
                                  {label.text}
                                </span>
                              )}
                              {c.priority && c.priority !== "mandatory" && (
                                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-foreground">
                                  {c.priority}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button size="sm" variant="secondary" onClick={() => startPaid(c)}>
                              Paid
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => startChanged(c)}>
                              Changed
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                const base = c.due_date < tomorrowISO ? tomorrowISO : c.due_date;
                                const d = new Date(base + "T00:00:00");
                                d.setDate(d.getDate() + 7);
                                setDelayDate(d.toISOString().slice(0, 10));
                                setPrevSafe(position.safeToSpendPerDay);
                                setDelayFor({ id: c.id, name: c.name ?? "Commitment" });
                              }}
                            >
                              Delay
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setPrevSafe(position.safeToSpendPerDay);
                                confirmOccM.mutate({ id: c.id, action: "skipped" });
                              }}
                            >
                              Skip
                            </Button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {afterIncome.length > 0 && (
                  <>
                    <div className="mt-4 mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      After next income
                    </div>
                    <ul className="divide-y text-sm text-muted-foreground">
                      {afterIncome.slice(0, 6).map((c) => (
                        <li key={c.id} className="py-2 flex justify-between">
                          <span>{c.name ?? "Commitment"} · {c.due_date}</span>
                          <span>{formatEGP(Number(c.expected_amount))}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>

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
                {settings.next_income_date && settings.next_income_date <= today && (
                  <div className="mt-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Your expected income date has arrived. Did it come in?
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => confirmIncomeM.mutate({ action: "arrived" })}
                  >
                    Yes, it arrived
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const v = window.prompt("Actual amount received (EGP):");
                      const n = Number(v);
                      if (!v || !Number.isFinite(n) || n <= 0) return;
                      confirmIncomeM.mutate({ action: "changed", actual_amount: n });
                    }}
                  >
                    Amount changed
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const base = settings.next_income_date ?? today;
                      const d = new Date(base + "T00:00:00");
                      d.setDate(d.getDate() + 1);
                      setIncomeNotYet({ date: d.toISOString().slice(0, 10) });
                    }}
                  >
                    Not yet
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => confirmIncomeM.mutate({ action: "skipped" })}
                  >
                    Skip
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No expected income set. Add one from{" "}
                <Link to="/settings" className="text-primary hover:underline">
                  Settings
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Paid / Changed dialog — asks the reflected-in-balance question */}
      <Dialog open={!!paidFor} onOpenChange={(o) => !o && setPaidFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {paidFor?.mode === "changed" ? "Update amount for" : "Confirm payment for"}{" "}
              {paidFor?.name}
            </DialogTitle>
            <DialogDescription>
              Has this payment already been deducted from the balance shown in the app?
            </DialogDescription>
          </DialogHeader>
          {paidFor?.mode === "changed" && (
            <div className="space-y-1.5">
              <Label htmlFor="ca">Actual amount (EGP)</Label>
              <Input
                id="ca"
                type="number"
                value={paidFor.changedAmount ?? ""}
                onChange={(e) =>
                  setPaidFor((p) => (p ? { ...p, changedAmount: e.target.value } : p))
                }
                autoFocus
              />
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              onClick={() => {
                if (!paidFor) return;
                const amt =
                  paidFor.mode === "changed"
                    ? Number(paidFor.changedAmount)
                    : paidFor.amount;
                if (!Number.isFinite(amt) || amt <= 0) {
                  toast.error("Enter a valid amount");
                  return;
                }
                confirmOccM.mutate(
                  {
                    id: paidFor.id,
                    action: paidFor.mode,
                    actual_amount: paidFor.mode === "changed" ? amt : undefined,
                    reflected: false,
                  },
                  { onSuccess: () => setPaidFor(null) },
                );
              }}
              disabled={confirmOccM.isPending}
            >
              No, deduct it now
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (!paidFor) return;
                const amt =
                  paidFor.mode === "changed"
                    ? Number(paidFor.changedAmount)
                    : paidFor.amount;
                if (!Number.isFinite(amt) || amt <= 0) {
                  toast.error("Enter a valid amount");
                  return;
                }
                confirmOccM.mutate(
                  {
                    id: paidFor.id,
                    action: paidFor.mode,
                    actual_amount: paidFor.mode === "changed" ? amt : undefined,
                    reflected: true,
                  },
                  { onSuccess: () => setPaidFor(null) },
                );
              }}
              disabled={confirmOccM.isPending}
            >
              Yes, already reflected
            </Button>
            <Button variant="ghost" onClick={() => setPaidFor(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delay dialog */}
      <Dialog open={!!delayFor} onOpenChange={(o) => !o && setDelayFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delay {delayFor?.name}</DialogTitle>
            <DialogDescription>
              Pick the new due date. If it falls after your next income, it won't affect
              today's safe-to-spend anymore.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="dd">New due date</Label>
            <Input
              id="dd"
              type="date"
              min={tomorrowISO}
              value={delayDate}
              onChange={(e) => setDelayDate(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDelayFor(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!delayFor) return;
                if (!delayDate || delayDate < tomorrowISO) {
                  toast.error("Pick a future date");
                  return;
                }
                confirmOccM.mutate(
                  { id: delayFor.id, action: "delayed", new_due_date: delayDate },
                  { onSuccess: () => setDelayFor(null) },
                );
              }}
              disabled={confirmOccM.isPending}
            >
              Delay to this date
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Income "not yet" dialog */}
      <Dialog open={!!incomeNotYet} onOpenChange={(o) => !o && setIncomeNotYet(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revised expected income date</DialogTitle>
            <DialogDescription>
              We'll keep it as expected and recalculate the planning window.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="nid">New expected date</Label>
            <Input
              id="nid"
              type="date"
              min={today}
              value={incomeNotYet?.date ?? ""}
              onChange={(e) =>
                setIncomeNotYet((s) => (s ? { ...s, date: e.target.value } : s))
              }
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIncomeNotYet(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!incomeNotYet?.date) return;
                confirmIncomeM.mutate(
                  { action: "not_yet", new_date: incomeNotYet.date },
                  { onSuccess: () => setIncomeNotYet(null) },
                );
              }}
            >
              Save new date
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Balance update dialog */}
      <Dialog open={balanceOpen} onOpenChange={setBalanceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update current balance</DialogTitle>
            <DialogDescription>
              Missed some transactions? Enter your current available balance and we'll
              recalculate — no need to add every missing entry. A balance-correction event
              is recorded for audit; no fake income or expense is created.
            </DialogDescription>
          </DialogHeader>
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
