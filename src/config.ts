import { readFileSync } from "node:fs";
import { configPath } from "./paths.js";

export interface Config {
  currency: string;
  /** badge turns orange above this many $ for a session */
  budgetSoft: number;
  /** badge turns red above this many $ for a session */
  budgetHard: number;
  /** explicit project roots; empty = auto-discover */
  projectRoots: string[];
  /** raw model id -> OpenRouter model id */
  priceOverrides: Record<string, string>;
}

export const DEFAULT_CONFIG: Config = {
  currency: "USD",
  budgetSoft: 5,
  budgetHard: 15,
  projectRoots: [],
  priceOverrides: {},
};

/** Merge a partial user config over defaults. Pure, for testability. */
export function mergeConfig(partial: unknown): Config {
  if (!partial || typeof partial !== "object") return { ...DEFAULT_CONFIG };
  const p = partial as Partial<Config>;
  return {
    currency: typeof p.currency === "string" ? p.currency : DEFAULT_CONFIG.currency,
    budgetSoft: numOr(p.budgetSoft, DEFAULT_CONFIG.budgetSoft),
    budgetHard: numOr(p.budgetHard, DEFAULT_CONFIG.budgetHard),
    projectRoots: Array.isArray(p.projectRoots)
      ? p.projectRoots.filter((x): x is string => typeof x === "string")
      : [],
    priceOverrides:
      p.priceOverrides && typeof p.priceOverrides === "object"
        ? (p.priceOverrides as Record<string, string>)
        : {},
  };
}

export function loadConfig(path: string = configPath()): Config {
  try {
    return mergeConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
