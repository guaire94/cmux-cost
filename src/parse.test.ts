import { describe, expect, it } from "vitest";
import { extractLabel, parseTranscript } from "./parse.js";

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
  it("prefers a teammate-message summary attribute", () => {
    const content = line({
      type: "user",
      message: {
        content: '<teammate-message teammate_id="team-lead" summary="Build auth feature"> You are',
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
