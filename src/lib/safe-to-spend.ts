export type Confidence = "high" | "medium" | "low";

export type OpenCommitment = {
  id: string;
  due_date: string;
  expected_amount: number;
  actual_amount: number | null;
  status: "expected" | "confirmed" | "delayed" | "skipped";
  name?: string;
};

export type SafeToSpendInput = {
  currentBalance: number | null;
  balanceUpdatedAt: string | null;
  nextIncomeDate: string | null;
  nextIncomeAmount: number | null;
  flexAmount: number | null;
  flexFrequency: "daily" | "weekly" | "monthly" | null;
  openCommitments: OpenCommitment[];
};

export type SafeToSpendResult = {
  dailyAmount: number;
  daysUntilIncome: number;
  committed: number;
  flexTotal: number;
  projectedBuffer: number;
  confidence: Confidence;
  confidenceReasons: string[];
  breakdown: string[];
  hasBaseline: boolean;
};

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000);
}

export function computeSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const balance = Number(input.currentBalance ?? 0);
  const hasBaseline = input.currentBalance != null;

  const target = input.nextIncomeDate
    ? new Date(input.nextIncomeDate + "T00:00:00")
    : new Date(today.getTime() + 30 * 86400000);
  const daysUntilIncome = Math.max(1, daysBetween(today, target));

  let committed = 0;
  for (const c of input.openCommitments) {
    if (c.status === "skipped") continue;
    const due = new Date(c.due_date + "T00:00:00");
    if (due > target) continue;
    if (c.status === "confirmed") continue; // already applied to balance
    committed += Number(c.actual_amount ?? c.expected_amount);
  }

  const flexAmt = Number(input.flexAmount ?? 0);
  const flexDaily =
    input.flexFrequency === "weekly"
      ? flexAmt / 7
      : input.flexFrequency === "monthly"
        ? flexAmt / 30
        : flexAmt;
  const flexTotal = flexDaily * daysUntilIncome;

  const available = balance - committed;
  const dailyAmount = hasBaseline ? Math.max(0, available / daysUntilIncome) : 0;
  const projectedBuffer = available - flexTotal;

  const reasons: string[] = [];
  let confidence: Confidence = "high";

  const daysSince = input.balanceUpdatedAt
    ? Math.max(0, daysBetween(new Date(input.balanceUpdatedAt), today))
    : Infinity;
  if (!hasBaseline) {
    confidence = "low";
    reasons.push("No current balance set");
  } else if (daysSince > 10) {
    confidence = "low";
    reasons.push(`Balance last updated ${Number.isFinite(daysSince) ? daysSince : "?"} days ago`);
  } else if (daysSince > 3) {
    confidence = "medium";
    reasons.push(`Balance updated ${daysSince} days ago`);
  }

  if (!input.nextIncomeDate) {
    if (confidence === "high") confidence = "medium";
    reasons.push("No expected income date set");
  }
  if (!input.flexAmount) {
    reasons.push("No everyday spending estimate yet");
  }
  const pastDue = input.openCommitments.filter(
    (c) => c.status === "expected" && new Date(c.due_date + "T00:00:00") < today,
  ).length;
  if (pastDue > 0) {
    confidence = "low";
    reasons.push(`${pastDue} commitment${pastDue === 1 ? "" : "s"} need confirmation`);
  }

  const breakdown = [
    `Current balance: ${balance.toFixed(0)}`,
    `− Upcoming commitments: ${committed.toFixed(0)}`,
    `= Available: ${(available).toFixed(0)}`,
    `÷ ${daysUntilIncome} day${daysUntilIncome === 1 ? "" : "s"} until next income`,
    `= ${dailyAmount.toFixed(0)}/day`,
  ];

  return {
    dailyAmount,
    daysUntilIncome,
    committed,
    flexTotal,
    projectedBuffer,
    confidence,
    confidenceReasons: reasons,
    breakdown,
    hasBaseline,
  };
}
