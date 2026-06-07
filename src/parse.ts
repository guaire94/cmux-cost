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

/**
 * Extract a short human label for a teammate/subagent from its transcript.
 * Preference order:
 *   1. a `summary="..."` attribute (cmux team teammates carry one), then
 *   2. text after a "Your scope:" marker (workflow/Explore subagents), then
 *   3. the first non-boilerplate prompt line.
 * Tags are stripped and the result is truncated.
 */
export function extractLabel(content: string): string | undefined {
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

    // cmux team teammates introduce themselves: You are `data-dev` on team `x`.
    const name = text.match(/You are [`'"]?([A-Za-z0-9_-]+)[`'"]? on team/)?.[1];
    const summary = text.match(/summary="([^"]+)"/)?.[1];
    if (name) {
      return (summary ? `${name} — ${clean(summary)}` : name).slice(0, 80);
    }
    if (summary) return clean(summary).slice(0, 80);

    const marker = text.indexOf("Your scope:");
    if (marker >= 0) {
      const scoped = clean(text.slice(marker + "Your scope:".length));
      if (scoped.length >= 4) return scoped.slice(0, 80);
    }

    const cleaned = clean(text);
    if (!fallback && cleaned.length >= 8 && !isBoilerplate(cleaned)) {
      fallback = cleaned.slice(0, 80);
    }
  }
  return fallback;
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
    s.startsWith("system-reminder")
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
