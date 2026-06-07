import {
  buildAccountSections,
  buildSessionView,
  windowTotals,
  type SessionView,
} from "./aggregate.js";
import { resolveAccounts } from "./accounts.js";
import { loadConfig, type Config } from "./config.js";
import { loadAllSessions } from "./discover.js";
import { pricesCachePath } from "./paths.js";
import { loadPriceTable, type PriceTable } from "./pricing.js";
import { loadWorkspaceMap, workspaceFor } from "./workspaces.js";
import type { ReportData } from "./render-html.js";

export interface LoadedViews {
  cfg: Config;
  prices: PriceTable;
  views: SessionView[];
}

/** Shared loader: config -> accounts -> sessions -> prices -> views (+ workspace). */
export async function loadViews(): Promise<LoadedViews> {
  const cfg = loadConfig();
  const accounts = resolveAccounts(cfg);
  const sessions = loadAllSessions(accounts);
  const prices = await loadPriceTable({
    cachePath: pricesCachePath(),
    overrides: cfg.priceOverrides,
  });
  const wsMap = loadWorkspaceMap();
  const views = sessions.map((s) => {
    const view = buildSessionView(s, prices);
    view.workspace = workspaceFor(wsMap, s.id);
    return view;
  });
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
    accounts: buildAccountSections(loaded.views, nowMs),
    warnings,
  };
}
