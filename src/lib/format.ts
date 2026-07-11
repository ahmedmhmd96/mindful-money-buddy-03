export function formatEGP(n: number): string {
  const value = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 2,
  }).format(value);
}

export function monthRange(d = new Date()): { start: string; end: string } {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function daysLeftInMonth(d = new Date()): number {
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return end - d.getDate() + 1;
}

/**
 * Given a configured cycle end day (1-31), returns:
 * - cycleEnd: date object for the next occurrence of that day (today or later)
 * - daysLeft: inclusive days remaining from today until cycleEnd (min 1)
 */
export function cycleInfo(cycleEndDay: number, d = new Date()): { cycleEnd: Date; daysLeft: number } {
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const clamp = Math.max(1, Math.min(31, cycleEndDay));
  const monthLast = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const thisMonthDay = Math.min(clamp, monthLast);
  let cycleEnd = new Date(today.getFullYear(), today.getMonth(), thisMonthDay);
  if (cycleEnd < today) {
    const nextLast = new Date(today.getFullYear(), today.getMonth() + 2, 0).getDate();
    const nextDay = Math.min(clamp, nextLast);
    cycleEnd = new Date(today.getFullYear(), today.getMonth() + 1, nextDay);
  }
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysLeft = Math.max(1, Math.round((cycleEnd.getTime() - today.getTime()) / msPerDay) + 1);
  return { cycleEnd, daysLeft };
}
