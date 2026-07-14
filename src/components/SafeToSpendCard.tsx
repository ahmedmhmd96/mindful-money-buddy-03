import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ShieldCheck,
  ShieldAlert,
  Shield,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  HelpCircle,
} from "lucide-react";
import { formatEGP } from "@/lib/format";
import type { FinancialPosition } from "@/lib/financial-position";

const confidenceStyles = {
  high: { icon: ShieldCheck, className: "bg-emerald-100 text-emerald-800", label: "High confidence" },
  medium: { icon: Shield, className: "bg-amber-100 text-amber-800", label: "Medium confidence" },
  low: { icon: ShieldAlert, className: "bg-rose-100 text-rose-800", label: "Low confidence" },
} as const;

const healthStyles = {
  safe: { icon: CheckCircle2, className: "bg-emerald-100 text-emerald-900 border-emerald-300", label: "Safe" },
  tight: { icon: AlertTriangle, className: "bg-amber-100 text-amber-900 border-amber-300", label: "Tight" },
  at_risk: { icon: AlertOctagon, className: "bg-rose-100 text-rose-900 border-rose-300", label: "At risk" },
  unknown: { icon: HelpCircle, className: "bg-muted text-foreground border-muted", label: "Unknown" },
} as const;

export function SafeToSpendCard({
  position,
  onUpdateBalance,
}: {
  position: FinancialPosition;
  onUpdateBalance?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const c = confidenceStyles[position.forecastConfidence];
  const h = healthStyles[position.financialHealth];
  const ConfidenceIcon = c.icon;
  const HealthIcon = h.icon;

  return (
    <Card className={`border-2 ${h.className.split(" ").slice(-1)[0]} bg-gradient-to-br from-primary/5 to-transparent`}>
      <CardContent className="p-6">
        <div className={`mb-4 flex items-center gap-2 rounded-md border px-3 py-2 ${h.className}`}>
          <HealthIcon className="h-5 w-5" />
          <div>
            <div className="text-sm font-semibold">{h.label}</div>
            <div className="text-xs opacity-90">{position.healthReason}</div>
          </div>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-muted-foreground">Safe to spend today</div>
            {position.hasBaseline ? (
              <>
                <div className="mt-1 text-4xl font-semibold tracking-tight">
                  {formatEGP(position.safeToSpendPerDay)}
                  <span className="ml-1 text-base font-normal text-muted-foreground">/day</span>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  For the next {position.remainingDays} day{position.remainingDays === 1 ? "" : "s"}
                  {position.nextIncomeDate ? ` (until income on ${position.nextIncomeDate})` : ""}
                </div>
                {position.projectedShortfall > 0 && (
                  <div className="mt-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    Projected shortfall of {formatEGP(position.projectedShortfall)} before your next income.
                  </div>
                )}
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
            <ConfidenceIcon className="h-3.5 w-3.5" />
            {c.label}
          </Badge>
        </div>

        {onUpdateBalance && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={onUpdateBalance}>
              {position.hasBaseline ? "Update current balance" : "Set current balance"}
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
            <ul className="space-y-1">
              {position.calculationBreakdown.map((b, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    {b.sign ? `${b.sign} ` : ""}
                    {b.label}
                  </span>
                  {b.amount != null && (
                    <span className={b.sign === "=" ? "font-semibold" : ""}>
                      {formatEGP(b.amount)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {position.confidenceReasons.length > 0 && (
              <div className="mt-3">
                <div className="font-medium text-foreground">To improve forecast confidence:</div>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {position.confidenceReasons.map((r, i) => (
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
