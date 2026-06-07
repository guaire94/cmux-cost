/** Format a USD amount, or "—" when unknown (null). */
export function fmtUsd(n: number | null, currency = "USD"): string {
  if (n === null) return "—";
  const symbol = currency === "USD" ? "$" : "";
  const suffix = currency === "USD" ? "" : ` ${currency}`;
  const digits = n < 1 ? 4 : 2;
  return `${symbol}${n.toFixed(digits)}${suffix}`;
}

/**
 * Format a cost result: the known sum, with a trailing "+" when partial (some
 * model prices were missing). A fully-unknown zero shows "—".
 */
export function fmtCost(
  result: { cost: number; partial: boolean },
  currency = "USD",
): string {
  if (result.partial && result.cost === 0) return "—";
  return fmtUsd(result.cost, currency) + (result.partial ? "+" : "");
}

/** Compact token count: 1234 -> "1.2k", 1_500_000 -> "1.5M". */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Short relative time, e.g. "3m", "2h", "5d". 0/invalid -> "—". */
export function fmtTimeAgo(thenMs: number, nowMs: number): string {
  if (!thenMs) return "—";
  const s = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
