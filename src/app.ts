import {
  buildSessionView,
  dailySeries,
  windowTotals,
  type SessionView,
} from "./aggregate.js";
import { loadConfig, type Config } from "./config.js";
import { defaultProjectRoots, loadAllSessions } from "./discover.js";
import { pricesCachePath } from "./paths.js";
import { loadPriceTable, type PriceTable } from "./pricing.js";
import type { ReportData } from "./render-html.js";

export interface LoadedViews {
  cfg: Config;
  prices: PriceTable;
  views: SessionView[];
}

/** Shared loader: config -> roots -> sessions -> prices -> per-session views. */
export async function loadViews(): Promise<LoadedViews> {
  const cfg = loadConfig();
  const roots = cfg.projectRoots.length > 0 ? cfg.projectRoots : defaultProjectRoots();
  const sessions = loadAllSessions(roots);
  const prices = await loadPriceTable({
    cachePath: pricesCachePath(),
    overrides: cfg.priceOverrides,
  });
  const views = sessions.map((s) => buildSessionView(s, prices));
  return { cfg, prices, views };
}

/** Assemble the HTML report data model from loaded views. */
export function buildReportData(loaded: LoadedViews, nowMs: number): ReportData {
  const warnings: string[] = [];
  if (loaded.prices.size === 0) {
    warnings.push("price table unavailable — showing tokens only");
  }
  const unknown = new Set<string>();
  for (const v of loaded.views) for (const m of v.cost.unknownModels) unknown.add(m);
  if (unknown.size > 0) warnings.push(`no price for: ${[...unknown].join(", ")}`);

  return {
    generatedAt: nowMs,
    currency: loaded.cfg.currency,
    totals: windowTotals(loaded.views, nowMs),
    sessions: loaded.views,
    series: dailySeries(loaded.views, nowMs),
    warnings,
  };
}
