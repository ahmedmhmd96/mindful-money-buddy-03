import { describe, it, expect } from "vitest";
import { calculateFinancialPosition, type CommitmentInput } from "../financial-position";

const asOf = new Date("2026-07-14T00:00:00");

function base(overrides: Partial<Parameters<typeof calculateFinancialPosition>[0]> = {}) {
  return calculateFinancialPosition({
    asOfDate: asOf,
    currentBalance: 10_000,
    balanceUpdatedAt: "2026-07-14",
    nextIncomeDate: "2026-07-26",
    nextIncomeAmount: 65_000,
    nextIncomeConfirmed: false,
    essentialAmount: null,
    essentialFrequency: null,
    safetyBuffer: null,
    commitments: [],
    ...overrides,
  });
}

describe("planning window", () => {
  it("Scenario 1: today..(income-1) → 12 days for 14 → 26 July", () => {
    const p = base();
    expect(p.remainingDays).toBe(12);
    expect(p.planningWindowStart).toBe("2026-07-14");
    expect(p.planningWindowEnd).toBe("2026-07-25");
  });

  it("Scenario 3: no income date → short bounded window (no /∞)", () => {
    const p = base({ nextIncomeDate: null, nextIncomeAmount: null });
    expect(p.remainingDays).toBeGreaterThan(0);
    expect(p.remainingDays).toBeLessThanOrEqual(14);
    expect(p.forecastConfidence).toBe("low");
    expect(p.confidenceReasons.some((r) => /income date/i.test(r))).toBe(true);
  });
});

describe("Test Case A — normal positive position", () => {
  it("spendable 5,000 / 500 per day / safe", () => {
    const commitments: CommitmentInput[] = [
      { id: "c1", due_date: "2026-07-20", expected_amount: 5000, actual_amount: null, status: "expected", priority: "mandatory" },
    ];
    // 10 remaining days = income on 24 July
    const p = base({
      currentBalance: 15_000,
      nextIncomeDate: "2026-07-24",
      commitments,
      essentialAmount: 3000,
      essentialFrequency: "monthly", // 3000/30 * 10 = 1000. To hit 3000 reserve, use daily rate.
      safetyBuffer: 2000,
    });
    expect(p.remainingDays).toBe(10);
    // Adjust essential to daily 300 for spec exact match
    const p2 = base({
      currentBalance: 15_000,
      nextIncomeDate: "2026-07-24",
      commitments,
      essentialAmount: 300,
      essentialFrequency: "daily",
      safetyBuffer: 2000,
    });
    expect(p2.essentialSpendingReserve).toBe(3000);
    expect(p2.mandatoryCommitments).toBe(5000);
    expect(p2.spendableAmount).toBe(5000);
    expect(p2.safeToSpendPerDay).toBe(500);
    expect(p2.financialHealth).toBe("safe");
  });
});

describe("Test Case B — tight position", () => {
  it("projected below buffer → tight", () => {
    const commitments: CommitmentInput[] = [
      { id: "c1", due_date: "2026-07-20", expected_amount: 6000, actual_amount: null, status: "expected", priority: "mandatory" },
    ];
    const p = base({
      currentBalance: 10_000,
      commitments,
      essentialAmount: 200,
      essentialFrequency: "daily", // 200 * 12 = 2400 → use monthly 6000/30*12 ≈ 2400. tune:
      safetyBuffer: 3000,
    });
    // Force reserve to 2000 by using daily 166.67 approx — instead simpler:
    const p2 = base({
      currentBalance: 10_000,
      commitments,
      essentialAmount: 2000,
      essentialFrequency: "monthly", // ignored below, we'll craft directly
      safetyBuffer: 3000,
    });
    // Deterministic reserve via daily rate:
    const p3 = base({
      currentBalance: 10_000,
      commitments,
      essentialAmount: 2000 / 12,
      essentialFrequency: "daily",
      safetyBuffer: 3000,
    });
    expect(Math.round(p3.essentialSpendingReserve)).toBe(2000);
    expect(p3.mandatoryCommitments).toBe(6000);
    expect(Math.round(p3.spendableAmount)).toBe(-1000); // 10k -6k -2k -3k
    expect(p3.safeToSpendPerDay).toBe(0); // clamped
    // projected before buffer: 10k -6k -2k = 2000 → below 3000 buffer → tight
    expect(Math.round(p3.projectedBalance)).toBe(2000);
    expect(p3.financialHealth).toBe("tight");
    // silence unused
    expect(p).toBeDefined(); expect(p2).toBeDefined();
  });
});

describe("Test Case C — negative position", () => {
  it("safe-to-spend clamped to 0, shortfall reported, at_risk", () => {
    const commitments: CommitmentInput[] = [
      { id: "c1", due_date: "2026-07-20", expected_amount: 7000, actual_amount: null, status: "expected", priority: "mandatory" },
    ];
    const p = base({
      currentBalance: 4600,
      commitments,
      essentialAmount: 0,
      essentialFrequency: "daily",
      essentialUpdatedAt: "2026-07-14",
    });
    expect(p.safeToSpendPerDay).toBe(0);
    expect(p.projectedBalance).toBe(-2400);
    expect(p.projectedShortfall).toBe(2400);
    expect(p.financialHealth).toBe("at_risk");
    // Confidence is INDEPENDENT of health — data is fresh here.
    expect(p.forecastConfidence).toBe("high");
  });
});

describe("Test Case D — commitment after income", () => {
  it("rent due 1 Aug is excluded from current window and bucketed after", () => {
    const commitments: CommitmentInput[] = [
      { id: "rent", name: "Rent", due_date: "2026-08-01", expected_amount: 20_000, actual_amount: null, status: "expected", priority: "mandatory" },
    ];
    const p = base({ currentBalance: 10_000, commitments });
    expect(p.mandatoryCommitments).toBe(0);
    expect(p.buckets.afterNextIncome.length).toBe(1);
    expect(p.buckets.beforeNextIncome.length).toBe(0);
  });
});

describe("Test Case E — paid commitment already reflected", () => {
  it("reflected_in_balance skips double deduction", () => {
    const commitments: CommitmentInput[] = [
      { id: "rent", due_date: "2026-07-20", expected_amount: 20_000, actual_amount: 20_000, status: "confirmed", priority: "mandatory", reflected_in_balance: true },
    ];
    const p = base({ currentBalance: 10_000, commitments });
    expect(p.mandatoryCommitments).toBe(0);
    expect(p.projectedBalance).toBe(10_000);
  });
});

describe("Test Case F — income not yet arrived (today)", () => {
  it("income not confirmed today → balance unchanged, still expected", () => {
    const p = base({
      currentBalance: 5000,
      nextIncomeDate: "2026-07-14",
      nextIncomeConfirmed: false,
    });
    // Window collapses to today only.
    expect(p.remainingDays).toBe(1);
    // Balance not increased by income.
    expect(p.currentBalance).toBe(5000);
  });
});

describe("Test Case G — essential actuals reduce remaining reserve, not total", () => {
  it("no double count", () => {
    const p = base({
      currentBalance: 10_000,
      nextIncomeDate: "2026-07-26", // 12 days
      essentialAmount: 500,
      essentialFrequency: "daily", // reserve = 6000 across the 12-day window
      essentialActualsInWindow: 1000,
    });
    expect(p.essentialSpendingReserve).toBe(6000);
    expect(p.essentialReserveRemaining).toBe(5000);
  });
});

describe("Delayed commitment", () => {
  it("delayed date beyond next income drops out of current-window totals", () => {
    const commitments: CommitmentInput[] = [
      { id: "c1", due_date: "2026-07-30", expected_amount: 3000, actual_amount: null, status: "delayed", priority: "mandatory" },
    ];
    const p = base({ commitments });
    expect(p.mandatoryCommitments).toBe(0);
    expect(p.buckets.afterNextIncome.length).toBe(1);
  });
});

describe("Changed commitment amount", () => {
  it("uses actual_amount instead of expected", () => {
    const commitments: CommitmentInput[] = [
      { id: "c1", due_date: "2026-07-20", expected_amount: 3000, actual_amount: 4500, status: "expected", priority: "mandatory" },
    ];
    const p = base({ commitments });
    expect(p.mandatoryCommitments).toBe(4500);
  });
});

describe("Confidence is independent of financial health", () => {
  it("stale balance + positive position → low confidence, safe health", () => {
    const p = base({
      currentBalance: 20_000,
      balanceUpdatedAt: "2026-07-01", // 13 days old
    });
    expect(p.forecastConfidence).toBe("low");
    expect(p.financialHealth).toBe("safe");
  });
});

describe("Edge: no division by zero", () => {
  it("income date equals today with includeIncomeDay=false → remainingDays clamped to 1", () => {
    const p = base({ nextIncomeDate: "2026-07-14" });
    expect(p.remainingDays).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(p.safeToSpendPerDay)).toBe(true);
  });
});
