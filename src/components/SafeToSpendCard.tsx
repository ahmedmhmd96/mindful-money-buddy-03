import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ShieldCheck, ShieldAlert, Shield } from "lucide-react";
import { formatEGP } from "@/lib/format";
import type { SafeToSpendResult } from "@/lib/safe-to-spend";

const confidenceStyles = {
  high: { icon: ShieldCheck, className: "bg-emerald-100 text-emerald-800", label: "High confidence" },
  medium: { icon: Shield, className: "bg-amber-100 text-amber-800", label: "Medium confidence" },
  low: { icon: ShieldAlert, className: "bg-rose-100 text-rose-800", label: "Low confidence" },
} as const;

export function SafeToSpendCard({
  safe,
  nextIncomeDate,
  onUpdateBalance,
}: {
  safe: SafeToSpendResult;
  nextIncomeDate: string | null;
  onUpdateBalance?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const c = confidenceStyles[safe.confidence];
  const Icon = c.icon;

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-muted-foreground">Safe to spend today</div>
            {safe.hasBaseline ? (
              <>
                <div className="mt-1 text-4xl font-semibold tracking-tight">
                  {formatEGP(safe.dailyAmount)}
                  <span className="ml-1 text-base font-normal text-muted-foreground">/day</span>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  For the next {safe.daysUntilIncome} day{safe.daysUntilIncome === 1 ? "" : "s"}
                  {nextIncomeDate ? ` (until income on ${nextIncomeDate})` : ""}
                </div>
              </>
            ) : (
              <>
                <div className="mt-1 text-xl font-semibold">Set your current balance to begin</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Takes under a minute — we'll calculate your safe daily spend right away.
                </div>
              </>
            )}
          </div>
          <Badge className={`gap-1 border-0 ${c.className}`}>
            <Icon className="h-3.5 w-3.5" />
            {c.label}
          </Badge>
        </div>

        {onUpdateBalance && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={onUpdateBalance}>
              {safe.hasBaseline ? "Update current balance" : "Set current balance"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
              How is this calculated?
              <ChevronDown
                className={`ml-1 h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </Button>
          </div>
        )}

        {open && (
          <div className="mt-4 rounded-md border bg-card p-3 text-sm">
            <ul className="space-y-1 text-muted-foreground">
              {safe.breakdown.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            {safe.confidenceReasons.length > 0 && (
              <div className="mt-3">
                <div className="font-medium text-foreground">To improve accuracy:</div>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {safe.confidenceReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
