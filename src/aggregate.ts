import { addCost, costByModel, mergeByModel, zeroCost } from "./cost.js";
import type { PriceTable } from "./pricing.js";
import type { Account, CostResult, Session, Usage, Workspace } from "./types.js";

export interface TeammateView {
  id: string;
  /** teammate's own name when known (e.g. "data-dev"), else undefined */
  name?: string;
  label: string;
  cost: CostResult;
  models?: ModelCost[];
}

export interface ModelCost {
  model: string; // raw model id (key of byModel)
  display: string; // prettified label for the UI
  cost: CostResult; // cost + usage for this one model
}

export interface SessionView {
  id: string;
  project: string;
  account: Account;
  workspace?: Workspace;
  /** the cmux tab title the session ran in, when known (the human session name) */
  title?: string;
  lastActivity: number;
  cost: CostResult; // main + teammates
  mainCost: CostResult; // the lead/orchestrator transcript alone
  teammates: TeammateView[];
  mainModels?: ModelCost[];
}

export interface TeammateTotal {
  name: string;
  cost: CostResult;
  sessions: number;
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
  const teammates: TeammateView[] = session.teammates
    .map((t) => ({
      id: t.id,
      name: t.name,
      label: t.label ?? t.id,
      cost: costByModel(t.byModel, prices),
      models: modelCosts(t.byModel, prices),
    }))
    .sort((a, b) => b.cost.cost - a.cost.cost);
  const allUsage = mergeByModel([
    session.main.byModel,
    ...session.teammates.map((t) => t.byModel),
  ]);
  return {
    id: session.id,
    account: session.account,
    project: prettyProject(session.project),
    lastActivity: session.lastActivity,
    cost: costByModel(allUsage, prices),
    mainCost: costByModel(session.main.byModel, prices),
    mainModels: modelCosts(session.main.byModel, prices),
    teammates,
  };
}

/** Cost each model in a usage map separately, highest cost first. */
export function modelCosts(byModel: Map<string, Usage>, prices: PriceTable): ModelCost[] {
  return [...byModel.entries()]
    .map(([model, u]) => ({
      model,
      display: prettyModel(model),
      cost: costByModel(new Map([[model, u]]), prices),
    }))
    .sort((a, b) => b.cost.cost - a.cost.cost);
}

/**
 * Aggregate cost by teammate name across all sessions, highest-cost first.
 * Only named teammates (cmux team members) are included — one-off Explore /
 * workflow subagents are left to their per-session breakdown to keep this list
 * a clean "team members ranked by cost". Recurring names are summed.
 */
export function teammateLeaderboard(views: SessionView[]): TeammateTotal[] {
  const map = new Map<string, { cost: CostResult; sessions: Set<string> }>();
  for (const v of views) {
    for (const t of v.teammates) {
      if (!t.name) continue;
      const key = t.name;
      const entry = map.get(key) ?? { cost: zeroCost(), sessions: new Set<string>() };
      entry.cost = addCost(entry.cost, t.cost);
      entry.sessions.add(v.id);
      map.set(key, entry);
    }
  }
  return [...map.entries()]
    .map(([name, e]) => ({ name, cost: e.cost, sessions: e.sessions.size }))
    .sort((a, b) => b.cost.cost - a.cost.cost);
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

/** Display-only model label: drop a trailing 8-digit date stamp. */
export function prettyModel(raw: string): string {
  return raw.replace(/-?\d{8}$/, "");
}

export interface TreeNode {
  key: string;
  label: string;
  level: "account" | "workspace" | "session" | "teammate" | "model";
  cost: CostResult;
  lastActivity: number;
  children: TreeNode[];
}

export interface FlatSession {
  id: string;
  label: string;
  account: string;
  workspace: string;
  cost: number;
  partial: boolean;
  tokens: number;
  lastActivity: number;
}

/**
 * Everything the report shows for a single Claude account. The account is the
 * top-level partition: a section never mixes data from two accounts.
 */
export interface AccountSection {
  /** account label, e.g. "perso" or "Default" */
  label: string;
  /** all-time cost of this account (shown on the account tab) */
  total: CostResult;
  /** number of sessions under this account */
  sessions: number;
  /** the account's distinct workspace titles, for the in-account filter */
  workspaces: string[];
  /** teammate leaderboard computed from THIS account's sessions only */
  leaderboard: TeammateTotal[];
  /** daily spend series computed from THIS account's sessions only */
  series: DayPoint[];
  /** the account's Workspace -> Session -> Teammate rollup tree */
  tree: TreeNode;
}

const UNKNOWN_WS = "unknown workspace";

/**
 * Build one self-contained section per account. Every number inside a section
 * (leaderboard, daily series, tree, total) is derived ONLY from that account's
 * sessions — accounts are never aggregated together. Highest-cost account first.
 */
export function buildAccountSections(
  views: SessionView[],
  nowMs: number,
  days = 14,
): AccountSection[] {
  // buildTree is already account-first and cost-sorted; reuse its account nodes.
  return buildTree(views).map((accNode) => {
    const accViews = views.filter((v) => v.account.label === accNode.label);
    const sessionCount = accNode.children.reduce((n, ws) => n + ws.children.length, 0);
    return {
      label: accNode.label,
      total: accNode.cost,
      sessions: sessionCount,
      workspaces: accNode.children.map((ws) => ws.label),
      leaderboard: teammateLeaderboard(accViews),
      series: dailySeries(accViews, nowMs, days),
      tree: accNode,
    };
  });
}

/** Build the Account -> Workspace -> Session -> Teammate rollup tree. */
export function buildTree(views: SessionView[]): TreeNode[] {
  const byAccount = groupBy(views, (v) => v.account.label);
  const nodes: TreeNode[] = [];
  for (const [label, accViews] of byAccount) {
    const wsNodes = workspaceNodes(label, accViews);
    nodes.push({
      key: `acc:${label}`,
      label,
      level: "account",
      cost: sumCost(wsNodes.map((n) => n.cost)),
      lastActivity: maxActivity(accViews),
      children: wsNodes,
    });
  }
  return nodes.sort(byCostDesc);
}

function workspaceNodes(accountLabel: string, views: SessionView[]): TreeNode[] {
  const byWs = groupBy(views, (v) => v.workspace?.title ?? UNKNOWN_WS);
  const nodes: TreeNode[] = [];
  for (const [title, wsViews] of byWs) {
    const sessionNodes = wsViews.map((v) => sessionNode(v)).sort(byCostDesc);
    nodes.push({
      key: `ws:${accountLabel}:${title}`,
      label: title,
      level: "workspace",
      cost: sumCost(sessionNodes.map((n) => n.cost)),
      lastActivity: maxActivity(wsViews),
      children: sessionNodes,
    });
  }
  return nodes.sort(byCostDesc);
}

function modelNodes(
  models: ModelCost[] | undefined,
  lastActivity: number,
  parentKey: string,
): TreeNode[] {
  return (models ?? []).map((m) => ({
    key: `${parentKey}:md:${m.model}`,
    label: m.display,
    level: "model" as const,
    cost: m.cost,
    lastActivity,
    children: [],
  }));
}

function sessionNode(v: SessionView): TreeNode {
  const leadKey = `tm:${v.id}:lead`;
  const mates: TreeNode[] = [
    {
      key: leadKey,
      label: "lead",
      level: "teammate",
      cost: v.mainCost,
      lastActivity: v.lastActivity,
      children: modelNodes(v.mainModels, v.lastActivity, leadKey),
    },
    ...v.teammates.map((t): TreeNode => {
      const key = `tm:${v.id}:${t.id}`;
      return {
        key,
        label: t.name ?? t.label,
        level: "teammate",
        cost: t.cost,
        lastActivity: v.lastActivity,
        children: modelNodes(t.models, v.lastActivity, key),
      };
    }),
  ];
  mates.sort(byCostDesc);
  // Prefer the cmux tab title (the name the user gave the session); fall back to
  // the short id + project when the session predates tab-title capture.
  const label = v.title?.trim() ? v.title.trim() : `${v.id.slice(0, 8)} · ${v.project}`;
  return {
    key: `se:${v.id}`,
    label,
    level: "session",
    cost: v.cost,
    lastActivity: v.lastActivity,
    children: mates,
  };
}

/** Flatten views into filter rows for the report's client-side recompute. */
export function flatSessions(views: SessionView[]): FlatSession[] {
  return views.map((v) => ({
    id: v.id,
    label: v.project,
    account: v.account.label,
    workspace: v.workspace?.title ?? UNKNOWN_WS,
    cost: v.cost.cost,
    partial: v.cost.partial,
    tokens: v.cost.tokens,
    lastActivity: v.lastActivity,
  }));
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}
function sumCost(costs: CostResult[]): CostResult {
  return costs.reduce((acc, c) => addCost(acc, c), zeroCost());
}
function maxActivity(views: SessionView[]): number {
  return views.reduce((m, v) => Math.max(m, v.lastActivity), 0);
}
function byCostDesc(a: TreeNode, b: TreeNode): number {
  return b.cost.cost - a.cost.cost;
}
