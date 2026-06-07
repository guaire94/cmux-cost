import { describe, expect, it } from "vitest";
import { normalizeModelId } from "./model.js";

const known = [
  "anthropic/claude-opus-4.8",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-haiku-4.5",
  "anthropic/claude-3.5-sonnet",
  "google/gemini-2.5-flash",
];

describe("normalizeModelId", () => {
  it("maps dash-versioned Claude ids to dotted OpenRouter ids", () => {
    expect(normalizeModelId("claude-opus-4-8", known)).toBe("anthropic/claude-opus-4.8");
    expect(normalizeModelId("claude-sonnet-4-6", known)).toBe("anthropic/claude-sonnet-4.6");
  });

  it("strips a trailing date stamp", () => {
    expect(normalizeModelId("claude-haiku-4-5-20251001", known)).toBe(
      "anthropic/claude-haiku-4.5",
    );
    expect(normalizeModelId("claude-3-5-sonnet-20241022", known)).toBe(
      "anthropic/claude-3.5-sonnet",
    );
  });

  it("honours overrides above matching", () => {
    expect(
      normalizeModelId("weird-model", known, { "weird-model": "google/gemini-2.5-flash" }),
    ).toBe("google/gemini-2.5-flash");
  });

  it("returns an already-known id unchanged", () => {
    expect(normalizeModelId("google/gemini-2.5-flash", known)).toBe("google/gemini-2.5-flash");
  });

  it("returns null when nothing matches", () => {
    expect(normalizeModelId("gpt-4o", known)).toBeNull();
    expect(normalizeModelId("", known)).toBeNull();
  });

  it("prefers the shortest containing id", () => {
    const ids = ["anthropic/claude-opus-4.8", "anthropic/claude-opus-4.8-thinking-extra"];
    expect(normalizeModelId("claude-opus-4-8", ids)).toBe("anthropic/claude-opus-4.8");
  });
});
