import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const HOOK_EVENTS = ["Stop", "SubagentStop"] as const;
const DOCK_ID = "cost";

interface CommandHook {
  type: "command";
  command: string;
}
interface HookGroup {
  matcher?: string;
  hooks: CommandHook[];
}

/** Add our hook command to the Stop/SubagentStop events, idempotently. */
export function withClaudeHook(
  settings: Record<string, unknown>,
  command: string,
): Record<string, unknown> {
  const next = { ...settings };
  const hooks = { ...((next.hooks as Record<string, unknown>) ?? {}) };
  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(hooks[event])
      ? ([...(hooks[event] as HookGroup[])])
      : [];
    const already = groups.some((g) =>
      g?.hooks?.some((h) => h?.command === command),
    );
    if (!already) {
      groups.push({ hooks: [{ type: "command", command }] });
    }
    hooks[event] = groups;
  }
  next.hooks = hooks;
  return next;
}

/** Remove our hook command from all events. */
export function withoutClaudeHook(
  settings: Record<string, unknown>,
  command: string,
): Record<string, unknown> {
  const next = { ...settings };
  const hooks = { ...((next.hooks as Record<string, unknown>) ?? {}) };
  for (const event of HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) continue;
    const groups = (hooks[event] as HookGroup[])
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => h?.command !== command) }))
      .filter((g) => g.hooks.length > 0);
    if (groups.length > 0) hooks[event] = groups;
    else delete hooks[event];
  }
  next.hooks = hooks;
  return next;
}

interface DockControl {
  id: string;
  title: string;
  command: string;
  height?: number;
}

/** Add (or update) the Cost dock control, idempotently. */
export function withDockControl(
  dock: Record<string, unknown>,
  control: DockControl,
): Record<string, unknown> {
  const next = { ...dock };
  const controls = Array.isArray(next.controls)
    ? ([...(next.controls as DockControl[])])
    : [];
  const idx = controls.findIndex((c) => c?.id === control.id);
  if (idx >= 0) controls[idx] = control;
  else controls.push(control);
  next.controls = controls;
  return next;
}

/** Remove the Cost dock control. */
export function withoutDockControl(dock: Record<string, unknown>): Record<string, unknown> {
  const next = { ...dock };
  if (Array.isArray(next.controls)) {
    next.controls = (next.controls as DockControl[]).filter((c) => c?.id !== DOCK_ID);
  }
  return next;
}

// ---- filesystem wrappers (thin, not unit-tested) -------------------------

function readJson(path: string): Record<string, unknown> {
  try {
    const v = JSON.parse(readFileSync(path, "utf8"));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeJsonWithBackup(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(path, `${path}.bak-${stamp}`);
  }
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

export function installHook(settingsPath: string, command: string): void {
  writeJsonWithBackup(settingsPath, withClaudeHook(readJson(settingsPath), command));
}

export function uninstallHook(settingsPath: string, command: string): void {
  if (!existsSync(settingsPath)) return;
  writeJsonWithBackup(settingsPath, withoutClaudeHook(readJson(settingsPath), command));
}

export function installDock(dockPath: string, command: string): void {
  const control: DockControl = { id: DOCK_ID, title: "💰 Cost", command, height: 260 };
  writeJsonWithBackup(dockPath, withDockControl(readJson(dockPath), control));
}

export function uninstallDock(dockPath: string): void {
  if (!existsSync(dockPath)) return;
  writeJsonWithBackup(dockPath, withoutDockControl(readJson(dockPath)));
}
