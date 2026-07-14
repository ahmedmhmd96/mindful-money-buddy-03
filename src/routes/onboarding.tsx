import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
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
import { Trash2, Wallet, ArrowRight, ArrowLeft, Check } from "lucide-react";
import {
  addCommitment,
  getSnapshot,
  updateSnapshot,
} from "@/lib/snapshot.functions";
import { formatEGP } from "@/lib/format";
import { computeSafeToSpend } from "@/lib/safe-to-spend";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Get started — My Budget" }] }),
  component: OnboardingPage,
});

const TEMPLATES = [
  "Rent",
  "Installment",
  "Credit card",
  "Utilities",
  "Subscription",
  "Education",
  "Gam'eya",
  "Debt payment",
  "Other",
];

type Commitment = { id: string; name: string; amount: string; due_date: string; template: string };

function OnboardingPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const snapFn = useServerFn(getSnapshot);
  const updateFn = useServerFn(updateSnapshot);
  const addFn = useServerFn(addCommitment);

  const snapQ = useQuery({ queryKey: ["snapshot"], queryFn: () => snapFn({ data: undefined }) });

  const [step, setStep] = useState(1);
  const [balance, setBalance] = useState("");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeDate, setIncomeDate] = useState("");
  const [incomeLabel, setIncomeLabel] = useState("Salary");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [flexAmount, setFlexAmount] = useState("");
  const [flexFreq, setFlexFreq] = useState<"daily" | "weekly" | "monthly">("daily");

  const updateM = useMutation({
    mutationFn: (d: Parameters<typeof updateFn>[0]["data"]) => updateFn({ data: d }),
    onError: (e: Error) => toast.error(e.message),
  });
  const addM = useMutation({
    mutationFn: (d: Parameters<typeof addFn>[0]["data"]) => addFn({ data: d }),
  });

  function addCommitmentRow(template: string) {
    setCommitments((p) => [
      ...p,
      { id: crypto.randomUUID(), name: template, amount: "", due_date: today, template },
    ]);
  }

  async function saveStep1() {
    const b = Number(balance);
    if (!Number.isFinite(b)) {
      toast.error("Enter your current balance");
      return;
    }
    await updateM.mutateAsync({ current_balance: b });
    setStep(2);
  }
  async function saveStep2() {
    if (!incomeAmount || !incomeDate) {
      // Allow skipping — but write nulls
      await updateM.mutateAsync({
        next_income_amount: null,
        next_income_date: null,
        next_income_label: null,
      });
    } else {
      await updateM.mutateAsync({
        next_income_amount: Number(incomeAmount),
        next_income_date: incomeDate,
        next_income_label: incomeLabel || "Income",
      });
    }
    setStep(3);
  }
  async function saveStep3() {
    for (const c of commitments) {
      const amt = Number(c.amount);
      if (!c.name || !Number.isFinite(amt) || amt <= 0 || !c.due_date) continue;
      await addM.mutateAsync({
        name: c.name,
        amount: amt,
        due_date: c.due_date,
        template: c.template,
      });
    }
    setStep(4);
  }
  async function saveStep4() {
    const a = Number(flexAmount);
    if (Number.isFinite(a) && a > 0) {
      await updateM.mutateAsync({ flex_spend_amount: a, flex_spend_frequency: flexFreq });
    }
    await updateM.mutateAsync({ mark_onboarded: true });
    await qc.invalidateQueries({ queryKey: ["snapshot"] });
    setStep(5);
  }

  // Live preview of safe-to-spend using the not-yet-saved inputs at step 5.
  const preview = useMemo(() => {
    const openCommitments = commitments
      .filter((c) => Number(c.amount) > 0 && c.due_date)
      .map((c) => ({
        id: c.id,
        due_date: c.due_date,
        expected_amount: Number(c.amount),
        actual_amount: null,
        status: "expected" as const,
      }));
    return computeSafeToSpend({
      currentBalance: Number(balance) || 0,
      balanceUpdatedAt: new Date().toISOString(),
      nextIncomeDate: incomeDate || null,
      nextIncomeAmount: Number(incomeAmount) || null,
      flexAmount: Number(flexAmount) || null,
      flexFrequency: flexFreq,
      openCommitments,
    });
  }, [balance, incomeDate, incomeAmount, flexAmount, flexFreq, commitments]);

  const liveSafe = snapQ.data?.safe ?? preview;
  const totalCommitments = commitments.reduce((s, c) => s + (Number(c.amount) || 0), 0);

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-center gap-2 text-primary">
          <Wallet className="h-5 w-5" />
          <span className="font-semibold">Financial snapshot</span>
          <span className="ml-auto text-xs text-muted-foreground">Step {step} of 5</span>
        </div>

        <Card>
          {step === 1 && (
            <>
              <CardHeader>
                <CardTitle>How much money is currently available to you?</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Include the money you consider available across cash, bank accounts, and wallets.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="bal">Current available balance (EGP)</Label>
                  <Input
                    id="bal"
                    type="number"
                    inputMode="decimal"
                    value={balance}
                    onChange={(e) => setBalance(e.target.value)}
                    placeholder="e.g. 12000"
                    autoFocus
                  />
                </div>
                <Button onClick={saveStep1} className="w-full" disabled={updateM.isPending}>
                  Continue <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </CardContent>
            </>
          )}

          {step === 2 && (
            <>
              <CardHeader>
                <CardTitle>When is your next expected income?</CardTitle>
                <p className="text-sm text-muted-foreground">You can skip this and add it later.</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label htmlFor="ia">Amount (EGP)</Label>
                  <Input
                    id="ia"
                    type="number"
                    value={incomeAmount}
                    onChange={(e) => setIncomeAmount(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="id">Expected date</Label>
                  <Input
                    id="id"
                    type="date"
                    value={incomeDate}
                    onChange={(e) => setIncomeDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="il">Label (optional)</Label>
                  <Input
                    id="il"
                    value={incomeLabel}
                    onChange={(e) => setIncomeLabel(e.target.value)}
                    placeholder="Salary, freelance payment…"
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep(1)}>
                    <ArrowLeft className="mr-1 h-4 w-4" /> Back
                  </Button>
                  <Button onClick={saveStep2} className="flex-1" disabled={updateM.isPending}>
                    Continue <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {step === 3 && (
            <>
              <CardHeader>
                <CardTitle>What payments must happen before then?</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Tap a template to add a commitment. You can add as many as you need.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {TEMPLATES.map((t) => (
                    <Button
                      key={t}
                      variant="outline"
                      size="sm"
                      onClick={() => addCommitmentRow(t)}
                    >
                      + {t}
                    </Button>
                  ))}
                </div>

                {commitments.length === 0 && (
                  <p className="text-sm text-muted-foreground">No commitments yet.</p>
                )}
                <ul className="space-y-2">
                  {commitments.map((c, idx) => (
                    <li key={c.id} className="rounded-md border p-3">
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          value={c.name}
                          onChange={(e) =>
                            setCommitments((p) =>
                              p.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)),
                            )
                          }
                          placeholder="Name"
                        />
                        <Input
                          type="number"
                          placeholder="Amount"
                          value={c.amount}
                          onChange={(e) =>
                            setCommitments((p) =>
                              p.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)),
                            )
                          }
                        />
                        <Input
                          type="date"
                          value={c.due_date}
                          onChange={(e) =>
                            setCommitments((p) =>
                              p.map((x, i) => (i === idx ? { ...x, due_date: e.target.value } : x)),
                            )
                          }
                          className="col-span-2"
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{c.template}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setCommitments((p) => p.filter((x) => x.id !== c.id))
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
                {totalCommitments > 0 && (
                  <div className="text-sm text-muted-foreground">
                    Total upcoming commitments: {formatEGP(totalCommitments)}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep(2)}>
                    <ArrowLeft className="mr-1 h-4 w-4" /> Back
                  </Button>
                  <Button onClick={saveStep3} className="flex-1" disabled={addM.isPending}>
                    Continue <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {step === 4 && (
            <>
              <CardHeader>
                <CardTitle>How much do you usually spend on everyday needs?</CardTitle>
                <p className="text-sm text-muted-foreground">
                  A rough number is fine — you can refine it later.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label htmlFor="fa">Amount (EGP)</Label>
                  <Input
                    id="fa"
                    type="number"
                    value={flexAmount}
                    onChange={(e) => setFlexAmount(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Frequency</Label>
                  <Select value={flexFreq} onValueChange={(v) => setFlexFreq(v as typeof flexFreq)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">per day</SelectItem>
                      <SelectItem value="weekly">per week</SelectItem>
                      <SelectItem value="monthly">per month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep(3)}>
                    <ArrowLeft className="mr-1 h-4 w-4" /> Back
                  </Button>
                  <Button onClick={saveStep4} className="flex-1" disabled={updateM.isPending}>
                    Finish <Check className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {step === 5 && (
            <>
              <CardHeader>
                <CardTitle>You're all set</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md border bg-primary/5 p-4 text-center">
                  <div className="text-sm text-muted-foreground">You can safely spend approximately</div>
                  <div className="mt-1 text-4xl font-semibold">
                    {formatEGP(liveSafe.dailyAmount)}
                    <span className="ml-1 text-base font-normal text-muted-foreground">/day</span>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    until your next expected income ({liveSafe.daysUntilIncome} days)
                  </div>
                </div>

                <ul className="space-y-1 text-sm text-muted-foreground">
                  {liveSafe.breakdown.map((b, i) => (
                    <li key={i}>• {b}</li>
                  ))}
                </ul>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => navigate({ to: "/settings" })}
                  >
                    Improve accuracy
                  </Button>
                  <Button className="flex-1" onClick={() => navigate({ to: "/" })}>
                    Go to dashboard
                  </Button>
                </div>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
