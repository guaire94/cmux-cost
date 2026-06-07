import { describe, expect, it } from "vitest";
import {
  withClaudeHook,
  withDockControl,
  withoutClaudeHook,
  withoutDockControl,
} from "./install.js";

const CMD = "node cli.js hook";

describe("withClaudeHook", () => {
  it("adds the command to Stop and SubagentStop", () => {
    const out = withClaudeHook({}, CMD);
    const hooks = out.hooks as Record<string, any[]>;
    expect(hooks.Stop![0].hooks[0].command).toBe(CMD);
    expect(hooks.SubagentStop![0].hooks[0].command).toBe(CMD);
  });

  it("is idempotent", () => {
    const once = withClaudeHook({}, CMD);
    const twice = withClaudeHook(once, CMD);
    expect((twice.hooks as any).Stop).toHaveLength(1);
  });

  it("preserves existing unrelated hooks", () => {
    const existing = { hooks: { Stop: [{ hooks: [{ type: "command", command: "other" }] }] } };
    const out = withClaudeHook(existing, CMD);
    const cmds = (out.hooks as any).Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(cmds).toContain("other");
    expect(cmds).toContain(CMD);
  });
});

describe("withoutClaudeHook", () => {
  it("removes only our command and drops empty events", () => {
    const withHook = withClaudeHook({}, CMD);
    const out = withoutClaudeHook(withHook, CMD);
    expect((out.hooks as any).Stop).toBeUndefined();
  });
});

describe("withDockControl", () => {
  it("adds the control once and updates in place", () => {
    const ctrl = { id: "cost", title: "💰 Cost", command: "node cli.js dock" };
    const first = withDockControl({}, ctrl);
    expect((first.controls as any[])).toHaveLength(1);
    const updated = withDockControl(first, { ...ctrl, title: "Cost!" });
    expect((updated.controls as any[])).toHaveLength(1);
    expect((updated.controls as any[])[0].title).toBe("Cost!");
  });

  it("keeps other controls", () => {
    const dock = { controls: [{ id: "git", title: "Git", command: "lazygit" }] };
    const out = withDockControl(dock, { id: "cost", title: "Cost", command: "x" });
    expect((out.controls as any[]).map((c) => c.id)).toEqual(["git", "cost"]);
  });
});

describe("withoutDockControl", () => {
  it("removes the cost control only", () => {
    const dock = {
      controls: [
        { id: "git", title: "Git", command: "lazygit" },
        { id: "cost", title: "Cost", command: "x" },
      ],
    };
    const out = withoutDockControl(dock);
    expect((out.controls as any[]).map((c) => c.id)).toEqual(["git"]);
  });
});
