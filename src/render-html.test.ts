import { describe, expect, it } from "vitest";
import { renderHtml, type ReportData } from "./render-html.js";
import { buildAccountSections, type SessionView } from "./aggregate.js";
import { emptyUsage, type Account, type Workspace } from "./types.js";

const ACC: Account = { dir: "/h/.claude-talabat", label: "Talabat" };
const WS: Workspace = { id: "W1", title: "[Talabat] Flutter App" };

const c = (cost: number, tokens: number, partial = false) => ({
  usage: emptyUsage(),
  tokens,
  cost,
  partial,
  unknownModels: [] as string[],
});

const defaultSessions: SessionView[] = [
  {
    id: "abcdef12-3456",
    project: "me/proj",
    account: ACC,
    workspace: WS,
    lastActivity: 1_700_000_000_000,
    cost: c(2.5, 1_200_000),
    mainCost: c(1.4, 700_000),
    teammates: [
      { id: "agent-1", name: "auth-dev", label: "auth-dev — Selling x", cost: c(1.1, 500_000) },
      { id: "agent-2", label: "Selling <b>x</b>", cost: c(0.2, 50_000) }, // unnamed -> shown in tree
    ],
  },
];

const NOW = 1_700_000_000_000;

function data(over: Partial<ReportData> & { sessions?: SessionView[] } = {}): ReportData {
  const { sessions, ...rest } = over;
  return {
    generatedAt: NOW,
    currency: "USD",
    totals: { today: c(1, 100), week: c(2, 200), month: c(3, 300), all: c(4, 400) },
    warnings: [],
    accounts: buildAccountSections(sessions ?? defaultSessions, NOW),
    ...rest,
  };
}

describe("renderHtml", () => {
  it("produces a self-contained document with the global totals", () => {
    const html = renderHtml(data());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).toContain("<script>");
    expect(html).toContain("$2.50"); // session cost
    expect(html).toContain("1.2M"); // tokens
    expect(html).toContain("All accounts"); // global KPI band label
  });

  it("renders the account as a tab and the workspace node with data attributes", () => {
    const html = renderHtml(data());
    expect(html).toContain('data-acc-tab="Talabat"');
    expect(html).toContain('data-acc-panel="Talabat"');
    expect(html).toContain("[Talabat] Flutter App");
    expect(html).toContain('data-workspace="[Talabat] Flutter App"');
    expect(html).not.toContain('data-account="Talabat"'); // accounts are tabs, not tree nodes
  });

  it("renders the teammate leaderboard and the lead node", () => {
    const html = renderHtml(data());
    expect(html).toContain("Cost by teammate");
    expect(html).toContain("auth-dev");
    expect(html).toContain("lead"); // the orchestrator teammate node
  });

  it("escapes HTML in labels", () => {
    const html = renderHtml(data());
    expect(html).toContain("Selling &lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("Selling <b>x</b>");
  });

  it("shows a warning banner when present", () => {
    const html = renderHtml(data({ warnings: ["price table unavailable"] }));
    expect(html).toContain("price table unavailable");
    expect(html).toContain('class="warn"');
  });

  it("renders an empty state with no sessions", () => {
    const html = renderHtml(data({ sessions: [] }));
    expect(html).toContain("No sessions found.");
  });
});
