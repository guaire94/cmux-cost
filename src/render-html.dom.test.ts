/**
 * Integration tests for the report's client-side date filter. These render the
 * real HTML, load it into a JSDOM that executes the embedded <script>, then
 * drive the filter the way a user would and assert the recompute results.
 */
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it } from "vitest";
import { buildAccountSections, buildReportSessions, type SessionView } from "./aggregate.js";
import { renderHtml, type ReportData } from "./render-html.js";
import { emptyUsage, type Account, type Workspace } from "./types.js";

const ACC: Account = { dir: "/h/.claude", label: "Perso" };
const WS: Workspace = { id: "W1", title: "Proj A" };
const WS2: Workspace = { id: "W2", title: "Proj B" };

const c = (cost: number, tokens: number) => ({
  usage: emptyUsage(),
  tokens,
  cost,
  partial: false,
  unknownModels: [] as string[],
});

const DAY = 86_400_000;
// A fixed "today" for deterministic ranges, far enough from the data dates.
const NOW = new Date(2026, 5, 10, 12, 0, 0).getTime(); // 2026-06-10 local noon

function view(
  id: string,
  daysAgo: number,
  cost: number,
  account: Account = ACC,
  workspace: Workspace = WS,
): SessionView {
  return {
    id,
    project: "p",
    account,
    workspace,
    lastActivity: NOW - daysAgo * DAY,
    cost: c(cost, cost * 1000),
    mainCost: c(cost, cost * 1000),
    teammates: [{ id: `${id}-a`, name: "dev", label: "dev", cost: c(cost, cost * 1000) }],
  };
}

function reportData(views: SessionView[]): ReportData {
  return {
    generatedAt: NOW,
    currency: "USD",
    totals: { today: c(0, 0), week: c(0, 0), month: c(0, 0), all: c(0, 0) },
    warnings: [],
    accounts: buildAccountSections(views, NOW),
    sessions: buildReportSessions(views),
  };
}

/** Render, load into JSDOM with a pinned Date.now, and run the embedded script. */
function mount(views: SessionView[]): { doc: Document } {
  const html = renderHtml(reportData(views));
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    // Pin "now" BEFORE the embedded script runs so default range / presets are
    // deterministic (the script captures Date.now() at load).
    beforeParse(window) {
      window.Date.now = () => NOW;
    },
  });
  return { doc: dom.window.document };
}

describe("report date filter (DOM)", () => {
  // three sessions: today, 5 days ago, 20 days ago
  const views = [view("s-today", 0, 10), view("s-5d", 5, 3), view("s-20d", 20, 7)];

  let doc: Document;
  beforeEach(() => {
    ({ doc } = mount(views));
  });

  it("defaults to the last 30 days and totals every session in range", () => {
    // all three are within 30 days → 10 + 3 + 7 = 20
    expect(doc.getElementById("sel-cost")!.textContent).toBe("$20.00");
    expect(doc.getElementById("sel-sessions")!.textContent).toBe("3");
  });

  it("narrows the prominent KPI band when a 7-day preset is clicked", () => {
    const btn = doc.querySelector('.preset[data-preset="7"]') as HTMLButtonElement;
    btn.dispatchEvent(new doc.defaultView!.Event("click"));
    // only today (10) and 5d ago (3) fall in the last 7 days → 13
    expect(doc.getElementById("sel-cost")!.textContent).toBe("$13.00");
    expect(doc.getElementById("sel-sessions")!.textContent).toBe("2");
    // per-day average over the 7-day window: 13 / 7 = 1.857… → $1.86
    expect(doc.getElementById("sel-avg")!.textContent).toBe("$1.86");
  });

  it("hides out-of-range sessions in the breakdown tree", () => {
    const btn = doc.querySelector('.preset[data-preset="7"]') as HTMLButtonElement;
    btn.dispatchEvent(new doc.defaultView!.Event("click"));
    const s20 = doc.querySelector('[data-session-id="s-20d"]') as HTMLElement;
    const sToday = doc.querySelector('[data-session-id="s-today"]') as HTMLElement;
    expect(s20.classList.contains("hidden")).toBe(true);
    expect(sToday.classList.contains("hidden")).toBe(false);
  });

  it("hides the workspace filter chip when that workspace has no sessions in range", () => {
    // a second workspace whose only session is 20 days old
    const { doc: d } = mount([view("s-today", 0, 10), view("s-b", 20, 4, ACC, WS2)]);
    const chipB = (
      d.querySelector('input[data-filter="workspace"][value="Proj B"]') as HTMLElement
    ).closest(".chip") as HTMLElement;
    const chipA = (
      d.querySelector('input[data-filter="workspace"][value="Proj A"]') as HTMLElement
    ).closest(".chip") as HTMLElement;
    const btn = d.querySelector('.preset[data-preset="7"]') as HTMLButtonElement;
    btn.dispatchEvent(new d.defaultView!.Event("click"));
    expect(chipB.classList.contains("hidden")).toBe(true);
    expect(chipA.classList.contains("hidden")).toBe(false);
  });

  it("recomputes the workspace rollup from the visible sessions only", () => {
    const btn = doc.querySelector('.preset[data-preset="7"]') as HTMLButtonElement;
    btn.dispatchEvent(new doc.defaultView!.Event("click"));
    const wsRow = doc.querySelector(".tnode.level-workspace > .tnode-row") as HTMLElement;
    // 10 + 3 = 13 after the 7d filter (the 20d session is excluded)
    expect(wsRow.querySelector(".tnode-cost")!.textContent).toBe("$13.00");
  });

  it("updates the account tab total for the selected range", () => {
    const btn = doc.querySelector('.preset[data-preset="7"]') as HTMLButtonElement;
    btn.dispatchEvent(new doc.defaultView!.Event("click"));
    const total = doc.querySelector('[data-acc-tab="Perso"] [data-acc-total]')!;
    expect(total.textContent).toBe("$13.00");
  });

  it("recomputes the acc-head meta counts for the selected range", () => {
    const btn = doc.querySelector('.preset[data-preset="7"]') as HTMLButtonElement;
    btn.dispatchEvent(new doc.defaultView!.Event("click"));
    // 2 of 3 sessions fall in the last 7 days; the single named teammate "dev"
    const meta = doc.querySelector('[data-acc-panel="Perso"] [data-acc-meta]')!;
    expect(meta.textContent).toBe("2 sessions · 1 teammate");
  });
});

describe("report date filter — accounts used (DOM)", () => {
  const STALE: Account = { dir: "/h/.stale", label: "Stale" };
  const LIVE: Account = { dir: "/h/.live", label: "Live" };
  // "Stale" only has a 20-day-old session (and a higher cost, so it sorts first
  // and is the active tab by default); "Live" has a session today.
  const views = [view("s-old", 20, 50, STALE), view("s-new", 0, 5, LIVE)];

  let doc: Document;
  beforeEach(() => {
    ({ doc } = mount(views));
  });

  it("shows both accounts in the default 30-day range", () => {
    const stale = doc.querySelector('[data-acc-tab="Stale"]') as HTMLElement;
    const live = doc.querySelector('[data-acc-tab="Live"]') as HTMLElement;
    expect(stale.classList.contains("hidden")).toBe(false);
    expect(live.classList.contains("hidden")).toBe(false);
  });

  it("removes an account with no sessions in range and re-activates a live one", () => {
    const btn = doc.querySelector('.preset[data-preset="7"]') as HTMLButtonElement;
    btn.dispatchEvent(new doc.defaultView!.Event("click"));

    const staleTab = doc.querySelector('[data-acc-tab="Stale"]') as HTMLElement;
    const stalePanel = doc.querySelector('[data-acc-panel="Stale"]') as HTMLElement;
    const liveTab = doc.querySelector('[data-acc-tab="Live"]') as HTMLElement;
    const livePanel = doc.querySelector('[data-acc-panel="Live"]') as HTMLElement;

    // Stale's only session (20d) is out of the 7d window → tab + panel gone.
    expect(staleTab.classList.contains("hidden")).toBe(true);
    expect(stalePanel.classList.contains("hidden")).toBe(true);
    // The active account follows to the one that still has data.
    expect(liveTab.classList.contains("hidden")).toBe(false);
    expect(liveTab.classList.contains("active")).toBe(true);
    expect(livePanel.classList.contains("hidden")).toBe(false);
  });
});
