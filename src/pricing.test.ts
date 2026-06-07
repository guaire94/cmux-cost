import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadPriceTable, parseOpenRouterModels, PriceTable } from "./pricing.js";

const sample = {
  data: [
    {
      id: "anthropic/claude-opus-4.8",
      pricing: { prompt: "0.000005", completion: "0.000025" },
    },
    { id: "broken" }, // no pricing -> skipped
  ],
};

function tmpCache(): string {
  return join(mkdtempSync(join(tmpdir(), "cmux-cost-")), "prices.json");
}

describe("parseOpenRouterModels", () => {
  it("parses numeric prices and skips entries without pricing", () => {
    const m = parseOpenRouterModels(sample);
    expect(m.size).toBe(1);
    expect(m.get("anthropic/claude-opus-4.8")).toEqual({
      input: 0.000005,
      output: 0.000025,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it("returns empty on malformed input", () => {
    expect(parseOpenRouterModels(null).size).toBe(0);
    expect(parseOpenRouterModels({ data: "nope" }).size).toBe(0);
  });
});

describe("PriceTable", () => {
  it("resolves raw model ids through normalization", () => {
    const t = new PriceTable(parseOpenRouterModels(sample));
    expect(t.priceFor("claude-opus-4-8")?.input).toBe(0.000005);
    expect(t.priceFor("gpt-4o")).toBeNull();
  });
});

describe("loadPriceTable", () => {
  it("fetches from the network and writes the cache", async () => {
    const cachePath = tmpCache();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => sample,
    } as Response);

    const t = await loadPriceTable({ cachePath, fetchImpl, now: 1000 });
    expect(t.size).toBe(1);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    expect(cached.fetchedAt).toBe(1000);
  });

  it("uses a fresh cache without fetching", async () => {
    const cachePath = tmpCache();
    writeFileSync(
      cachePath,
      JSON.stringify({
        fetchedAt: 1000,
        prices: { "anthropic/claude-opus-4.8": { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } },
      }),
    );
    const fetchImpl = vi.fn();
    const t = await loadPriceTable({ cachePath, fetchImpl, now: 1500, ttlMs: 1000 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(t.priceFor("claude-opus-4-8")?.input).toBe(1);
  });

  it("falls back to a stale cache when the network fails", async () => {
    const cachePath = tmpCache();
    writeFileSync(
      cachePath,
      JSON.stringify({
        fetchedAt: 0,
        prices: { "anthropic/claude-opus-4.8": { input: 9, output: 9, cacheRead: 0, cacheWrite: 0 } },
      }),
    );
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const t = await loadPriceTable({ cachePath, fetchImpl, now: 1e12, ttlMs: 1000 });
    expect(t.priceFor("claude-opus-4-8")?.input).toBe(9);
  });

  it("returns an empty table when there is no data at all", async () => {
    const cachePath = tmpCache();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    const t = await loadPriceTable({ cachePath, fetchImpl, now: 1 });
    expect(t.size).toBe(0);
    expect(t.priceFor("claude-opus-4-8")).toBeNull();
  });
});
