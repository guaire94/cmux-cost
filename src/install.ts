import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const HOOK_EVENTS = ["Stop", "SubagentStop"] as const;

/** Our surface-tab-bar action id and the built-in buttons we keep alongside it. */
const ACTION_ID = "cmux-cost.report";
const COST_ICON = { type: "emoji", value: "💰" } as const;
const DEFAULT_TAB_BAR_BUTTONS = [
  "cmux.newTerminal",
  "cmux.newBrowser",
  "cmux.splitRight",
  "cmux.splitDown",
];

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

type Json = Record<string, unknown>;

function isOurButton(b: unknown): boolean {
  if (b === ACTION_ID) return true;
  return typeof b === "object" && b !== null && (b as Json).action === ACTION_ID;
}

/**
 * Add (or refresh) the "💰" surface-tab-bar button + its action, idempotently.
 * Preserves any buttons the user already has; when none are configured we seed
 * the built-in defaults so adding ours doesn't drop cmux's terminal/split icons.
 */
export function withCostButton(cmux: Json, command: string): Json {
  const next: Json = { ...cmux };

  const actions: Json = { ...((next.actions as Json) ?? {}) };
  actions[ACTION_ID] = {
    type: "command",
    title: "Cost report",
    subtitle: "Open the cmux-cost dashboard and refresh badges",
    command,
    target: "newTabInCurrentPane",
    icon: COST_ICON,
  };
  next.actions = actions;

  const ui: Json = { ...((next.ui as Json) ?? {}) };
  const stb: Json = { ...((ui.surfaceTabBar as Json) ?? {}) };
  const existing = Array.isArray(stb.buttons) ? stb.buttons : [...DEFAULT_TAB_BAR_BUTTONS];
  const buttons = existing.filter((b) => !isOurButton(b));
  buttons.push({ action: ACTION_ID, title: "Cost", icon: COST_ICON });
  stb.buttons = buttons;
  ui.surfaceTabBar = stb;
  next.ui = ui;

  return next;
}

/** Remove our action + button; if only the built-in defaults remain, drop the override. */
export function withoutCostButton(cmux: Json): Json {
  const next: Json = { ...cmux };

  if (next.actions && typeof next.actions === "object") {
    const actions: Json = { ...(next.actions as Json) };
    delete actions[ACTION_ID];
    if (Object.keys(actions).length > 0) next.actions = actions;
    else delete next.actions;
  }

  const ui = next.ui as Json | undefined;
  const stb = ui?.surfaceTabBar as Json | undefined;
  if (stb && Array.isArray(stb.buttons)) {
    const buttons = stb.buttons.filter((b) => !isOurButton(b));
    const onlyDefaults =
      buttons.length === DEFAULT_TAB_BAR_BUTTONS.length &&
      buttons.every((b, i) => b === DEFAULT_TAB_BAR_BUTTONS[i]);
    const nextStb: Json = { ...stb };
    if (onlyDefaults) delete nextStb.buttons;
    else nextStb.buttons = buttons;
    const nextUi: Json = { ...(ui as Json) };
    if (Object.keys(nextStb).length > 0) nextUi.surfaceTabBar = nextStb;
    else delete nextUi.surfaceTabBar;
    if (Object.keys(nextUi).length > 0) next.ui = nextUi;
    else delete next.ui;
  }

  return next;
}

/**
 * Make JSONC parseable by `JSON.parse`: strip `//` line and block comments and
 * any trailing commas, ignoring markers inside string literals (cmux.json's
 * `$schema` URL contains `//`, and its template leaves a trailing comma once the
 * commented-out keys are removed).
 */
export function stripJsonComments(text: string): string {
  return removeTrailingCommas(removeComments(text));
}

function removeComments(text: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && n === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 1; // skip the closing '*'; the loop's i++ skips '/'
    } else {
      out += c;
    }
  }
  return out;
}

function removeTrailingCommas(text: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] as string)) j++;
      const nextChar = text[j];
      if (nextChar === "}" || nextChar === "]") continue; // drop the trailing comma
      out += c;
    } else {
      out += c;
    }
  }
  return out;
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

/** Read a JSONC file (cmux.json) into an object; {} when missing or unparseable. */
function readJsonc(path: string): Json {
  try {
    const v = JSON.parse(stripJsonComments(readFileSync(path, "utf8")));
    return v && typeof v === "object" ? (v as Json) : {};
  } catch {
    return {};
  }
}

/** Add the cost button to cmux.json. Throws (without writing) if the file is unparseable. */
export function installCostButton(cmuxPath: string, command: string): void {
  if (existsSync(cmuxPath)) {
    // Guard against clobbering a hand-tuned config we can't safely parse.
    JSON.parse(stripJsonComments(readFileSync(cmuxPath, "utf8")));
  }
  writeJsonWithBackup(cmuxPath, withCostButton(readJsonc(cmuxPath), command));
}

export function uninstallCostButton(cmuxPath: string): void {
  if (!existsSync(cmuxPath)) return;
  writeJsonWithBackup(cmuxPath, withoutCostButton(readJsonc(cmuxPath)));
}
