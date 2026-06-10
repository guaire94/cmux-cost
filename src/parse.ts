import { readFileSync } from "node:fs";
import { addUsage, emptyUsage, type Usage } from "./types.js";

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Parse the contents of a Claude Code / agent transcript (JSONL) into token
 * usage aggregated per model. Unparseable lines are skipped silently so a
 * partially-written file (the live session) still yields a usable total.
 */
export function parseTranscript(content: string): Map<string, Usage> {
  const byModel = new Map<string, Usage>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    const message = (obj as { message?: unknown }).message;
    if (!message || typeof message !== "object") continue;
    const usage = (message as { usage?: RawUsage }).usage;
    if (!usage || typeof usage !== "object") continue;

    const model =
      (message as { model?: string }).model?.trim() || "unknown";
    // Claude Code marks non-billed (synthetic/injected/interrupted) messages
    // with "<synthetic>" — they are not real API calls, so skip them entirely.
    if (model === "<synthetic>") continue;
    const u: Usage = {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheCreation: num(usage.cache_creation_input_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
    };
    byModel.set(model, addUsage(byModel.get(model) ?? emptyUsage(), u));
  }
  return byModel;
}

/** Read and parse a transcript file. Returns an empty map if the file can't be read. */
export function parseFile(path: string): Map<string, Usage> {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return new Map();
  }
  return parseTranscript(content);
}

/** A teammate's identity, split into its own name and its task. */
export interface Identity {
  name?: string;
  task?: string;
}

/**
 * Extract a teammate/subagent's identity from its transcript:
 *   - `name`: cmux team teammates introduce themselves as
 *     "You are `data-dev` on team `x`".
 *   - `task`: a `summary="..."` attribute, else text after "Your scope:",
 *     else the first non-boilerplate prompt line.
 * Tags are stripped and values truncated.
 */
export function extractIdentity(content: string): Identity {
  let name: string | undefined;
  let task: string | undefined;
  let fallback: string | undefined;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const text = messageText(obj);
    if (!text) continue;

    if (!name) {
      name = text.match(/You are [`'"]?([A-Za-z0-9_-]+)[`'"]? on team/)?.[1];
    }
    if (!task) {
      const summary = text.match(/summary="([^"]+)"/)?.[1];
      if (summary) task = clean(summary).slice(0, 80);
    }
    if (!task) {
      const marker = text.indexOf("Your scope:");
      if (marker >= 0) {
        const scoped = clean(text.slice(marker + "Your scope:".length));
        if (scoped.length >= 4) task = scoped.slice(0, 80);
      }
    }
    if (!fallback) {
      const cleaned = clean(text);
      if (cleaned.length >= 8 && !isBoilerplate(cleaned)) fallback = cleaned.slice(0, 80);
    }
    if (name && task) break;
  }
  return { name, task: task ?? fallback };
}

/** Combined display label, e.g. "[data-dev] Build auth feature". */
export function extractLabel(content: string): string | undefined {
  const { name, task } = extractIdentity(content);
  return displayLabel(name, undefined, task);
}

/** A teammate's identity sourced from its `agent-<id>.meta.json` sidecar. */
export interface AgentMeta {
  /** the handle the orchestrator gave this teammate (the Agent `name`), e.g. "bdev-lotA" */
  handle?: string;
  /** the agent role/type (the Agent `subagent_type`), e.g. "debugger" — the global-view key */
  type?: string;
  /** the task summary (the Agent `description`), used as a task fallback */
  task?: string;
}

/**
 * Parse an `agent-<id>.meta.json` sidecar. cmux/Claude Code write the spawned
 * agent's identity here — `name` (the handle), `agentType` (the role), and
 * `description` (the task) — which is where the agent name now lives (teammates
 * no longer self-introduce as "You are X on team Y" in the transcript body).
 */
export function parseAgentMeta(content: string): AgentMeta {
  let obj: unknown;
  try {
    obj = JSON.parse(content);
  } catch {
    return {};
  }
  if (!obj || typeof obj !== "object") return {};
  const o = obj as { name?: unknown; agentType?: unknown; description?: unknown };
  const str = (v: unknown): string | undefined => {
    const s = typeof v === "string" ? v.trim() : "";
    return s.length ? s : undefined;
  };
  const meta: AgentMeta = {};
  const handle = str(o.name);
  const type = str(o.agentType);
  const task = str(o.description);
  if (handle) meta.handle = handle;
  if (type) meta.type = type;
  if (task) meta.task = task;
  return meta;
}

/**
 * Build a teammate row label: `[handle] (type) task`. The agent is the handle
 * when known, else the type; the `(type)` parenthetical is shown only when it
 * adds information (i.e. differs from the handle). Any part may be missing.
 */
export function displayLabel(
  handle?: string,
  type?: string,
  task?: string,
): string | undefined {
  const agent = handle ?? type;
  let prefix: string | undefined;
  if (agent) {
    prefix = type && type !== agent ? `[${agent}] (${type})` : `[${agent}]`;
  }
  if (prefix && task) return `${prefix} ${task}`;
  return prefix ?? task;
}

function clean(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ") // drop XML-ish envelope tags
    .replace(/[*#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isBoilerplate(s: string): boolean {
  return (
    s.startsWith("This session is being continued") ||
    s.startsWith("Caveat:") ||
    s.startsWith("system-reminder") ||
    /^You are (working in|a |an |the )/i.test(s) // agent role/preamble lines
  );
}

function messageText(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "";
  if ((obj as { type?: string }).type !== "user") return "";
  const content = (obj as { message?: { content?: unknown } }).message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === "object" && (p as { type?: string }).type === "text"
          ? String((p as { text?: string }).text ?? "")
          : "",
      )
      .join(" ");
  }
  return "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
