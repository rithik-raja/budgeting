export function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-08" -> "Aug 2026" */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

/** "2026-08" -> "August 2026" */
export function formatMonthLong(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTH_FULL[Number(m) - 1]} ${y}`;
}

/** Unix seconds -> "Aug 4, 2026" */
export function formatEpoch(ts: number): string {
  const d = new Date(ts * 1000);
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** 2026-08-04 -> "Aug 4, 2026" (for YYYY-MM-DD strings) */
export function formatDateString(date: string): string {
  const [y, m, d] = date.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${Number(d)}, ${y}`;
}
