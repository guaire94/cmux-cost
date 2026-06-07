import { describe, expect, it } from "vitest";
import { accountsFromPicks } from "./setup.js";

describe("accountsFromPicks", () => {
  const scanned = [
    { dir: "/h/.claude-talabat", label: "Talabat", transcripts: 5 },
    { dir: "/h/.claude-personal", label: "Personal", transcripts: 3 },
    { dir: "/h/.claude", label: "Default", transcripts: 1 },
  ];

  it("marks selected indices enabled and keeps the rest disabled", () => {
    const picks = accountsFromPicks(scanned, new Set([0, 1]), { 0: "Work" });
    expect(picks).toEqual([
      { dir: "/h/.claude-talabat", label: "Work", enabled: true },
      { dir: "/h/.claude-personal", label: "Personal", enabled: true },
      { dir: "/h/.claude", label: "Default", enabled: false },
    ]);
  });
});
