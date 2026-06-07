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

  it("tolerates empty input", () => {
    expect(parseTranscript("").size).toBe(0);
    expect(parseTranscript("\n\n").size).toBe(0);
  });
});

describe("extractLabel", () => {
  it("prefers text after a 'Your scope:' marker", () => {
    const content = line({
      type: "user",
      message: { content: "Audit the app. Your scope: **Selling — listings**. Return a list." },
    });
    expect(extractLabel(content)).toBe("**Selling — listings**. Return a list.".replace(/[*#]/g, ""));
  });

  it("falls back to the first meaningful user line, truncated to 80 chars", () => {
    const long = "x".repeat(200);
    const content = line({ type: "user", message: { content: long } });
    expect(extractLabel(content)).toHaveLength(80);
  });

  it("returns undefined when no user text exists", () => {
    const content = line({ type: "assistant", message: { model: "a", usage: {} } });
    expect(extractLabel(content)).toBeUndefined();
  });
});
