import { describe, expect, it } from "vitest";
import {
  cleanTabTitle,
  parseSurfaceList,
  parseWorkspaceList,
  tabTitleFor,
  upsertWorkspace,
  workspaceFor,
} from "./workspaces.js";

const SAMPLE = [
  "* workspace:9 FDEAC62F-488C-448A-A133-6CAAC0340241  [Klozy] Global  [selected]",
  "  workspace:1 E10D1FAE-1C06-42A0-9B97-7ECBA21FFC52  [Talabat] Flutter App",
  "garbage line",
].join("\n");

describe("parseWorkspaceList", () => {
  it("maps UUID -> title, dropping the * and [selected] markers", () => {
    const map = parseWorkspaceList(SAMPLE);
    expect(map.get("FDEAC62F-488C-448A-A133-6CAAC0340241")).toBe("[Klozy] Global");
    expect(map.get("E10D1FAE-1C06-42A0-9B97-7ECBA21FFC52")).toBe("[Talabat] Flutter App");
    expect(map.size).toBe(2);
  });
});

const SURFACES = [
  "* surface:98 F39893F5-A561-463D-A9CE-F652E7ED5845  ⠂ Refactor cost report  [selected]",
  "  surface:99 2BFD8500-1DB8-428E-A68F-0E3722715C7F  [Checkout.com] Flow SDk",
  "noise",
].join("\n");

describe("parseSurfaceList", () => {
  it("maps surface UUID -> tab title, stripping the spinner glyph and [selected]", () => {
    const map = parseSurfaceList(SURFACES);
    expect(map.get("F39893F5-A561-463D-A9CE-F652E7ED5845")).toBe("Refactor cost report");
    expect(map.get("2BFD8500-1DB8-428E-A68F-0E3722715C7F")).toBe("[Checkout.com] Flow SDk");
    expect(map.size).toBe(2);
  });
});

describe("cleanTabTitle", () => {
  it("strips leading status glyphs but keeps user-chosen names", () => {
    expect(cleanTabTitle("⠂ Refactor cost report")).toBe("Refactor cost report");
    expect(cleanTabTitle("✳ Build mobile app")).toBe("Build mobile app");
    expect(cleanTabTitle("[Checkout.com] Flow SDk")).toBe("[Checkout.com] Flow SDk");
    expect(cleanTabTitle("…/projects/perso/cmux-cost")).toBe("…/projects/perso/cmux-cost");
  });
});

describe("sidecar map", () => {
  it("upserts a record and looks it up as a Workspace", () => {
    let map = {};
    map = upsertWorkspace(map, "sess-1", {
      workspaceId: "WID",
      title: "[Talabat] Flutter App",
      tab: "Refactor cost report",
      lastSeen: 123,
    });
    expect(workspaceFor(map, "sess-1")).toEqual({ id: "WID", title: "[Talabat] Flutter App" });
    expect(workspaceFor(map, "missing")).toBeUndefined();
  });

  it("exposes the tab title only when one was recorded", () => {
    const withTab = upsertWorkspace({}, "s1", {
      workspaceId: "W",
      title: "WS",
      tab: "My session",
      lastSeen: 1,
    });
    expect(tabTitleFor(withTab, "s1")).toBe("My session");
    const noTab = upsertWorkspace({}, "s2", { workspaceId: "W", title: "WS", lastSeen: 1 });
    expect(tabTitleFor(noTab, "s2")).toBeUndefined();
  });
});
