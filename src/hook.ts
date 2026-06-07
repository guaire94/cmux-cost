import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { badgeColor, badgeText } from "./badge.js";
import { loadConfig } from "./config.js";
import { costByModel, mergeByModel } from "./cost.js";
import { subagentFiles } from "./discover.js";
import { parseFile } from "./parse.js";
import { hookLogPath, pricesCachePath } from "./paths.js";
import { loadPriceTable } from "./pricing.js";
import { setStatus } from "./cmux.js";

interface HookPayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
}

/**
 * Entry point for the Claude `Stop`/`SubagentStop` hook. Reads the hook JSON,
 * computes the running cost of the session (main transcript + subagents) and
 * pushes a cmux workspace badge. Must never throw — a hook that errors would
 * disrupt the agent.
 */
export async function runHook(stdinText: string): Promise<void> {
  try {
    const payload = parsePayload(stdinText);
    const workspace = process.env.CMUX_WORKSPACE_ID?.trim();
    if (!workspace) return log("skip: no CMUX_WORKSPACE_ID");
    if (!payload.transcript_path) return log("skip: no transcript_path");

    const usage = mergeByModel([
      parseFile(payload.transcript_path),
      ...subagentFiles(payload.transcript_path).map((p) => parseFile(p)),
    ]);

    const cfg = loadConfig();
    const prices = await loadPriceTable({
      cachePath: pricesCachePath(),
      overrides: cfg.priceOverrides,
    });
    const cost = costByModel(usage, prices);

    setStatus("cost", badgeText(cost, cfg.currency), {
      workspace,
      icon: "dollarsign",
      color: badgeColor(cost, cfg),
    });
    log(`ok: ${workspace} ${badgeText(cost, cfg.currency)}`);
  } catch (err) {
    log(`error: ${String(err)}`);
  }
}

function parsePayload(text: string): HookPayload {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as HookPayload) : {};
  } catch {
    return {};
  }
}

function log(message: string): void {
  try {
    const path = hookLogPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // logging is best-effort
  }
}
