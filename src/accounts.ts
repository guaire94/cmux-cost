import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { AccountConfig, Config } from "./config.js";
import type { Account } from "./types.js";

export interface ScannedDir {
  dir: string;
  label: string;
  transcripts: number;
}

/** ".claude-talabat" -> "Talabat"; ".claude" / ".config/claude" -> "Default". */
export function deriveLabel(dir: string): string {
  const base = basename(dir).replace(/^\./, ""); // "claude-talabat" | "claude"
  const rest = base.replace(/^claude/, "").replace(/^[-_]/, "");
  if (!rest) return "Default";
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** Scan a home dir for Claude config dirs that contain a projects/ subdir. */
export function scanClaudeDirs(home: string = homedir()): ScannedDir[] {
  const candidates: string[] = [];
  for (const name of safeReaddir(home)) {
    if (name === ".claude" || name.startsWith(".claude-") || name.startsWith(".claude_")) {
      candidates.push(join(home, name));
    }
  }
  candidates.push(join(home, ".config", "claude"));

  const out: ScannedDir[] = [];
  const seen = new Set<string>();
  for (const dir of candidates) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    const projects = join(dir, "projects");
    if (!isDir(projects)) continue;
    out.push({ dir, label: deriveLabel(dir), transcripts: countJsonl(projects) });
  }
  return out.sort((a, b) => b.transcripts - a.transcripts);
}

/** Active accounts: enabled configured ones, else every scanned dir. */
export function resolveAccounts(cfg: Config, home: string = homedir()): Account[] {
  const enabled = cfg.accounts.filter((a) => a.enabled);
  if (enabled.length > 0) {
    return enabled.map((a: AccountConfig) => ({ dir: a.dir, label: a.label }));
  }
  return scanClaudeDirs(home).map((s) => ({ dir: s.dir, label: s.label }));
}

/**
 * The `settings.json` path for every account the report reads from. The Stop
 * hook must be installed into *each* Claude config dir whose sessions we track —
 * a hook in one account's dir never fires for another account, so any account
 * without it records no workspace mapping (sessions show as "unknown workspace").
 */
export function accountSettingsPaths(cfg: Config, home: string = homedir()): string[] {
  return resolveAccounts(cfg, home).map((a) => join(a.dir, "settings.json"));
}

function countJsonl(projectsDir: string): number {
  let n = 0;
  for (const project of safeReaddir(projectsDir)) {
    const pdir = join(projectsDir, project);
    if (!isDir(pdir)) continue;
    for (const entry of safeReaddir(pdir)) {
      if (entry.endsWith(".jsonl")) n++;
    }
  }
  return n;
}

function safeReaddir(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}
function isDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}
