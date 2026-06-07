import { describe, expect, it } from "vitest";
import {
  buildSessionView,
  dailySeries,
  prettyProject,
  startOfLocalDay,
  windowTotals,
  type SessionView,
} from "./aggregate.js";
import { parseOpenRouterModels, PriceTable } from "./pricing.js";
import { emptyUsage, type Session, type Usage } from "./types.js";

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
    project: "-Users-me-proj",
    mainPath: "/x/s1.jsonl",
    main: { id: "s1", path: "/x/s1.jsonl", byModel: new Map() },
    teammates: [],
    lastActivity: 0,
    ...over,
  };
}

describe("buildSessionView", () => {
  it("combines main + teammate usage and lists teammates", () => {
    const s = session({
      main: {
        id: "s1",
        path: "/x/s1.jsonl",
        byModel: new Map([["claude-sonnet-4-6", usage({ input: 1000 })]]),
      },
      teammates: [
        {
          id: "a1",
          path: "/x/s1/subagents/agent-a1.jsonl",
          label: "Selling",
          byModel: new Map([["claude-sonnet-4-6", usage({ output: 1000 })]]),
        },
      ],
    });
    const v = buildSessionView(s, prices);
    expect(v.cost.cost).toBeCloseTo(1000 * 3e-6 + 1000 * 15e-6, 9);
    expect(v.teammates).toHaveLength(1);
    expect(v.teammates[0]!.label).toBe("Selling");
    expect(v.project).toBe("me/proj");
  });
});

describe("windowTotals", () => {
  it("buckets sessions into today / week / month / all", () => {
    const now = 1_700_000_000_000;
    const day = 86_400_000;
    const mk = (ts: number): SessionView => ({
      id: "x",
      project: "p",
      lastActivity: ts,
      cost: { usage: emptyUsage(), tokens: 0, cost: 1, partial: false, unknownModels: [] },
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
          lastActivity: now,
          cost: { usage: emptyUsage(), tokens: 0, cost: 2, partial: false, unknownModels: [] },
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
