import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { extractIdentity, parseFile } from "./parse.js";
import { readFileSync } from "node:fs";
import type { Account, Session, Transcript } from "./types.js";

/** List main session JSONL files across the given roots, with their project dir. */
export function listSessionFiles(
  roots: string[],
): Array<{ id: string; project: string; mainPath: string; mtime: number }> {
  const out: Array<{ id: string; project: string; mainPath: string; mtime: number }> = [];
  for (const root of roots) {
    for (const project of safeReaddir(root)) {
      const projectDir = join(root, project);
      if (!safeIsDir(projectDir)) continue;
      for (const entry of safeReaddir(projectDir)) {
        if (!entry.endsWith(".jsonl")) continue;
        const mainPath = join(projectDir, entry);
        if (!safeIsFile(mainPath)) continue;
        out.push({
          id: entry.replace(/\.jsonl$/, ""),
          project,
          mainPath,
          mtime: safeMtime(mainPath),
        });
      }
    }
  }
  return out;
}

/** Find the subagent transcript files for a given main session file. */
export function subagentFiles(mainPath: string): string[] {
  const dir = mainPath.replace(/\.jsonl$/, "");
  const subdir = join(dir, "subagents");
  if (!existsSync(subdir) || !safeIsDir(subdir)) return [];
  return safeReaddir(subdir)
    .filter((f) => f.startsWith("agent-") && f.endsWith(".jsonl"))
    .map((f) => join(subdir, f));
}

/** Load one full session (main transcript + teammates) with parsed usage. */
export function loadSession(
  meta: {
    id: string;
    project: string;
    mainPath: string;
    mtime?: number;
  },
  account: Account,
): Session {
  const main: Transcript = {
    id: meta.id,
    path: meta.mainPath,
    byModel: parseFile(meta.mainPath),
  };
  const teammates: Transcript[] = subagentFiles(meta.mainPath).map((p) => {
    let content = "";
    try {
      content = readFileSync(p, "utf8");
    } catch {
      // ignore
    }
    const ident = extractIdentity(content);
    const label =
      ident.name && ident.task
        ? `${ident.name} — ${ident.task}`
        : ident.name ?? ident.task;
    return {
      id: basename(p).replace(/^agent-/, "").replace(/\.jsonl$/, ""),
      path: p,
      name: ident.name,
      label,
      byModel: parseFile(p),
    };
  });
  return {
    id: meta.id,
    account,
    project: meta.project,
    mainPath: meta.mainPath,
    main,
    teammates,
    lastActivity: meta.mtime ?? safeMtime(meta.mainPath),
  };
}

/** Load all sessions across the given accounts, newest first, each tagged. */
export function loadAllSessions(accounts: Account[]): Session[] {
  const out: Session[] = [];
  for (const account of accounts) {
    const root = join(account.dir, "projects");
    if (!safeIsDir(root)) continue;
    for (const meta of listSessionFiles([root])) {
      out.push(loadSession(meta, account));
    }
  }
  return out.sort((a, b) => b.lastActivity - a.lastActivity);
}

function safeReaddir(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}
function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function safeIsFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
function safeMtime(p: string): number {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}
