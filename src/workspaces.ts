import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveCmuxBin } from "./cmux.js";
import { workspacesSidecarPath } from "./paths.js";
import type { Workspace } from "./types.js";

export interface WorkspaceRecord {
  workspaceId: string;
  title: string;
  lastSeen: number;
}
export type WorkspaceMap = Record<string, WorkspaceRecord>;

/** Parse `cmux --id-format both list-workspaces` stdout into UUID -> title. */
export function parseWorkspaceList(stdout: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/^\s*\*?\s*/, "").trim();
    const m = line.match(/^workspace:\S+\s+([0-9A-Fa-f-]{36})\s+(.*)$/);
    if (!m) continue;
    const id = m[1];
    const rest = m[2];
    if (!id || rest === undefined) continue;
    const title = rest.replace(/\s*\[selected\]\s*$/, "").trim();
    if (title) map.set(id, title);
  }
  return map;
}

export function upsertWorkspace(
  map: WorkspaceMap,
  sessionId: string,
  rec: WorkspaceRecord,
): WorkspaceMap {
  return { ...map, [sessionId]: rec };
}

export function workspaceFor(map: WorkspaceMap, sessionId: string): Workspace | undefined {
  const r = map[sessionId];
  return r ? { id: r.workspaceId, title: r.title } : undefined;
}

// ---- filesystem / cmux side-effects (not unit-tested) --------------------

export function loadWorkspaceMap(path: string = workspacesSidecarPath()): WorkspaceMap {
  try {
    const v = JSON.parse(readFileSync(path, "utf8"));
    return v && typeof v === "object" ? (v as WorkspaceMap) : {};
  } catch {
    return {};
  }
}

/** Resolve a workspace UUID to its title via cmux; "" if unavailable. */
export function resolveWorkspaceTitle(workspaceId: string): string {
  const bin = resolveCmuxBin();
  if (!bin) return "";
  try {
    const out = execFileSync(bin, ["--id-format", "both", "list-workspaces"], {
      encoding: "utf8",
      timeout: 4000,
    });
    return parseWorkspaceList(out).get(workspaceId) ?? "";
  } catch {
    return "";
  }
}

/** Best-effort: record session -> workspace into the sidecar. Never throws. */
export function recordWorkspace(sessionId: string, workspaceId: string, nowMs: number): void {
  try {
    const path = workspacesSidecarPath();
    const map = loadWorkspaceMap(path);
    const title = resolveWorkspaceTitle(workspaceId);
    const next = upsertWorkspace(map, sessionId, { workspaceId, title, lastSeen: nowMs });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  } catch {
    // best-effort
  }
}
