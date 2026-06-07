import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAllSessions } from "./discover.js";
import type { Account } from "./types.js";

function seedAccount(home: string, name: string, sessionId: string): Account {
  const dir = join(home, name);
  const projects = join(dir, "projects", "proj-a");
  mkdirSync(projects, { recursive: true });
  writeFileSync(join(projects, `${sessionId}.jsonl`), "");
  return { dir, label: name.replace(/^\.claude-?/, "") || "Default" };
}

describe("loadAllSessions", () => {
  it("loads sessions from each account and tags them", () => {
    const home = mkdtempSync(join(tmpdir(), "cmux-cost-disc-"));
    const a = seedAccount(home, ".claude-personal", "aaaa1111");
    const b = seedAccount(home, ".claude-talabat", "bbbb2222");
    const sessions = loadAllSessions([a, b]);
    const byId = Object.fromEntries(sessions.map((s) => [s.id, s.account.label]));
    expect(byId["aaaa1111"]).toBe("personal");
    expect(byId["bbbb2222"]).toBe("talabat");
    expect(sessions.length).toBe(2);
  });
});
