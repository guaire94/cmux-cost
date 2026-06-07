import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, mergeConfig } from "./config.js";

describe("mergeConfig", () => {
  it("returns defaults for empty/invalid input", () => {
    expect(mergeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(mergeConfig("nope")).toEqual(DEFAULT_CONFIG);
  });

  it("overlays provided fields and ignores junk types", () => {
    const c = mergeConfig({
      budgetSoft: 2,
      budgetHard: "x",
      projectRoots: ["/a", 5, "/b"],
      priceOverrides: { "m": "anthropic/x" },
    });
    expect(c.budgetSoft).toBe(2);
    expect(c.budgetHard).toBe(DEFAULT_CONFIG.budgetHard);
    expect(c.projectRoots).toEqual(["/a", "/b"]);
    expect(c.priceOverrides).toEqual({ m: "anthropic/x" });
  });
});
