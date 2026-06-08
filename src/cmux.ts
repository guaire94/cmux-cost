import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const FALLBACK_BIN = "/Applications/cmux.app/Contents/Resources/bin/cmux";

/** Resolve the cmux CLI binary, or null if not found. */
export function resolveCmuxBin(): string | null {
  const env = process.env.CMUX_BIN?.trim();
  if (env && existsSync(env)) return env;
  try {
    const which = execFileSync("which", ["cmux"], { encoding: "utf8" }).trim();
    if (which) return which;
  } catch {
    // not on PATH
  }
  if (existsSync(FALLBACK_BIN)) return FALLBACK_BIN;
  return null;
}

function run(bin: string, args: string[]): void {
  try {
    execFileSync(bin, args, { stdio: "ignore", timeout: 4000 });
  } catch {
    // cmux calls are best-effort; never throw into the caller (e.g. a hook)
  }
}

export interface StatusOptions {
  workspace?: string;
  icon?: string;
  color?: string;
}

/** `cmux set-status <key> <value>` with optional workspace/icon/color. */
export function setStatus(key: string, value: string, opts: StatusOptions = {}): boolean {
  const bin = resolveCmuxBin();
  if (!bin) return false;
  const args = ["set-status", key, value];
  if (opts.workspace) args.push("--workspace", opts.workspace);
  if (opts.icon) args.push("--icon", opts.icon);
  if (opts.color) args.push("--color", opts.color);
  run(bin, args);
  return true;
}

/** `cmux browser open <url>` in the caller's workspace. */
export function browserOpen(url: string, focus = true): boolean {
  const bin = resolveCmuxBin();
  if (!bin) return false;
  run(bin, ["browser", "open", url, "--focus", String(focus)]);
  return true;
}

/** `cmux close-surface` — closes the caller's surface (the throwaway tab a button spawned). */
export function closeSurface(): boolean {
  const bin = resolveCmuxBin();
  if (!bin) return false;
  run(bin, ["close-surface"]);
  return true;
}

export function isAvailable(): boolean {
  return resolveCmuxBin() !== null;
}
