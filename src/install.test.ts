import { describe, expect, it } from "vitest";
import {
  stripJsonComments,
  withClaudeHook,
  withCostButton,
  withoutClaudeHook,
  withoutCostButton,
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

const BTN_CMD = "node cli.js open --close";

describe("withCostButton", () => {
  it("seeds built-in buttons + ours and registers the action", () => {
    const out = withCostButton({}, BTN_CMD);
    const buttons = (out.ui as any).surfaceTabBar.buttons as any[];
    expect(buttons.slice(0, 4)).toEqual([
      "cmux.newTerminal",
      "cmux.newBrowser",
      "cmux.splitRight",
      "cmux.splitDown",
    ]);
    expect(buttons[4]).toMatchObject({ action: "cmux-cost.report", title: "Cost" });
    expect((out.actions as any)["cmux-cost.report"].command).toBe(BTN_CMD);
  });

  it("is idempotent and preserves user buttons", () => {
    const seeded = { ui: { surfaceTabBar: { buttons: ["cmux.newTerminal", "my.button"] } } };
    const once = withCostButton(seeded, BTN_CMD);
    const twice = withCostButton(once, BTN_CMD);
    const buttons = (twice.ui as any).surfaceTabBar.buttons as any[];
    expect(buttons.filter((b) => isOurs(b))).toHaveLength(1);
    expect(buttons).toContain("my.button");
  });
});

describe("withoutCostButton", () => {
  it("removes our action + button and drops a defaults-only override", () => {
    const out = withoutCostButton(withCostButton({}, BTN_CMD));
    expect((out.actions as any)?.["cmux-cost.report"]).toBeUndefined();
    // buttons fell back to exactly the built-in defaults -> override removed entirely
    expect((out.ui as any)?.surfaceTabBar?.buttons).toBeUndefined();
  });

  it("keeps user buttons when removing ours", () => {
    const seeded = withCostButton(
      { ui: { surfaceTabBar: { buttons: ["my.button"] } } },
      BTN_CMD,
    );
    const out = withoutCostButton(seeded);
    expect((out.ui as any).surfaceTabBar.buttons).toEqual(["my.button"]);
  });
});

function isOurs(b: any): boolean {
  return b === "cmux-cost.report" || (b && typeof b === "object" && b.action === "cmux-cost.report");
}

describe("stripJsonComments", () => {
  it("removes // and /* */ comments but not // inside strings", () => {
    const jsonc = `{
  "$schema": "https://example.com/x", // trailing comment
  /* block */ "a": 1
}`;
    const parsed = JSON.parse(stripJsonComments(jsonc));
    expect(parsed).toEqual({ $schema: "https://example.com/x", a: 1 });
  });
});
