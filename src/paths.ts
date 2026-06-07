import { homedir } from "node:os";
import { join } from "node:path";

export function configPath(): string {
  return join(homedir(), ".config", "cmux-cost", "config.json");
}

export function cacheDir(): string {
  return join(homedir(), ".cache", "cmux-cost");
}

export function pricesCachePath(): string {
  return join(cacheDir(), "prices.json");
}

export function reportPath(): string {
  return join(cacheDir(), "report.html");
}

export function hookLogPath(): string {
  return join(cacheDir(), "hook.log");
}

/** Claude settings file: honour CLAUDE_CONFIG_DIR, else ~/.claude/settings.json. */
export function claudeSettingsPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR?.trim();
  return join(dir && dir.length > 0 ? dir : join(homedir(), ".claude"), "settings.json");
}

export function dockConfigPath(): string {
  return join(homedir(), ".config", "cmux", "dock.json");
}
