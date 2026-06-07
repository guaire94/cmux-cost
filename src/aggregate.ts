import { addCost, costByModel, mergeByModel, zeroCost } from "./cost.js";
import type { PriceTable } from "./pricing.js";
import type { CostResult, Session } from "./types.js";

export interface TeammateView {
  id: string;
  label: string;
  cost: CostResult;
}

export interface SessionView {
  id: string;
  project: string;
  lastActivity: number;
  cost: CostResult; // main + teammates
  teammates: TeammateView[];
}

export interface WindowTotals {
  today: CostResult;
  week: CostResult;
  month: CostResult;
  all: CostResult;
}

export interface DayPoint {
  date: string; // YYYY-MM-DD
  cost: number; // 0 when unknown, for charting
}

/** Build a per-session view (with per-teammate breakdown) from raw usage. */
export function buildSessionView(session: Session, prices: PriceTable): SessionView {
  const teammates: TeammateView[] = session.teammates.map((t) => ({
    id: t.id,
    label: t.label ?? t.id,
    cost: costByModel(t.byModel, prices),
  }));
  const allUsage = mergeByModel([
    session.main.byModel,
    ...session.teammates.map((t) => t.byModel),
  ]);
  return {
    id: session.id,
    project: prettyProject(session.project),
    lastActivity: session.lastActivity,
    cost: costByModel(allUsage, prices),
    teammates,
  };
}

/** Roll up sessions into today / 7d / 30d / all-time totals. */
export function windowTotals(views: SessionView[], nowMs: number): WindowTotals {
  const dayStart = startOfLocalDay(nowMs);
  const weekStart = nowMs - 7 * DAY;
  const monthStart = nowMs - 30 * DAY;
  let today = zeroCost();
  let week = zeroCost();
  let month = zeroCost();
  let all = zeroCost();
  for (const v of views) {
    all = addCost(all, v.cost);
    if (v.lastActivity >= monthStart) month = addCost(month, v.cost);
    if (v.lastActivity >= weekStart) week = addCost(week, v.cost);
    if (v.lastActivity >= dayStart) today = addCost(today, v.cost);
  }
  return { today, week, month, all };
}

/** Daily cost series for the last `days` days, oldest first. */
export function dailySeries(views: SessionView[], nowMs: number, days = 14): DayPoint[] {
  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    buckets.set(isoDate(nowMs - i * DAY), 0);
  }
  for (const v of views) {
    const key = isoDate(v.lastActivity);
    if (buckets.has(key) && v.cost.cost !== null) {
      buckets.set(key, (buckets.get(key) ?? 0) + v.cost.cost);
    }
  }
  return [...buckets.entries()]
    .map(([date, cost]) => ({ date, cost }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const DAY = 24 * 60 * 60 * 1000;

export function startOfLocalDay(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isoDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Claude encodes the project path as a slug; show its tail for readability. */
export function prettyProject(slug: string): string {
  const parts = slug.split("-").filter(Boolean);
  return parts.slice(-2).join("/") || slug;
}
