import { describe, expect, it } from "vitest";
import { workspaceBadges } from "./badges.js";
import { DEFAULT_CONFIG, type Config } from "./config.js";
import type { SessionView } from "./aggregate.js";
import { emptyUsage, type Account, type Workspace } from "./types.js";

const ACC: Account = { dir: "/h/.claude", label: "Default" };
const cfg: Config = { ...DEFAULT_CONFIG, currency: "USD", budgetSoft: 5, budgetHard: 20 };

const cost = (c: number, t: number) => ({
  usage: emptyUsage(),
  tokens: t,
  cost: c,
  partial: false,
  unknownModels: [] as string[],
});

const view = (id: string, ws: Workspace | undefined, c: number): SessionView => ({
  id,
  project: "p",
  account: ACC,
  workspace: ws,
  lastActivity: 0,
  cost: cost(c, c * 1000),
  mainCost: cost(c, c * 1000),
  teammates: [],
});

describe("workspaceBadges", () => {
  it("sums cost per workspace and skips sessions with no workspace", () => {
    const w1: Workspace = { id: "W1", title: "One" };
    const w2: Workspace = { id: "W2", title: "Two" };
    const badges = workspaceBadges(
      [view("a", w1, 2), view("b", w1, 1), view("c", w2, 8), view("d", undefined, 99)],
      cfg,
    );
    const byId = Object.fromEntries(badges.map((b) => [b.workspaceId, b]));
    expect(Object.keys(byId).sort()).toEqual(["W1", "W2"]);
    expect(byId.W1!.text).toContain("$3.00"); // 2 + 1
    expect(byId.W2!.text).toContain("$8.00");
  });

  it("colours the badge by budget thresholds", () => {
    const w: Workspace = { id: "W", title: "T" };
    const ok = workspaceBadges([view("a", w, 1)], cfg)[0]!; // < soft
    const warn = workspaceBadges([view("a", w, 6)], cfg)[0]!; // >= soft
    const over = workspaceBadges([view("a", w, 25)], cfg)[0]!; // >= hard
    expect(ok.color).not.toBe(warn.color);
    expect(warn.color).not.toBe(over.color);
  });
});
