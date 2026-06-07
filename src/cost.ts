import type { PriceTable } from "./pricing.js";
import {
  addUsage,
  emptyUsage,
  totalTokens,
  type CostResult,
  type Usage,
} from "./types.js";

/**
 * Cost a per-model usage map. Returns a null cost (but a real token total and
 * the list of offending models) when any model's price can't be resolved, so
 * the UI can show tokens and a warning instead of a fabricated number.
 */
export function costByModel(
  byModel: Map<string, Usage>,
  prices: PriceTable,
): CostResult {
  let usage = emptyUsage();
  let cost = 0;
  const unknown: string[] = [];

  for (const [model, u] of byModel) {
    usage = addUsage(usage, u);
    const price = prices.priceFor(model);
    if (!price) {
      if (!unknown.includes(model)) unknown.push(model);
      continue;
    }
    cost +=
      u.input * price.input +
      u.output * price.output +
      u.cacheCreation * price.cacheWrite +
      u.cacheRead * price.cacheRead;
  }

  return {
    usage,
    tokens: totalTokens(usage),
    cost: round(cost),
    partial: unknown.length > 0,
    unknownModels: unknown,
  };
}

/** Sum several per-model usage maps into one. */
export function mergeByModel(
  maps: Iterable<Map<string, Usage>>,
): Map<string, Usage> {
  const out = new Map<string, Usage>();
  for (const m of maps) {
    for (const [model, u] of m) {
      out.set(model, addUsage(out.get(model) ?? emptyUsage(), u));
    }
  }
  return out;
}

/** Add two cost results (used for rollups): known costs sum; partial is sticky. */
export function addCost(a: CostResult, b: CostResult): CostResult {
  const usage = addUsage(a.usage, b.usage);
  const unknown = [...new Set([...a.unknownModels, ...b.unknownModels])];
  return {
    usage,
    tokens: totalTokens(usage),
    cost: round(a.cost + b.cost),
    partial: a.partial || b.partial,
    unknownModels: unknown,
  };
}

export function zeroCost(): CostResult {
  return { usage: emptyUsage(), tokens: 0, cost: 0, partial: false, unknownModels: [] };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
