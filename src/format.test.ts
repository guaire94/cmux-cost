import { describe, expect, it } from "vitest";
import { fmtCost, fmtTimeAgo, fmtTokens, fmtUsd } from "./format.js";

describe("fmtCost", () => {
  it("renders a known cost plainly", () => {
    expect(fmtCost({ cost: 2.5, partial: false })).toBe("$2.50");
  });
  it("appends + when partial with a known sum", () => {
    expect(fmtCost({ cost: 2.5, partial: true })).toBe("$2.50+");
  });
  it("shows em dash when partial and nothing is known", () => {
    expect(fmtCost({ cost: 0, partial: true })).toBe("—");
  });
});

describe("fmtUsd", () => {
  it("shows 4 digits under $1 and 2 above", () => {
    expect(fmtUsd(0.321)).toBe("$0.3210");
    expect(fmtUsd(12.5)).toBe("$12.50");
  });
  it("renders unknown as em dash", () => {
    expect(fmtUsd(null)).toBe("—");
  });
  it("handles non-USD currency", () => {
    expect(fmtUsd(3, "AED")).toBe("3.00 AED");
  });
});

describe("fmtTokens", () => {
  it("formats with k/M suffixes", () => {
    expect(fmtTokens(999)).toBe("999");
    expect(fmtTokens(1500)).toBe("1.5k");
    expect(fmtTokens(2_300_000)).toBe("2.3M");
  });
});

describe("fmtTimeAgo", () => {
  const now = 1_000_000_000_000;
  it("scales seconds to days", () => {
    expect(fmtTimeAgo(now, now)).toBe("0s");
    expect(fmtTimeAgo(now - 90_000, now)).toBe("1m");
    expect(fmtTimeAgo(now - 3 * 3600_000, now)).toBe("3h");
    expect(fmtTimeAgo(now - 2 * 86_400_000, now)).toBe("2d");
  });
  it("renders 0 as em dash", () => {
    expect(fmtTimeAgo(0, now)).toBe("—");
  });
});
