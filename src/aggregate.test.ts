import { describe, expect, it } from "vitest";
import {
  buildSessionView,
  buildTree,
  dailySeries,
  flatSessions,
  prettyProject,
  startOfLocalDay,
  teammateLeaderboard,
  windowTotals,
  type SessionView,
} from "./aggregate.js";
import { parseOpenRouterModels, PriceTable } from "./pricing.js";
import {
  emptyUsage,
  type Account,
  type CostResult,
  type Session,
  type Usage,
  type Workspace,
} from "./types.js";

const ACC: Account = { dir: "/h/.claude-personal", label: "Personal" };

const prices = new PriceTable(
  parseOpenRouterModels({
    data: [
      {
        id: "anthropic/claude-sonnet-4.6",
        pricing: { prompt: "0.000003", completion: "0.000015" },
      },
    ],
  }),
);

function usage(p: Partial<Usage>): Usage {
  return { ...emptyUsage(), ...p };
}

function session(over: Partial<Session>): Session {
  return {
    id: "s1",
    account: ACC,
    project: "-Users-me-proj",
    mainPath: "/x/s1.jsonl",
    main: { id: "s1", path: "/x/s1.jsonl", byModel: new Map() },
    teammates: [],
    lastActivity: 0,
    ...over,
  };
}

describe("buildSessionView", () => {
  it("combines main + teammate usage, exposes mainCost, and sorts teammates by cost", () => {
    const s = session({
      main: {
        id: "s1",
        path: "/x/s1.jsonl",
        byModel: new Map([["claude-sonnet-4-6", usage({ input: 1000 })]]),
      },
      teammates: [
        {
          id: "small",
          path: "/x/s1/subagents/agent-small.jsonl",
          name: "small-dev",
          label: "small-dev — tiny",
          byModel: new Map([["claude-sonnet-4-6", usage({ output: 100 })]]),
        },
        {
          id: "big",
          path: "/x/s1/subagents/agent-big.jsonl",
          name: "big-dev",
          label: "big-dev — huge",
          byModel: new Map([["claude-sonnet-4-6", usage({ output: 1000 })]]),
        },
      ],
    });
    const v = buildSessionView(s, prices);
    expect(v.cost.cost).toBeCloseTo(1000 * 3e-6 + 1100 * 15e-6, 9);
    expect(v.mainCost.cost).toBeCloseTo(1000 * 3e-6, 9);
    expect(v.teammates.map((t) => t.name)).toEqual(["big-dev", "small-dev"]);
    expect(v.project).toBe("me/proj");
  });
});

describe("teammateLeaderboard", () => {
  it("aggregates by name across sessions and sorts by cost", () => {
    const c = (cost: number): SessionView["cost"] => ({
      usage: emptyUsage(),
      tokens: 0,
      cost,
      partial: false,
      unknownModels: [],
    });
    const view = (id: string, mates: Array<{ name: string; cost: number }>): SessionView => ({
      id,
      project: "p",
      account: ACC,
      lastActivity: 0,
      cost: c(0),
      mainCost: c(0),
      teammates: mates.map((m) => ({ id: m.name, name: m.name, label: m.name, cost: c(m.cost) })),
    });
    const board = teammateLeaderboard([
      view("s1", [{ name: "auth-dev", cost: 2 }, { name: "home-dev", cost: 5 }]),
      view("s2", [{ name: "auth-dev", cost: 3 }]),
    ]);
    expect(board.map((b) => [b.name, b.cost.cost, b.sessions])).toEqual([
      ["auth-dev", 5, 2],
      ["home-dev", 5, 1],
    ]);
  });

  it("excludes unnamed (one-off) teammates from the leaderboard", () => {
    const c = (cost: number): SessionView["cost"] => ({
      usage: emptyUsage(),
      tokens: 0,
      cost,
      partial: false,
      unknownModels: [],
    });
    const v: SessionView = {
      id: "s",
      project: "p",
      account: ACC,
      lastActivity: 0,
      cost: c(0),
      mainCost: c(0),
      teammates: [
        { id: "1", name: "auth-dev", label: "auth-dev — x", cost: c(4) },
        { id: "2", label: "Some Explore scope", cost: c(9) }, // no name
      ],
    };
    expect(teammateLeaderboard([v]).map((b) => b.name)).toEqual(["auth-dev"]);
  });
});

describe("windowTotals", () => {
  it("buckets sessions into today / week / month / all", () => {
    const now = 1_700_000_000_000;
    const day = 86_400_000;
    const mk = (ts: number): SessionView => ({
      id: "x",
      project: "p",
      account: ACC,
      lastActivity: ts,
      cost: { usage: emptyUsage(), tokens: 0, cost: 1, partial: false, unknownModels: [] },
      mainCost: { usage: emptyUsage(), tokens: 0, cost: 1, partial: false, unknownModels: [] },
      teammates: [],
    });
    const views = [mk(now), mk(now - 3 * day), mk(now - 10 * day), mk(now - 40 * day)];
    const t = windowTotals(views, now);
    expect(t.today.cost).toBe(1); // only now
    expect(t.week.cost).toBe(2); // now + 3d
    expect(t.month.cost).toBe(3); // now + 3d + 10d
    expect(t.all.cost).toBe(4);
  });
});

describe("dailySeries", () => {
  it("produces one ascending bucket per day", () => {
    const now = startOfLocalDay(1_700_000_000_000) + 3600_000;
    const series = dailySeries(
      [
        {
          id: "x",
          project: "p",
          account: ACC,
          lastActivity: now,
          cost: { usage: emptyUsage(), tokens: 0, cost: 2, partial: false, unknownModels: [] },
          mainCost: { usage: emptyUsage(), tokens: 0, cost: 0, partial: false, unknownModels: [] },
          teammates: [],
        },
      ],
      now,
      7,
    );
    expect(series).toHaveLength(7);
    expect(series[series.length - 1]!.cost).toBe(2);
    expect([...series].sort((a, b) => a.date.localeCompare(b.date))).toEqual(series);
  });
});

describe("prettyProject", () => {
  it("keeps the last two path segments", () => {
    expect(prettyProject("-Users-me-Documents-projects-klozy")).toBe("projects/klozy");
  });
});

function cost(n: number): CostResult {
  return {
    usage: { input: n, output: 0, cacheCreation: 0, cacheRead: 0 },
    tokens: n,
    cost: n,
    partial: false,
    unknownModels: [],
  };
}
function mkView(
  id: string,
  account: Account,
  workspace: Workspace | undefined,
  c: number,
  lastActivity = 0,
): SessionView {
  return {
    id,
    project: "proj",
    account,
    workspace,
    lastActivity,
    cost: cost(c),
    mainCost: cost(c),
    teammates: [],
  };
}

describe("buildTree", () => {
  const perso: Account = { dir: "/h/.claude-personal", label: "Personal" };
  const tala: Account = { dir: "/h/.claude-talabat", label: "Talabat" };
  const ws: Workspace = { id: "W1", title: "[Talabat] Flutter App" };

  it("groups account -> workspace -> session and rolls up cost, sorted desc", () => {
    const tree = buildTree([
      mkView("s1", tala, ws, 10),
      mkView("s2", tala, ws, 5),
      mkView("s3", perso, undefined, 3),
    ]);
    expect(tree.map((n) => [n.label, n.cost.cost])).toEqual([
      ["Talabat", 15],
      ["Personal", 3],
    ]);
    const talaWs = tree[0]!.children;
    expect(talaWs.map((n) => [n.label, n.level, n.cost.cost])).toEqual([
      ["[Talabat] Flutter App", "workspace", 15],
    ]);
    expect(talaWs[0]!.children.map((s) => s.cost.cost)).toEqual([10, 5]);
  });

  it("buckets sessions without a workspace under 'unknown workspace'", () => {
    const tree = buildTree([mkView("s3", perso, undefined, 3)]);
    expect(tree[0]!.children[0]!.label).toBe("unknown workspace");
  });
});

describe("flatSessions", () => {
  it("flattens views to filter rows with account/workspace labels", () => {
    const tala: Account = { dir: "/h/.claude-talabat", label: "Talabat" };
    const flat = flatSessions([mkView("s1", tala, { id: "W1", title: "WS" }, 10, 42)]);
    expect(flat).toEqual([
      {
        id: "s1",
        label: "proj",
        account: "Talabat",
        workspace: "WS",
        cost: 10,
        partial: false,
        tokens: 10,
        lastActivity: 42,
      },
    ]);
  });
});
