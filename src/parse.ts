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

/**
 * Extract a short human label for a teammate/subagent from its transcript:
 * the text following a "Your scope:" marker if present, else the first
 * meaningful prompt line, truncated.
 */
export function extractLabel(content: string): string | undefined {
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
    const marker = text.indexOf("Your scope:");
    const raw =
      marker >= 0 ? text.slice(marker + "Your scope:".length) : text;
    const cleaned = raw.replace(/\s+/g, " ").replace(/[*#]/g, "").trim();
    if (cleaned.length >= 8) return cleaned.slice(0, 80);
  }
  return undefined;
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
