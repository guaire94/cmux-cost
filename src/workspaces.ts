import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveCmuxBin } from "./cmux.js";
import { workspacesSidecarPath } from "./paths.js";
import type { Workspace } from "./types.js";

export interface WorkspaceRecord {
  workspaceId: string;
  title: string;
  /** the cmux tab (surface) title the session ran in, e.g. "Refactor cost report" */
  tab?: string;
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

/** The cmux tab title the session ran in, if it was recorded. */
export function tabTitleFor(map: WorkspaceMap, sessionId: string): string | undefined {
  const tab = map[sessionId]?.tab?.trim();
  return tab ? tab : undefined;
}

/**
 * Strip cmux's leading status glyph (braille spinner ⠂, star ✳, etc.) from a
 * surface title so we keep the human part: "⠂ Refactor cost report" -> "Refactor
 * cost report". User-chosen names like "[Checkout.com] Flow SDk" are left intact.
 */
export function cleanTabTitle(raw: string): string {
  // ☀-➿ misc symbols + dingbats (✳ ✶ …), ⠀-⣿ braille spinner,
  // ️ variation selector, plus whitespace.
  return raw.replace(/^[☀-➿⠀-⣿️\s]+/u, "").trim();
}

/** Parse `cmux --id-format both list-pane-surfaces` stdout into UUID -> tab title. */
export function parseSurfaceList(stdout: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/^\s*\*?\s*/, "").trim();
    const m = line.match(/^surface:\S+\s+([0-9A-Fa-f-]{36})\s+(.*)$/);
    if (!m) continue;
    const id = m[1];
    const rest = m[2];
    if (!id || rest === undefined) continue;
    // drop a trailing state flag like " [selected]" before cleaning the glyph
    const title = cleanTabTitle(rest.replace(/\s*\[[^\]]*\]\s*$/, "").trim());
    if (title) map.set(id, title);
  }
  return map;
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

/** Resolve a surface (tab) UUID to its cleaned title via cmux; "" if unavailable. */
export function resolveSurfaceTitle(surfaceId: string): string {
  const bin = resolveCmuxBin();
  if (!bin) return "";
  try {
    const out = execFileSync(bin, ["--id-format", "both", "list-pane-surfaces"], {
      encoding: "utf8",
      timeout: 4000,
    });
    return parseSurfaceList(out).get(surfaceId) ?? "";
  } catch {
    return "";
  }
}

/** Best-effort: record session -> workspace + tab into the sidecar. Never throws. */
export function recordWorkspace(
  sessionId: string,
  workspaceId: string,
  nowMs: number,
  surfaceId?: string,
): void {
  try {
    const path = workspacesSidecarPath();
    const map = loadWorkspaceMap(path);
    const title = resolveWorkspaceTitle(workspaceId);
    // Keep a previously captured tab title if cmux can't give us one now.
    const tab = (surfaceId ? resolveSurfaceTitle(surfaceId) : "") || map[sessionId]?.tab || "";
    const next = upsertWorkspace(map, sessionId, {
      workspaceId,
      title,
      tab: tab || undefined,
      lastSeen: nowMs,
    });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  } catch {
    // best-effort
  }
}
