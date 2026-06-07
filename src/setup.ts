import { createInterface } from "node:readline";
import type { ScannedDir } from "./accounts.js";
import { scanClaudeDirs } from "./accounts.js";
import type { AccountConfig } from "./config.js";

/** Pure: turn scan results + user selection/labels into AccountConfig rows. */
export function accountsFromPicks(
  scanned: ScannedDir[],
  selected: Set<number>,
  labels: Record<number, string>,
): AccountConfig[] {
  return scanned.map((s, i) => ({
    dir: s.dir,
    label: labels[i]?.trim() || s.label,
    enabled: selected.has(i),
  }));
}

/**
 * Interactive first-run picker (TTY only). Lists scanned Claude dirs, asks
 * which to include and an optional label for each. Returns the AccountConfig
 * rows, or null if there is nothing to pick / not a TTY.
 */
export async function runAccountSetup(home?: string): Promise<AccountConfig[] | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
  const scanned = scanClaudeDirs(home);
  if (scanned.length === 0) return null;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((res) => rl.question(q, (a) => res(a)));

  process.stdout.write("\ncmux-cost — Claude accounts found:\n\n");
  scanned.forEach((s, i) => {
    process.stdout.write(
      `  [${i + 1}] ${s.label.padEnd(12)} ${s.transcripts} sessions   ${s.dir}\n`,
    );
  });
  process.stdout.write("\n");

  const sel = await ask("Include which? (comma-separated numbers, or 'all') [all]: ");
  const selected = parseSelection(sel, scanned.length);

  const labels: Record<number, string> = {};
  for (const i of selected) {
    const s = scanned[i];
    if (!s) continue;
    const l = await ask(`Label for "${s.label}" (${s.dir}) [${s.label}]: `);
    if (l.trim()) labels[i] = l.trim();
  }
  rl.close();
  return accountsFromPicks(scanned, selected, labels);
}

function parseSelection(input: string, count: number): Set<number> {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed || trimmed === "all") {
    return new Set(Array.from({ length: count }, (_, i) => i));
  }
  const set = new Set<number>();
  for (const part of trimmed.split(",")) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isInteger(n) && n >= 1 && n <= count) set.add(n - 1);
  }
  return set;
}
