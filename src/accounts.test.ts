import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveLabel, resolveAccounts, scanClaudeDirs } from "./accounts.js";
import { DEFAULT_CONFIG } from "./config.js";

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "cmux-cost-home-"));
}
function addAccount(home: string, name: string, transcripts: number): void {
  const projects = join(home, name, "projects", "proj-a");
  mkdirSync(projects, { recursive: true });
  for (let i = 0; i < transcripts; i++) {
    writeFileSync(join(projects, `s${i}.jsonl`), "");
  }
}

describe("deriveLabel", () => {
  it("titlecases the suffix after .claude-", () => {
    expect(deriveLabel("/h/.claude-talabat")).toBe("Talabat");
    expect(deriveLabel("/h/.claude-personal")).toBe("Personal");
  });
  it("labels the bare .claude (and xdg claude) as Default", () => {
    expect(deriveLabel("/h/.claude")).toBe("Default");
    expect(deriveLabel("/h/.config/claude")).toBe("Default");
  });
});

describe("scanClaudeDirs", () => {
  it("finds only dirs with a projects/ subdir, sorted by transcript count desc", () => {
    const home = makeHome();
    addAccount(home, ".claude-personal", 3);
    addAccount(home, ".claude-talabat", 5);
    mkdirSync(join(home, ".claude-empty")); // no projects/ -> ignored
    const got = scanClaudeDirs(home);
    expect(got.map((s) => [s.label, s.transcripts])).toEqual([
      ["Talabat", 5],
      ["Personal", 3],
    ]);
  });
});

describe("resolveAccounts", () => {
  it("returns enabled configured accounts when present", () => {
    const home = makeHome();
    addAccount(home, ".claude-personal", 1);
    const accounts = resolveAccounts(
      {
        ...DEFAULT_CONFIG,
        accounts: [
          { dir: "/h/.claude-talabat", label: "Talabat", enabled: true },
          { dir: "/h/.claude", label: "Default", enabled: false },
        ],
      },
      home,
    );
    expect(accounts).toEqual([{ dir: "/h/.claude-talabat", label: "Talabat" }]);
  });

  it("falls back to scanning every dir when no accounts configured", () => {
    const home = makeHome();
    addAccount(home, ".claude-talabat", 2);
    const accounts = resolveAccounts({ ...DEFAULT_CONFIG }, home);
    expect(accounts).toEqual([{ dir: join(home, ".claude-talabat"), label: "Talabat" }]);
  });
});
