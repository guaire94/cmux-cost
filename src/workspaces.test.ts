import { describe, expect, it } from "vitest";
import { parseWorkspaceList, upsertWorkspace, workspaceFor } from "./workspaces.js";

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

describe("sidecar map", () => {
  it("upserts a record and looks it up as a Workspace", () => {
    let map = {};
    map = upsertWorkspace(map, "sess-1", {
      workspaceId: "WID",
      title: "[Talabat] Flutter App",
      lastSeen: 123,
    });
    expect(workspaceFor(map, "sess-1")).toEqual({ id: "WID", title: "[Talabat] Flutter App" });
    expect(workspaceFor(map, "missing")).toBeUndefined();
  });
});
