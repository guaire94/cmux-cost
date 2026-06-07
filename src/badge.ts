import { fmtCost, fmtTokens } from "./format.js";
import type { Config } from "./config.js";
import type { CostResult } from "./types.js";

export const COLOR_OK = "#3fb950";
export const COLOR_WARN = "#d29922";
export const COLOR_OVER = "#f85149";

/** The text shown on a workspace badge, e.g. "$2.75 · 1.2M". */
export function badgeText(cost: CostResult, currency: string): string {
  return `${fmtCost(cost, currency)} · ${fmtTokens(cost.tokens)}`;
}

/** Badge colour based on session spend vs configured budget thresholds. */
export function badgeColor(cost: CostResult, cfg: Config): string {
  if (cost.cost >= cfg.budgetHard) return COLOR_OVER;
  if (cost.cost >= cfg.budgetSoft) return COLOR_WARN;
  return COLOR_OK;
}
