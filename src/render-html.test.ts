import { describe, expect, it } from "vitest";
import { renderHtml, type ReportData } from "./render-html.js";
import { emptyUsage } from "./types.js";

function data(over: Partial<ReportData> = {}): ReportData {
  const c = (cost: number, tokens: number, partial = false) => ({
    usage: emptyUsage(),
    tokens,
    cost,
    partial,
    unknownModels: [] as string[],
  });
  return {
    generatedAt: 1_700_000_000_000,
    currency: "USD",
    totals: { today: c(1, 100), week: c(2, 200), month: c(3, 300), all: c(4, 400) },
    sessions: [
      {
        id: "abcdef12-3456",
        project: "me/proj",
        lastActivity: 1_700_000_000_000,
        cost: c(2.5, 1_200_000),
        mainCost: c(1.4, 700_000),
        teammates: [
          { id: "agent-1", name: "auth-dev", label: "auth-dev — Selling <b>x</b>", cost: c(1.1, 500_000) },
        ],
      },
    ],
    series: [
      { date: "2026-06-06", cost: 1 },
      { date: "2026-06-07", cost: 2 },
    ],
    warnings: [],
    ...over,
  };
}

describe("renderHtml", () => {
  it("produces a self-contained document with totals and sessions", () => {
    const html = renderHtml(data());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).toContain("<script>");
    expect(html).toContain("$2.50"); // session cost
    expect(html).toContain("1.2M"); // tokens
    expect(html).toContain('data-parent="0"'); // teammate breakdown panel
  });

  it("renders the teammate leaderboard with the teammate name", () => {
    const html = renderHtml(data());
    expect(html).toContain("Cost by teammate");
    expect(html).toContain("auth-dev");
    expect(html).toContain("lead"); // the orchestrator row in the breakdown
  });

  it("escapes HTML in labels", () => {
    const html = renderHtml(data());
    expect(html).toContain("Selling &lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("Selling <b>x</b>");
  });

  it("shows a warning banner when present", () => {
    const html = renderHtml(data({ warnings: ["price table unavailable"] }));
    expect(html).toContain("price table unavailable");
    expect(html).toContain("class=\"warn\"");
  });

  it("renders an empty state with no sessions", () => {
    const html = renderHtml(data({ sessions: [] }));
    expect(html).toContain("No sessions found.");
  });
});
