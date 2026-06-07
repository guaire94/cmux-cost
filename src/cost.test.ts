import { describe, expect, it } from "vitest";
import { addCost, costByModel, mergeByModel, zeroCost } from "./cost.js";
import { parseOpenRouterModels, PriceTable } from "./pricing.js";
import type { Usage } from "./types.js";

const table = new PriceTable(
  parseOpenRouterModels({
    data: [
      {
        id: "anthropic/claude-sonnet-4.6",
        pricing: {
          prompt: "0.000003",
          completion: "0.000015",
          input_cache_read: "0.0000003",
          input_cache_write: "0.00000375",
        },
      },
    ],
  }),
);

function usage(p: Partial<Usage>): Usage {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, ...p };
}

describe("costByModel", () => {
  it("applies per-token prices including cache read/write", () => {
    const byModel = new Map<string, Usage>([
      [
        "claude-sonnet-4-6",
        usage({ input: 1000, output: 1000, cacheCreation: 1000, cacheRead: 1_000_000 }),
      ],
    ]);
    const r = costByModel(byModel, table);
    // 1000*3e-6 + 1000*15e-6 + 1000*3.75e-6 + 1e6*3e-7 = 0.003+0.015+0.00375+0.3
    expect(r.cost).toBeCloseTo(0.32175, 6);
    expect(r.tokens).toBe(1_003_000);
    expect(r.unknownModels).toEqual([]);
  });

  it("returns null cost but real tokens when a price is missing", () => {
    const byModel = new Map<string, Usage>([["gpt-4o", usage({ input: 10 })]]);
    const r = costByModel(byModel, table);
    expect(r.cost).toBeNull();
    expect(r.tokens).toBe(10);
    expect(r.unknownModels).toEqual(["gpt-4o"]);
  });
});

describe("mergeByModel", () => {
  it("sums usage across maps", () => {
    const a = new Map([["m", usage({ input: 1 })]]);
    const b = new Map([["m", usage({ input: 2, output: 3 })]]);
    const merged = mergeByModel([a, b]);
    expect(merged.get("m")).toEqual(usage({ input: 3, output: 3 }));
  });
});

describe("addCost", () => {
  it("adds two results", () => {
    const a = costByModel(new Map([["claude-sonnet-4-6", usage({ input: 1000 })]]), table);
    const b = costByModel(new Map([["claude-sonnet-4-6", usage({ output: 1000 })]]), table);
    const sum = addCost(a, b);
    expect(sum.cost).toBeCloseTo(0.018, 6);
    expect(sum.tokens).toBe(2000);
  });

  it("stays null if either side is unknown", () => {
    const known = costByModel(new Map([["claude-sonnet-4-6", usage({ input: 1000 })]]), table);
    const unknown = costByModel(new Map([["gpt-4o", usage({ input: 1 })]]), table);
    expect(addCost(known, unknown).cost).toBeNull();
  });

  it("zeroCost is an additive identity for tokens", () => {
    const z = zeroCost();
    expect(z.cost).toBe(0);
    expect(z.tokens).toBe(0);
  });
});
