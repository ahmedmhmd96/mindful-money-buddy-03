/**
 * Centralized financial calculation engine.
 *
 * Every dashboard value (safe-to-spend, projected balance, upcoming totals,
 * remaining days, status, breakdown) MUST come from this function so that
 * different cards cannot display contradictory numbers.
 */

export type Priority = "mandatory" | "essential" | "optional";
export type OccurrenceStatus = "expected" | "confirmed" | "delayed" | "skipped";

export type CommitmentInput = {
  id: string;
  name?: string;
  due_date: string; // YYYY-MM-DD
  expected_amount: number;
  actual_amount: number | null;
  status: OccurrenceStatus;
  priority?: Priority; // defaults to "mandatory"
  reflected_in_balance?: boolean; // if true, already deducted from balance
};

export type EssentialActual = {
  amount: number;
  occurred_on: string; // YYYY-MM-DD
};

export type PositionInput = {
  asOfDate?: Date; // defaults today
  currentBalance: number | null;
  balanceUpdatedAt: string | null;
  nextIncomeDate: string | null;
  nextIncomeAmount: number | null;
  nextIncomeConfirmed?: boolean; // default false
  includeIncomeDay?: boolean; // default false → window = today..(income-1)
  // Essential-spending reserve (food/transport/utilities) as a periodic estimate.
  essentialAmount: number | null;
  essentialFrequency: "daily" | "weekly" | "monthly" | null;
  essentialUpdatedAt?: string | null;
  // Actual essential spending already logged inside the current window
  // — used to reduce the remaining reserve so we don't double-count.
  essentialActualsInWindow?: number;
  safetyBuffer: number | null;
  commitments: CommitmentInput[];
};

export type Confidence = "high" | "medium" | "low";
export type FinancialHealth = "safe" | "tight" | "at_risk" | "unknown";

export type CalculationBreakdown = {
  label: string;
  amount: number | null; // null => informational line only
  sign: "+" | "-" | "=" | null;
};

export type CommitmentBuckets = {
  overdueUnresolved: CommitmentInput[];
  dueToday: CommitmentInput[];
  beforeNextIncome: CommitmentInput[]; // mandatory+essential, unresolved
  afterNextIncome: CommitmentInput[];
};

export type FinancialPosition = {
  asOfDate: string;
  currentBalance: number;
  hasBaseline: boolean;
  nextIncomeAmount: number | null;
  nextIncomeDate: string | null;
  nextIncomeConfirmed: boolean;
  planningWindowStart: string;
  planningWindowEnd: string; // inclusive last spend day
  remainingDays: number;
  mandatoryCommitments: number;
  essentialSpendingReserve: number;
  essentialReserveRemaining: number;
  safetyBuffer: number;
  spendableAmount: number;
  safeToSpendPerDay: number;
  projectedBalance: number; // before next income
  projectedShortfall: number; // 0 if positive
  forecastConfidence: Confidence;
  confidenceReasons: string[];
  financialHealth: FinancialHealth;
  healthReason: string;
  calculationBreakdown: CalculationBreakdown[];
  buckets: CommitmentBuckets;
};

// --- helpers ---
const MS_DAY = 86400000;

function toDate(iso: string): Date {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
function daysInclusive(from: Date, toInclusive: Date): number {
  return Math.max(0, Math.round((toInclusive.getTime() - from.getTime()) / MS_DAY) + 1);
}
// Decimal-safe rounding at 2 dp (currency-safe arithmetic).
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeToPerDay(amount: number, freq: "daily" | "weekly" | "monthly"): number {
  if (freq === "daily") return amount;
  if (freq === "weekly") return amount / 7;
  return amount / 30; // monthly
}

// --- main ---
export function calculateFinancialPosition(input: PositionInput): FinancialPosition {
  const asOf = startOfDay(input.asOfDate ?? new Date());
  const today = asOf;
  const todayISO = isoDate(today);

  const hasBaseline = input.currentBalance != null;
  const currentBalance = Number(input.currentBalance ?? 0);
  const includeIncomeDay = !!input.includeIncomeDay;

  // Planning window
  let windowEnd: Date;
  let hasIncomeWindow = false;
  if (input.nextIncomeDate) {
    const incomeDate = toDate(input.nextIncomeDate);
    if (includeIncomeDay) {
      windowEnd = incomeDate;
    } else {
      windowEnd = new Date(incomeDate.getTime() - MS_DAY);
    }
    if (windowEnd < today) windowEnd = today;
    hasIncomeWindow = true;
  } else {
    // Fallback: 14 day short horizon (avoid "infinite" daily amount).
    windowEnd = new Date(today.getTime() + 13 * MS_DAY);
  }
  const remainingDays = Math.max(1, daysInclusive(today, windowEnd));

  // Bucket commitments
  const buckets: CommitmentBuckets = {
    overdueUnresolved: [],
    dueToday: [],
    beforeNextIncome: [],
    afterNextIncome: [],
  };
  let mandatory = 0;
  const skipDoubleDeduct = (c: CommitmentInput) =>
    c.status === "confirmed" || c.status === "skipped" || c.reflected_in_balance === true;

  for (const c of input.commitments) {
    if (c.status === "skipped") continue; // never impacts totals or lists
    const due = toDate(c.due_date);
    const priority: Priority = c.priority ?? "mandatory";

    // Bucketing for UI ordering
    if (due < today && c.status === "expected") {
      buckets.overdueUnresolved.push(c);
    } else if (isoDate(due) === todayISO) {
      buckets.dueToday.push(c);
    } else if (due <= windowEnd) {
      buckets.beforeNextIncome.push(c);
    } else {
      buckets.afterNextIncome.push(c);
    }

    // Totals: only unpaid, unreflected mandatory items inside the window
    if (skipDoubleDeduct(c)) continue;
    if (due > windowEnd) continue;
    if (priority !== "mandatory") continue; // essential handled via reserve
    mandatory += Number(c.actual_amount ?? c.expected_amount);
  }

  // Essential spending reserve, prorated to the window
  let essentialReserve = 0;
  if (input.essentialAmount && input.essentialFrequency) {
    essentialReserve =
      normalizeToPerDay(Number(input.essentialAmount), input.essentialFrequency) *
      remainingDays;
  }
  const essentialActuals = Math.max(0, input.essentialActualsInWindow ?? 0);
  const essentialReserveRemaining = Math.max(0, essentialReserve - essentialActuals);

  const safetyBuffer = Math.max(0, Number(input.safetyBuffer ?? 0));

  // Spendable = balance − mandatory − remaining essential reserve − buffer
  const spendableRaw =
    currentBalance - mandatory - essentialReserveRemaining - safetyBuffer;
  const spendableAmount = round2(spendableRaw);
  const safeToSpendPerDay = hasBaseline
    ? round2(Math.max(0, spendableAmount) / remainingDays)
    : 0;

  // Projected balance (before next income) = balance − remaining mandatory − remaining essential reserve
  const projectedBalance = round2(
    currentBalance - mandatory - essentialReserveRemaining,
  );
  const projectedShortfall = projectedBalance < 0 ? round2(-projectedBalance) : 0;

  // Confidence — reflects DATA FRESHNESS ONLY. Never derived from balance sign.
  const reasons: string[] = [];
  let confidence: Confidence = "high";
  const balanceAgeDays = input.balanceUpdatedAt
    ? Math.max(0, Math.round((today.getTime() - toDate(input.balanceUpdatedAt).getTime()) / MS_DAY))
    : Infinity;
  if (!hasBaseline) {
    confidence = "low";
    reasons.push("No current balance set");
  } else if (balanceAgeDays > 7) {
    confidence = "low";
    reasons.push(`Balance last updated ${Number.isFinite(balanceAgeDays) ? balanceAgeDays : "?"} days ago`);
  } else if (balanceAgeDays > 2) {
    if (confidence === "high") confidence = "medium";
    reasons.push(`Balance updated ${balanceAgeDays} days ago`);
  }
  if (!hasIncomeWindow) {
    confidence = "low";
    reasons.push("No expected income date set");
  } else if (input.nextIncomeConfirmed === false && toDate(input.nextIncomeDate!) < today) {
    confidence = "low";
    reasons.push("Expected income date has passed without confirmation");
  }
  const overdueCount = buckets.overdueUnresolved.length;
  if (overdueCount > 1) {
    confidence = "low";
    reasons.push(`${overdueCount} commitments are overdue and unresolved`);
  } else if (overdueCount === 1) {
    if (confidence === "high") confidence = "medium";
    reasons.push("1 commitment is overdue and unresolved");
  }
  const essAge = input.essentialUpdatedAt
    ? Math.max(0, Math.round((today.getTime() - toDate(input.essentialUpdatedAt).getTime()) / MS_DAY))
    : Infinity;
  if (input.essentialAmount == null) {
    if (confidence === "high") confidence = "medium";
    reasons.push("No everyday spending estimate yet");
  } else if (essAge > 30) {
    confidence = "low";
    reasons.push(`Spending estimate is ${Number.isFinite(essAge) ? essAge : "?"} days old`);
  } else if (essAge > 14) {
    if (confidence === "high") confidence = "medium";
    reasons.push(`Spending estimate is ${essAge} days old`);
  }

  // Financial health — independent of confidence.
  let health: FinancialHealth;
  let healthReason: string;
  if (!hasBaseline) {
    health = "unknown";
    healthReason = "Set your current balance to see your position.";
  } else if (projectedBalance < 0) {
    health = "at_risk";
    healthReason = `Projected shortfall of ${projectedShortfall.toFixed(0)} EGP before next income.`;
  } else if (safetyBuffer > 0 && projectedBalance < safetyBuffer) {
    health = "tight";
    healthReason = `Projected balance is below your ${safetyBuffer.toFixed(0)} EGP safety buffer.`;
  } else if (spendableAmount <= 0) {
    health = "tight";
    healthReason = "No flexible spending capacity in this window.";
  } else {
    health = "safe";
    healthReason = `Flexible capacity: ${spendableAmount.toFixed(0)} EGP over ${remainingDays} day${remainingDays === 1 ? "" : "s"}.`;
  }

  // Breakdown — mirrors what the UI shows.
  const calculationBreakdown: CalculationBreakdown[] = [
    { label: "Current balance", amount: currentBalance, sign: null },
    { label: "Upcoming mandatory payments", amount: mandatory, sign: "-" },
    { label: "Expected essential spending", amount: essentialReserveRemaining, sign: "-" },
    { label: "Safety buffer", amount: safetyBuffer, sign: "-" },
    { label: "Available for flexible spending", amount: Math.max(0, spendableAmount), sign: "=" },
    { label: `Days until next income (${remainingDays} day${remainingDays === 1 ? "" : "s"})`, amount: null, sign: null },
    { label: "Safe daily spending", amount: safeToSpendPerDay, sign: "=" },
  ];

  return {
    asOfDate: todayISO,
    currentBalance,
    hasBaseline,
    nextIncomeAmount: input.nextIncomeAmount ?? null,
    nextIncomeDate: input.nextIncomeDate ?? null,
    nextIncomeConfirmed: !!input.nextIncomeConfirmed,
    planningWindowStart: todayISO,
    planningWindowEnd: isoDate(windowEnd),
    remainingDays,
    mandatoryCommitments: round2(mandatory),
    essentialSpendingReserve: round2(essentialReserve),
    essentialReserveRemaining: round2(essentialReserveRemaining),
    safetyBuffer: round2(safetyBuffer),
    spendableAmount,
    safeToSpendPerDay,
    projectedBalance,
    projectedShortfall,
    forecastConfidence: confidence,
    confidenceReasons: reasons,
    financialHealth: health,
    healthReason,
    calculationBreakdown,
    buckets,
  };
}
