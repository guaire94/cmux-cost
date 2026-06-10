import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAllSessions, loadSession } from "./discover.js";
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

describe("loadSession teammate identity", () => {
  function seedSession(home: string): { id: string; mainPath: string; account: Account } {
    const dir = join(home, ".claude-personal", "projects", "proj-x");
    const subagents = join(dir, "sess1", "subagents");
    mkdirSync(subagents, { recursive: true });
    const mainPath = join(dir, "sess1.jsonl");
    writeFileSync(mainPath, "");
    return { id: "sess1", mainPath, account: { dir, label: "personal" } };
  }

  it("labels a teammate from its meta sidecar as [handle] (type) task", () => {
    const home = mkdtempSync(join(tmpdir(), "cmux-cost-meta-"));
    const { id, mainPath, account } = seedSession(home);
    const subdir = join(mainPath.replace(/\.jsonl$/, ""), "subagents");
    writeFileSync(
      join(subdir, "agent-aaa.jsonl"),
      JSON.stringify({
        type: "user",
        message: {
          content: '<teammate-message teammate_id="team-lead" summary="Fix login race">go</teammate-message>',
        },
      }),
    );
    writeFileSync(
      join(subdir, "agent-aaa.meta.json"),
      JSON.stringify({ agentType: "debugger", name: "dbg-auth" }),
    );

    const session = loadSession({ id, project: "proj-x", mainPath }, account);
    const mate = session.teammates.find((t) => t.id === "aaa")!;
    expect(mate.name).toBe("dbg-auth");
    expect(mate.agentType).toBe("debugger");
    expect(mate.label).toBe("[dbg-auth] (debugger) Fix login race");
  });

  it("uses agentType alone as the agent when the sidecar has no name handle", () => {
    const home = mkdtempSync(join(tmpdir(), "cmux-cost-meta-"));
    const { id, mainPath, account } = seedSession(home);
    const subdir = join(mainPath.replace(/\.jsonl$/, ""), "subagents");
    writeFileSync(
      join(subdir, "agent-bbb.jsonl"),
      JSON.stringify({
        type: "user",
        message: {
          content: '<teammate-message teammate_id="team-lead" summary="Map EPIC 1-3">go</teammate-message>',
        },
      }),
    );
    writeFileSync(join(subdir, "agent-bbb.meta.json"), JSON.stringify({ agentType: "carto-epics" }));

    const session = loadSession({ id, project: "proj-x", mainPath }, account);
    const mate = session.teammates.find((t) => t.id === "bbb")!;
    expect(mate.name).toBeUndefined();
    expect(mate.agentType).toBe("carto-epics");
    expect(mate.label).toBe("[carto-epics] Map EPIC 1-3");
  });

  it("falls back to the meta description for the task when the transcript has none", () => {
    const home = mkdtempSync(join(tmpdir(), "cmux-cost-meta-"));
    const { id, mainPath, account } = seedSession(home);
    const subdir = join(mainPath.replace(/\.jsonl$/, ""), "subagents");
    writeFileSync(join(subdir, "agent-ccc.jsonl"), "");
    writeFileSync(
      join(subdir, "agent-ccc.meta.json"),
      JSON.stringify({ agentType: "business-dev", name: "bdev-lotA", description: "LOT A core+auth" }),
    );

    const session = loadSession({ id, project: "proj-x", mainPath }, account);
    const mate = session.teammates.find((t) => t.id === "ccc")!;
    expect(mate.label).toBe("[bdev-lotA] (business-dev) LOT A core+auth");
  });
});
