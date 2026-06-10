import { describe, expect, it } from "vitest";
import { displayLabel, extractLabel, parseAgentMeta, parseTranscript } from "./parse.js";

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

describe("parseTranscript", () => {
  it("sums usage per model and ignores non-usage lines", () => {
    const content = [
      line({ type: "user", message: { content: "hi" } }),
      line({
        type: "assistant",
        message: {
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 200,
          },
        },
      }),
      line({
        type: "assistant",
        message: {
          model: "claude-sonnet-4-6",
          usage: { input_tokens: 1, output_tokens: 2 },
        },
      }),
      "not json at all",
      line({ type: "summary" }),
    ].join("\n");

    const byModel = parseTranscript(content);
    expect(byModel.size).toBe(1);
    expect(byModel.get("claude-sonnet-4-6")).toEqual({
      input: 11,
      output: 7,
      cacheCreation: 100,
      cacheRead: 200,
    });
  });

  it("separates models and defaults missing model to 'unknown'", () => {
    const content = [
      line({ message: { model: "a", usage: { input_tokens: 1 } } }),
      line({ message: { usage: { output_tokens: 4 } } }),
    ].join("\n");
    const byModel = parseTranscript(content);
    expect(byModel.get("a")?.input).toBe(1);
    expect(byModel.get("unknown")?.output).toBe(4);
  });

  it("skips non-billed <synthetic> messages", () => {
    const content = [
      line({ message: { model: "<synthetic>", usage: { input_tokens: 999, output_tokens: 999 } } }),
      line({ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 5 } } }),
    ].join("\n");
    const byModel = parseTranscript(content);
    expect(byModel.has("<synthetic>")).toBe(false);
    expect(byModel.get("claude-sonnet-4-6")?.input).toBe(5);
  });

  it("tolerates empty input", () => {
    expect(parseTranscript("").size).toBe(0);
    expect(parseTranscript("\n\n").size).toBe(0);
  });
});

describe("extractLabel", () => {
  it("combines the teammate's own name with its task summary", () => {
    const content = line({
      type: "user",
      message: {
        content:
          '<teammate-message teammate_id="team-lead" summary="Port full mock fixtures">\nYou are `data-dev` on team `thawb`.',
      },
    });
    expect(extractLabel(content)).toBe("[data-dev] Port full mock fixtures");
  });

  it("uses the summary alone when there is no self-introduction", () => {
    const content = line({
      type: "user",
      message: {
        content: '<teammate-message teammate_id="team-lead" summary="Build auth feature"> work',
      },
    });
    expect(extractLabel(content)).toBe("Build auth feature");
  });

  it("uses text after a 'Your scope:' marker when present", () => {
    const content = line({
      type: "user",
      message: { content: "Audit the app. Your scope: **Selling — listings**. Return a list." },
    });
    expect(extractLabel(content)).toBe("Selling — listings. Return a list.");
  });

  it("skips continuation/caveat boilerplate and finds a real prompt", () => {
    const content = [
      line({ type: "user", message: { content: "This session is being continued from a previous conversation…" } }),
      line({ type: "user", message: { content: "Implement the scheduling feature end to end" } }),
    ].join("\n");
    expect(extractLabel(content)).toBe("Implement the scheduling feature end to end");
  });

  it("strips XML tags from the fallback line", () => {
    const content = line({
      type: "user",
      message: { content: "<wrapper>do the thing properly</wrapper>" },
    });
    expect(extractLabel(content)).toBe("do the thing properly");
  });

  it("returns undefined when no user text exists", () => {
    const content = line({ type: "assistant", message: { model: "a", usage: {} } });
    expect(extractLabel(content)).toBeUndefined();
  });
});

describe("displayLabel", () => {
  it("renders [handle] (type) task when handle and type differ", () => {
    expect(displayLabel("dbg-auth", "debugger", "Fix login race")).toBe(
      "[dbg-auth] (debugger) Fix login race",
    );
  });

  it("collapses to [handle] task when handle equals type", () => {
    expect(displayLabel("carto-epics", "carto-epics", "Map EPIC 1-3")).toBe(
      "[carto-epics] Map EPIC 1-3",
    );
  });

  it("drops the parenthetical when there is no type", () => {
    expect(displayLabel("data-dev", undefined, "Port mocks")).toBe("[data-dev] Port mocks");
  });

  it("uses the type as the agent when no handle is given", () => {
    expect(displayLabel(undefined, "debugger", "Fix it")).toBe("[debugger] Fix it");
  });

  it("returns the task alone when no handle or type is known", () => {
    expect(displayLabel(undefined, undefined, "Some scope")).toBe("Some scope");
  });

  it("returns the bracketed agent alone when there is no task", () => {
    expect(displayLabel("dbg-auth", "debugger", undefined)).toBe("[dbg-auth] (debugger)");
  });

  it("returns undefined when nothing is known", () => {
    expect(displayLabel(undefined, undefined, undefined)).toBeUndefined();
  });
});

describe("parseAgentMeta", () => {
  it("reads the handle from name, the type from agentType, and the task from description", () => {
    const meta = JSON.stringify({
      agentType: "business-dev",
      name: "bdev-lotA",
      description: "LOT A core+auth+user",
    });
    expect(parseAgentMeta(meta)).toEqual({
      handle: "bdev-lotA",
      type: "business-dev",
      task: "LOT A core+auth+user",
    });
  });

  it("falls back to agentType as the only identity when name/description are absent", () => {
    expect(parseAgentMeta(JSON.stringify({ agentType: "carto-epics" }))).toEqual({
      type: "carto-epics",
    });
  });

  it("returns an empty identity for unparseable or empty content", () => {
    expect(parseAgentMeta("not json")).toEqual({});
    expect(parseAgentMeta("")).toEqual({});
  });
});
