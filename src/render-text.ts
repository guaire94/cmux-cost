import type { SessionView, WindowTotals } from "./aggregate.js";
import { fmtCost, fmtTimeAgo, fmtTokens } from "./format.js";
import type { CostResult } from "./types.js";

/** Totals header line for `today`. */
export function renderTotals(t: WindowTotals, currency: string): string {
  const cell = (label: string, c: CostResult) =>
    `${label}: ${fmtCost(c, currency)} (${fmtTokens(c.tokens)})`;
  return [
    cell("Today", t.today),
    cell("7d", t.week),
    cell("30d", t.month),
    cell("All", t.all),
  ].join("   ");
}

/** A plain table of sessions, newest first. */
export function renderSessions(
  views: SessionView[],
  currency: string,
  nowMs: number,
  limit = 30,
): string {
  const rows = views.slice(0, limit).map((v) => {
    const id = v.id.slice(0, 8);
    const proj = v.project.slice(0, 24).padEnd(24);
    const cost = fmtCost(v.cost, currency).padStart(10);
    const tok = fmtTokens(v.cost.tokens).padStart(7);
    const mates = v.teammates.length ? `${v.teammates.length} mates` : "";
    const ago = fmtTimeAgo(v.lastActivity, nowMs).padStart(4);
    return `${id}  ${proj}  ${cost}  ${tok}  ${ago}  ${mates}`;
  });
  const header = `${"id".padEnd(8)}  ${"project".padEnd(24)}  ${"cost".padStart(10)}  ${"tokens".padStart(7)}  ${"ago".padStart(4)}`;
  return [header, "-".repeat(header.length), ...rows].join("\n");
}

/** Per-teammate breakdown for one session. */
export function renderSessionDetail(view: SessionView, currency: string): string {
  const lines = [
    `Session ${view.id}  (${view.project})`,
    `Total: ${fmtCost(view.cost, currency)}  ·  ${fmtTokens(view.cost.tokens)} tokens`,
  ];
  if (view.teammates.length > 0) {
    lines.push("", "Teammates:");
    for (const t of view.teammates) {
      lines.push(
        `  ${fmtCost(t.cost, currency).padStart(10)}  ${fmtTokens(t.cost.tokens).padStart(7)}  ${t.label.slice(0, 70)}`,
      );
    }
  }
  if (view.cost.unknownModels.length > 0) {
    lines.push("", `⚠ unknown price for: ${view.cost.unknownModels.join(", ")}`);
  }
  return lines.join("\n");
}
