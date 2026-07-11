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
