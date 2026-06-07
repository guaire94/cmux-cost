import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeModelId } from "./model.js";
import type { ModelPrice } from "./types.js";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

interface OpenRouterModel {
  id?: string;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
    input_cache_read?: string | number;
    input_cache_write?: string | number;
  };
}

/** Parse the OpenRouter /models payload into a price table keyed by model id. */
export function parseOpenRouterModels(json: unknown): Map<string, ModelPrice> {
  const out = new Map<string, ModelPrice>();
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return out;
  for (const entry of data as OpenRouterModel[]) {
    const id = entry?.id;
    const p = entry?.pricing;
    if (!id || !p) continue;
    out.set(id, {
      input: n(p.prompt),
      output: n(p.completion),
      cacheRead: n(p.input_cache_read),
      cacheWrite: n(p.input_cache_write),
    });
  }
  return out;
}

/** A resolved price table that maps raw agent model ids to prices. */
export class PriceTable {
  private prices: Map<string, ModelPrice>;
  private ids: string[];
  private overrides: Record<string, string>;
  private cache = new Map<string, ModelPrice | null>();

  constructor(
    prices: Map<string, ModelPrice>,
    overrides: Record<string, string> = {},
  ) {
    this.prices = prices;
    this.ids = [...prices.keys()];
    this.overrides = overrides;
  }

  get size(): number {
    return this.prices.size;
  }

  /** Price for a raw agent model id, or null if it can't be resolved. */
  priceFor(rawModelId: string): ModelPrice | null {
    if (this.cache.has(rawModelId)) return this.cache.get(rawModelId) ?? null;
    const id = normalizeModelId(rawModelId, this.ids, this.overrides);
    const price = id ? this.prices.get(id) ?? null : null;
    this.cache.set(rawModelId, price);
    return price;
  }
}

interface LoadOptions {
  cachePath: string;
  ttlMs?: number;
  overrides?: Record<string, string>;
  /** injectable for tests; defaults to global fetch */
  fetchImpl?: typeof fetch;
  /** injectable clock for tests */
  now?: number;
}

/**
 * Load prices, preferring a fresh on-disk cache and falling back to the network.
 * If the network fails, a stale cache is used. If there is no data at all, an
 * empty table is returned (callers degrade to token-only output).
 */
export async function loadPriceTable(opts: LoadOptions): Promise<PriceTable> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? Date.now();
  const cached = readCache(opts.cachePath);

  if (cached && now - cached.fetchedAt < ttl) {
    return new PriceTable(toMap(cached.prices), opts.overrides);
  }

  try {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const res = await fetchImpl(OPENROUTER_MODELS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const prices = parseOpenRouterModels(json);
    if (prices.size > 0) {
      writeCache(opts.cachePath, { fetchedAt: now, prices: fromMap(prices) });
      return new PriceTable(prices, opts.overrides);
    }
  } catch {
    // fall through to stale cache
  }

  if (cached) return new PriceTable(toMap(cached.prices), opts.overrides);
  return new PriceTable(new Map(), opts.overrides);
}

interface CacheFile {
  fetchedAt: number;
  prices: Record<string, ModelPrice>;
}

function readCache(path: string): CacheFile | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed.fetchedAt === "number" && parsed.prices) {
      return parsed as CacheFile;
    }
  } catch {
    // ignore
  }
  return null;
}

function writeCache(path: string, data: CacheFile): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data));
  } catch {
    // caching is best-effort
  }
}

function toMap(rec: Record<string, ModelPrice>): Map<string, ModelPrice> {
  return new Map(Object.entries(rec));
}
function fromMap(m: Map<string, ModelPrice>): Record<string, ModelPrice> {
  return Object.fromEntries(m);
}

function n(v: unknown): number {
  const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(x) ? x : 0;
}
