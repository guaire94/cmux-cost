# cmux-cost Hierarchical Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Account → cmux Workspace → Session → Teammate breakdown to cmux-cost, with scanned/configurable Claude accounts, live workspace capture, and an interactive, filterable HTML tree.

**Architecture:** Sessions are tagged with their Claude **account** (which `~/.claude*` config dir they live under, resolved from a scanned + user-confirmed list) during discovery, and joined to a **workspace** (captured live by the Stop hook into a sidecar JSON). A new `buildTree` rollup groups views into a 4-level tree that the HTML report renders as a collapsible, account/workspace-filterable view.

**Tech Stack:** TypeScript, Node ESM, tsup, vitest. No new runtime deps (interactive setup uses Node `readline`).

**Conventions to follow (from the existing codebase):**
- Pure logic is unit-tested with vitest; thin filesystem / `cmux` CLI wrappers are NOT unit-tested.
- All cost rollups go through `addCost` so the `partial` / `+` lower-bound semantics bubble up.
- ESM imports use the `.js` extension even for `.ts` files.
- Run a single test file with: `npx vitest run src/<file>.test.ts`
- Commit author is `guaire94`; NO `Co-Authored-By` trailer. Use:
  `git -c user.name='guaire94' -c user.email='ai.powered.application@gmail.com' commit -m "..."`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/types.ts` (modify) | Add `Account`, `Workspace`; add `account` to `Session`. |
| `src/config.ts` (modify) | Add `AccountConfig` + `accounts` field to `Config` / `mergeConfig`. |
| `src/accounts.ts` (new) | Scan `~/.claude*` for dirs with `projects/`; derive labels; resolve active accounts. |
| `src/accounts.test.ts` (new) | Tests for label derivation, scan, resolution. |
| `src/paths.ts` (modify) | Add `workspacesSidecarPath()`. |
| `src/workspaces.ts` (new) | Parse `list-workspaces`; sidecar load/upsert/lookup; live record. |
| `src/workspaces.test.ts` (new) | Tests for parsing + sidecar pure functions. |
| `src/discover.ts` (modify) | `loadAllSessions(accounts)`; tag each `Session` with its account. |
| `src/discover.test.ts` (new) | Temp-dir test: per-account discovery + tagging. |
| `src/aggregate.ts` (modify) | `SessionView` gains `account`/`workspace`; add `buildTree`, `flatSessions`. |
| `src/aggregate.test.ts` (modify) | Tests for `buildTree` + `flatSessions`. |
| `src/app.ts` (modify) | `loadViews` resolves accounts, joins workspaces; `buildReportData` adds `tree`/`flat`. |
| `src/hook.ts` (modify) | Record `session → workspace` into the sidecar (best-effort). |
| `src/render-html.ts` (modify) | Render the filterable tree + filter bar + client JS. |
| `src/render-html.test.ts` (modify) | Tests for embedded data + tree HTML. |
| `src/setup.ts` (new) | Interactive first-run account picker (TTY only) + pure `accountsFromPicks`. |
| `src/setup.test.ts` (new) | Test for `accountsFromPicks`. |
| `src/cli.ts` (modify) | `accounts` command + first-run setup gate. |
| `README.md` (modify) | Document accounts/workspaces. |

---

## Task 1: Account & Workspace types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the interfaces and the `Session.account` field**

In `src/types.ts`, add these two interfaces (place them just above the `Transcript` interface):

```ts
/** A Claude account = one config dir (e.g. ~/.claude-talabat) and its label. */
export interface Account {
  dir: string; // absolute path to the config dir (NOT the projects subdir)
  label: string; // human label shown in the report, e.g. "Talabat"
}

/** A cmux workspace a session ran in. */
export interface Workspace {
  id: string; // CMUX_WORKSPACE_ID (UUID)
  title: string; // e.g. "[Talabat] Flutter App"
}
```

Then add an `account` field to the existing `Session` interface (after `id`):

```ts
export interface Session {
  id: string;
  account: Account; // which Claude account this session belongs to
  project: string;
  mainPath: string;
  main: Transcript;
  teammates: Transcript[];
  lastActivity: number;
}
```

- [ ] **Step 2: Typecheck (expected to fail — callers not updated yet)**

Run: `npx tsc --noEmit`
Expected: FAIL — `discover.ts` constructs a `Session` without `account`. This is expected; Task 5 fixes it. Do not fix other files yet.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git -c user.name='guaire94' -c user.email='ai.powered.application@gmail.com' commit -m "Add Account and Workspace types"
```

---

## Task 2: Config gains `accounts`

**Files:**
- Modify: `src/config.ts`
- Test: `src/config.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/config.test.ts` inside the `describe("mergeConfig", ...)` block:

```ts
  it("parses the accounts array and drops malformed entries", () => {
    const c = mergeConfig({
      accounts: [
        { dir: "/Users/x/.claude-talabat", label: "Talabat", enabled: true },
        { dir: "/Users/x/.claude", label: "Default", enabled: false },
        { dir: 123, label: "bad" }, // malformed -> dropped
        "junk", // malformed -> dropped
      ],
    });
    expect(c.accounts).toEqual([
      { dir: "/Users/x/.claude-talabat", label: "Talabat", enabled: true },
      { dir: "/Users/x/.claude", label: "Default", enabled: false },
    ]);
  });

  it("defaults accounts to an empty array", () => {
    expect(mergeConfig({}).accounts).toEqual([]);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL — `c.accounts` is `undefined`.

- [ ] **Step 3: Implement**

In `src/config.ts`, add the `AccountConfig` interface above `export interface Config`:

```ts
export interface AccountConfig {
  dir: string;
  label: string;
  enabled: boolean;
}
```

Add `accounts` to the `Config` interface (after `projectRoots`):

```ts
  /** Claude accounts to include; empty = scan + first-run setup */
  accounts: AccountConfig[];
```

Add it to `DEFAULT_CONFIG`:

```ts
  accounts: [],
```

In `mergeConfig`, add to the returned object:

```ts
    accounts: Array.isArray(p.accounts)
      ? p.accounts.filter(isAccountConfig)
      : [],
```

And add this guard at the bottom of the file (above `numOr`):

```ts
function isAccountConfig(v: unknown): v is AccountConfig {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as AccountConfig).dir === "string" &&
    typeof (v as AccountConfig).label === "string" &&
    typeof (v as AccountConfig).enabled === "boolean"
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git -c user.name='guaire94' -c user.email='ai.powered.application@gmail.com' commit -m "Add accounts to config"
```

---

## Task 3: Account scanning & resolution

**Files:**
- Create: `src/accounts.ts`
- Test: `src/accounts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/accounts.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveLabel, resolveAccounts, scanClaudeDirs } from "./accounts.js";
import { DEFAULT_CONFIG } from "./config.js";

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "cmux-cost-home-"));
}
function addAccount(home: string, name: string, transcripts: number): void {
  const projects = join(home, name, "projects", "proj-a");
  mkdirSync(projects, { recursive: true });
  for (let i = 0; i < transcripts; i++) {
    writeFileSync(join(projects, `s${i}.jsonl`), "");
  }
}

describe("deriveLabel", () => {
  it("titlecases the suffix after .claude-", () => {
    expect(deriveLabel("/h/.claude-talabat")).toBe("Talabat");
    expect(deriveLabel("/h/.claude-personal")).toBe("Personal");
  });
  it("labels the bare .claude (and xdg claude) as Default", () => {
    expect(deriveLabel("/h/.claude")).toBe("Default");
    expect(deriveLabel("/h/.config/claude")).toBe("Default");
  });
});

describe("scanClaudeDirs", () => {
  it("finds only dirs with a projects/ subdir, sorted by transcript count desc", () => {
    const home = makeHome();
    addAccount(home, ".claude-personal", 3);
    addAccount(home, ".claude-talabat", 5);
    mkdirSync(join(home, ".claude-empty")); // no projects/ -> ignored
    const got = scanClaudeDirs(home);
    expect(got.map((s) => [s.label, s.transcripts])).toEqual([
      ["Talabat", 5],
      ["Personal", 3],
    ]);
  });
});

describe("resolveAccounts", () => {
  it("returns enabled configured accounts when present", () => {
    const home = makeHome();
    addAccount(home, ".claude-personal", 1);
    const accounts = resolveAccounts(
      {
        ...DEFAULT_CONFIG,
        accounts: [
          { dir: "/h/.claude-talabat", label: "Talabat", enabled: true },
          { dir: "/h/.claude", label: "Default", enabled: false },
        ],
      },
      home,
    );
    expect(accounts).toEqual([{ dir: "/h/.claude-talabat", label: "Talabat" }]);
  });

  it("falls back to scanning every dir when no accounts configured", () => {
    const home = makeHome();
    addAccount(home, ".claude-talabat", 2);
    const accounts = resolveAccounts({ ...DEFAULT_CONFIG }, home);
    expect(accounts).toEqual([{ dir: join(home, ".claude-talabat"), label: "Talabat" }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/accounts.test.ts`
Expected: FAIL — `Cannot find module './accounts.js'`.

- [ ] **Step 3: Implement**

Create `src/accounts.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/accounts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/accounts.ts src/accounts.test.ts
git -c user.name='guaire94' -c user.email='ai.powered.application@gmail.com' commit -m "Add account scanning and resolution"
```

---

## Task 4: Workspace sidecar & parsing

**Files:**
- Modify: `src/paths.ts`
- Create: `src/workspaces.ts`
- Test: `src/workspaces.test.ts`

- [ ] **Step 1: Add the sidecar path**

In `src/paths.ts`, add after `reportPath()`:

```ts
export function workspacesSidecarPath(): string {
  return join(cacheDir(), "workspaces.json");
}
```

- [ ] **Step 2: Write the failing test**

Create `src/workspaces.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseWorkspaceList, upsertWorkspace, workspaceFor } from "./workspaces.js";

const SAMPLE = [
  "* workspace:9 FDEAC62F-488C-448A-A133-6CAAC0340241  [Klozy] Global  [selected]",
  "  workspace:1 E10D1FAE-1C06-42A0-9B97-7ECBA21FFC52  [Talabat] Flutter App",
  "garbage line",
].join("\n");

describe("parseWorkspaceList", () => {
  it("maps UUID -> title, dropping the * and [selected] markers", () => {
    const map = parseWorkspaceList(SAMPLE);
    expect(map.get("FDEAC62F-488C-448A-A133-6CAAC0340241")).toBe("[Klozy] Global");
    expect(map.get("E10D1FAE-1C06-42A0-9B97-7ECBA21FFC52")).toBe("[Talabat] Flutter App");
    expect(map.size).toBe(2);
  });
});

describe("sidecar map", () => {
  it("upserts a record and looks it up as a Workspace", () => {
    let map = {};
    map = upsertWorkspace(map, "sess-1", {
      workspaceId: "WID",
      title: "[Talabat] Flutter App",
      lastSeen: 123,
    });
    expect(workspaceFor(map, "sess-1")).toEqual({ id: "WID", title: "[Talabat] Flutter App" });
    expect(workspaceFor(map, "missing")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/workspaces.test.ts`
Expected: FAIL — `Cannot find module './workspaces.js'`.

- [ ] **Step 4: Implement**

Create `src/workspaces.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveCmuxBin } from "./cmux.js";
import { workspacesSidecarPath } from "./paths.js";
import type { Workspace } from "./types.js";

export interface WorkspaceRecord {
  workspaceId: string;
  title: string;
  lastSeen: number;
}
export type WorkspaceMap = Record<string, WorkspaceRecord>;

/** Parse `cmux --id-format both list-workspaces` stdout into UUID -> title. */
export function parseWorkspaceList(stdout: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/^\s*\*?\s*/, "").trim();
    const m = line.match(/^workspace:\S+\s+([0-9A-Fa-f-]{36})\s+(.*)$/);
    if (!m) continue;
    const title = m[2].replace(/\s*\[selected\]\s*$/, "").trim();
    if (title) map.set(m[1], title);
  }
  return map;
}

export function upsertWorkspace(
  map: WorkspaceMap,
  sessionId: string,
  rec: WorkspaceRecord,
): WorkspaceMap {
  return { ...map, [sessionId]: rec };
}

export function workspaceFor(map: WorkspaceMap, sessionId: string): Workspace | undefined {
  const r = map[sessionId];
  return r ? { id: r.workspaceId, title: r.title } : undefined;
}

// ---- filesystem / cmux side-effects (not unit-tested) --------------------

export function loadWorkspaceMap(path: string = workspacesSidecarPath()): WorkspaceMap {
  try {
    const v = JSON.parse(readFileSync(path, "utf8"));
    return v && typeof v === "object" ? (v as WorkspaceMap) : {};
  } catch {
    return {};
  }
}

/** Resolve a workspace UUID to its title via cmux; "" if unavailable. */
export function resolveWorkspaceTitle(workspaceId: string): string {
  const bin = resolveCmuxBin();
  if (!bin) return "";
  try {
    const out = execFileSync(bin, ["--id-format", "both", "list-workspaces"], {
      encoding: "utf8",
      timeout: 4000,
    });
    return parseWorkspaceList(out).get(workspaceId) ?? "";
  } catch {
    return "";
  }
}

/** Best-effort: record session -> workspace into the sidecar. Never throws. */
export function recordWorkspace(sessionId: string, workspaceId: string, nowMs: number): void {
  try {
    const path = workspacesSidecarPath();
    const map = loadWorkspaceMap(path);
    const title = resolveWorkspaceTitle(workspaceId);
    const next = upsertWorkspace(map, sessionId, { workspaceId, title, lastSeen: nowMs });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  } catch {
    // best-effort
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/workspaces.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/paths.ts src/workspaces.ts src/workspaces.test.ts
git -c user.name='guaire94' -c user.email='ai.powered.application@gmail.com' commit -m "Add workspace sidecar and list parsing"
```

---

## Task 5: Discovery tags sessions with their account

**Files:**
- Modify: `src/discover.ts`
- Test: `src/discover.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/discover.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAllSessions } from "./discover.js";
import type { Account } from "./types.js";

function seedAccount(home: string, name: string, sessionId: string): Account {
  const dir = join(home, name);
  const projects = join(dir, "projects", "proj-a");
  mkdirSync(projects, { recursive: true });
  writeFileSync(join(projects, `${sessionId}.jsonl`), "");
  return { dir, label: name.replace(/^\.claude-?/, "") || "Default" };
}

describe("loadAllSessions", () => {
  it("loads sessions from each account and tags them", () => {
    const home = mkdtempSync(join(tmpdir(), "cmux-cost-disc-"));
    const a = seedAccount(home, ".claude-personal", "aaaa1111");
    const b = seedAccount(home, ".claude-talabat", "bbbb2222");
    const sessions = loadAllSessions([a, b]);
    const byId = Object.fromEntries(sessions.map((s) => [s.id, s.account.label]));
    expect(byId["aaaa1111"]).toBe("personal");
    expect(byId["bbbb2222"]).toBe("talabat");
    expect(sessions.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/discover.test.ts`
Expected: FAIL — `loadAllSessions` currently takes `roots: string[]`, not `Account[]`.

- [ ] **Step 3: Implement**

In `src/discover.ts`:

1. Add to the imports at the top:

```ts
import type { Account, Session, Transcript } from "./types.js";
```
(replace the existing `import type { Session, Transcript } from "./types.js";`)

2. Delete the `defaultProjectRoots` function entirely (accounts replace it).

3. Change `loadSession` to accept and stamp the account:

```ts
export function loadSession(
  meta: { id: string; project: string; mainPath: string; mtime?: number },
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
```

4. Rewrite `loadAllSessions` to take accounts:

```ts
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
```

5. Remove the now-unused `homedir` import if `defaultProjectRoots` was its only user. (Check: after deleting `defaultProjectRoots`, `homedir` is unused — remove it from the `node:os` import line, deleting the line if empty.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/discover.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/discover.ts src/discover.test.ts
git -c user.name='guaire94' -c user.email='ai.powered.application@gmail.com' commit -m "Tag discovered sessions with their account"
```

---

## Task 6: Aggregation — view fields, tree, flat list

**Files:**
- Modify: `src/aggregate.ts`
- Test: `src/aggregate.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/aggregate.test.ts` (add the imports it needs to the existing import block — `buildTree`, `flatSessions`, and the `Account`/`Workspace`/`SessionView` types):

```ts
import { buildTree, flatSessions, type SessionView } from "./aggregate.js";
import type { Account, CostResult, Workspace } from "./types.js";

function cost(n: number): CostResult {
  return {
    usage: { input: n, output: 0, cacheCreation: 0, cacheRead: 0 },
    tokens: n,
    cost: n,
    partial: false,
    unknownModels: [],
  };
}
function view(
  id: string,
  account: Account,
  workspace: Workspace | undefined,
  c: number,
  lastActivity = 0,
): SessionView {
  return {
    id,
    project: "proj",
    account,
    workspace,
    lastActivity,
    cost: cost(c),
    mainCost: cost(c),
    teammates: [],
  };
}

describe("buildTree", () => {
  const perso: Account = { dir: "/h/.claude-personal", label: "Personal" };
  const tala: Account = { dir: "/h/.claude-talabat", label: "Talabat" };
  const ws: Workspace = { id: "W1", title: "[Talabat] Flutter App" };

  it("groups account -> workspace -> session and rolls up cost, sorted desc", () => {
    const tree = buildTree([
      view("s1", tala, ws, 10),
      view("s2", tala, ws, 5),
      view("s3", perso, undefined, 3),
    ]);
    expect(tree.map((n) => [n.label, n.cost.cost])).toEqual([
      ["Talabat", 15],
      ["Personal", 3],
    ]);
    const talaWs = tree[0].children;
    expect(talaWs.map((n) => [n.label, n.level, n.cost.cost])).toEqual([
      ["[Talabat] Flutter App", "workspace", 15],
    ]);
    expect(talaWs[0].children.map((s) => s.cost.cost)).toEqual([10, 5]);
  });

  it("buckets sessions without a workspace under 'unknown workspace'", () => {
    const tree = buildTree([view("s3", perso, undefined, 3)]);
    expect(tree[0].children[0].label).toBe("unknown workspace");
  });
});

describe("flatSessions", () => {
  it("flattens views to filter rows with account/workspace labels", () => {
    const tala: Account = { dir: "/h/.claude-talabat", label: "Talabat" };
    const flat = flatSessions([view("s1", tala, { id: "W1", title: "WS" }, 10, 42)]);
    expect(flat).toEqual([
      {
        id: "s1",
        label: "proj",
        account: "Talabat",
        workspace: "WS",
        cost: 10,
        partial: false,
        tokens: 10,
        lastActivity: 42,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/aggregate.test.ts`
Expected: FAIL — `buildTree`/`flatSessions` not exported; `SessionView` lacks `account`/`workspace`.

- [ ] **Step 3: Implement**

In `src/aggregate.ts`:

1. Update the type import:

```ts
import type { Account, CostResult, Session, Workspace } from "./types.js";
```

2. Add `account`/`workspace` to `SessionView`:

```ts
export interface SessionView {
  id: string;
  project: string;
  account: Account;
  workspace?: Workspace;
  lastActivity: number;
  cost: CostResult; // main + teammates
  mainCost: CostResult; // the lead/orchestrator transcript alone
  teammates: TeammateView[];
}
```

3. In `buildSessionView`, add `account: session.account` to the returned object (after `id: session.id,`). Leave `workspace` unset (assigned in `app.ts`).

4. Add the tree types + functions at the end of the file:

```ts
export interface TreeNode {
  key: string;
  label: string;
  level: "account" | "workspace" | "session" | "teammate";
  cost: CostResult;
  lastActivity: number;
  children: TreeNode[];
}

export interface FlatSession {
  id: string;
  label: string;
  account: string;
  workspace: string;
  cost: number;
  partial: boolean;
  tokens: number;
  lastActivity: number;
}

const UNKNOWN_WS = "unknown workspace";

/** Build the Account -> Workspace -> Session -> Teammate rollup tree. */
export function buildTree(views: SessionView[]): TreeNode[] {
  const byAccount = groupBy(views, (v) => v.account.label);
  const nodes: TreeNode[] = [];
  for (const [label, accViews] of byAccount) {
    const wsNodes = workspaceNodes(label, accViews);
    nodes.push({
      key: `acc:${label}`,
      label,
      level: "account",
      cost: sumCost(wsNodes.map((n) => n.cost)),
      lastActivity: maxActivity(accViews),
      children: wsNodes,
    });
  }
  return nodes.sort(byCostDesc);
}

function workspaceNodes(accountLabel: string, views: SessionView[]): TreeNode[] {
  const byWs = groupBy(views, (v) => v.workspace?.title ?? UNKNOWN_WS);
  const nodes: TreeNode[] = [];
  for (const [title, wsViews] of byWs) {
    const sessionNodes = wsViews.map((v) => sessionNode(v)).sort(byCostDesc);
    nodes.push({
      key: `ws:${accountLabel}:${title}`,
      label: title,
      level: "workspace",
      cost: sumCost(sessionNodes.map((n) => n.cost)),
      lastActivity: maxActivity(wsViews),
      children: sessionNodes,
    });
  }
  return nodes.sort(byCostDesc);
}

function sessionNode(v: SessionView): TreeNode {
  const mates: TreeNode[] = [
    {
      key: `tm:${v.id}:lead`,
      label: "lead",
      level: "teammate",
      cost: v.mainCost,
      lastActivity: v.lastActivity,
      children: [],
    },
    ...v.teammates.map((t) => ({
      key: `tm:${v.id}:${t.id}`,
      label: t.name ?? t.label,
      level: "teammate" as const,
      cost: t.cost,
      lastActivity: v.lastActivity,
      children: [],
    })),
  ].sort(byCostDesc);
  return {
    key: `se:${v.id}`,
    label: `${v.id.slice(0, 8)} · ${v.project}`,
    level: "session",
    cost: v.cost,
    lastActivity: v.lastActivity,
    children: mates,
  };
}

/** Flatten views into filter rows for the report's client-side recompute. */
export function flatSessions(views: SessionView[]): FlatSession[] {
  return views.map((v) => ({
    id: v.id,
    label: v.project,
    account: v.account.label,
    workspace: v.workspace?.title ?? UNKNOWN_WS,
    cost: v.cost.cost,
    partial: v.cost.partial,
    tokens: v.cost.tokens,
    lastActivity: v.lastActivity,
  }));
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}
function sumCost(costs: CostResult[]): CostResult {
  return costs.reduce((acc, c) => addCost(acc, c), zeroCost());
}
function maxActivity(views: SessionView[]): number {
  return views.reduce((m, v) => Math.max(m, v.lastActivity), 0);
}
function byCostDesc(a: TreeNode, b: TreeNode): number {
  return b.cost.cost - a.cost.cost;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/aggregate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/aggregate.ts src/aggregate.test.ts
git -c user.name='guaire94' -c user.email='ai.powered.application@gmail.com' commit -m "Add account/workspace fields, buildTree and flatSessions"
```

---

## Task 7: Wire accounts + workspaces through `app.ts`

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Update `loadViews` and `buildReportData`**

Replace the contents of `src/app.ts` with:

```ts
import {
  buildSessionView,
  buildTree,
  dailySeries,
  flatSessions,
  windowTotals,
  type FlatSession,
  type SessionView,
  type TreeNode,
} from "./aggregate.js";
import { resolveAccounts } from "./accounts.js";
import { loadConfig, type Config } from "./config.js";
import { loadAllSessions } from "./discover.js";
import { pricesCachePath } from "./paths.js";
import { loadPriceTable, type PriceTable } from "./pricing.js";
import { loadWorkspaceMap, workspaceFor } from "./workspaces.js";
import type { ReportData } from "./render-html.js";

export interface LoadedViews {
  cfg: Config;
  prices: PriceTable;
  views: SessionView[];
}

/** Shared loader: config -> accounts -> sessions -> prices -> views (+ workspace). */
export async function loadViews(): Promise<LoadedViews> {
  const cfg = loadConfig();
  const accounts = resolveAccounts(cfg);
  const sessions = loadAllSessions(accounts);
  const prices = await loadPriceTable({
    cachePath: pricesCachePath(),
    overrides: cfg.priceOverrides,
  });
  const wsMap = loadWorkspaceMap();
  const views = sessions.map((s) => {
    const view = buildSessionView(s, prices);
    view.workspace = workspaceFor(wsMap, s.id);
    return view;
  });
  return { cfg, prices, views };
}

/** Assemble the HTML report data model from loaded views. */
export function buildReportData(loaded: LoadedViews, nowMs: number): ReportData {
  const warnings: string[] = [];
  if (loaded.prices.size === 0) {
    warnings.push("price table unavailable — showing tokens only");
  }
  const unknown = new Set<string>();
  for (const v of loaded.views) for (const m of v.cost.unknownModels) unknown.add(m);
  if (unknown.size > 0) warnings.push(`no price for: ${[...unknown].join(", ")}`);

  const tree: TreeNode[] = buildTree(loaded.views);
  const flat: FlatSession[] = flatSessions(loaded.views);

  return {
    generatedAt: nowMs,
    currency: loaded.cfg.currency,
    totals: windowTotals(loaded.views, nowMs),
    sessions: loaded.views,
    tree,
    flat,
    series: dailySeries(loaded.views, nowMs),
    warnings,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL only in `render-html.ts` (ReportData lacks `tree`/`flat` until Task 9) and `cli.ts`. That's expected. If any OTHER file errors, fix it before moving on.

- [ ] **Step 3: Commit**

```bash
git add src/app.ts
git -c user.name='guaire94' -c user.email='ai.powered.application@gmail.com' commit -m "Resolve accounts and join workspaces in loadViews"
```

---

## Task 8: Hook records the workspace

**Files:**
- Modify: `src/hook.ts`

- [ ] **Step 1: Record session → workspace after pushing the badge**

In `src/hook.ts`:

1. Add to the imports:

```ts
import { basename } from "node:path";
import { recordWorkspace } from "./workspaces.js";
```

2. In `runHook`, after the `setStatus(...)` call and its `log(...)`, add:

```ts
    const sessionId = payload.transcript_path
      ? basename(payload.transcript_path).replace(/\.jsonl$/, "")
      : payload.session_id;
    if (sessionId) recordWorkspace(sessionId, workspace, Date.now());
```

(`recordWorkspace` is wrapped in its own try/catch and never throws, preserving the "hook must never throw" guarantee.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: same as Task 7 (only `render-html.ts` / `cli.ts` errors remain).

- [ ] **Step 3: Commit**

```bash
git add src/hook.ts
git -c user.name='guaire94' -c user.email='ai.powered.application@gmail.com' commit -m "Record session-to-workspace mapping from the hook"
```

---

## Task 9: HTML report — filterable tree

**Files:**
- Modify: `src/render-html.ts`
- Test: `src/render-html.test.ts`

- [ ] **Step 1: Write the failing test**

Look at the existing `src/render-html.test.ts` to match its setup (how it builds a `ReportData`). Add a test that exercises the new fields. Append:

```ts
import { describe, expect, it } from "vitest";
import { renderHtml, type ReportData } from "./render-html.js";
import { zeroCost } from "./cost.js";

function baseData(): ReportData {
  return {
    generatedAt: 0,
    currency: "USD",
    totals: { today: zeroCost(), week: zeroCost(), month: zeroCost(), all: zeroCost() },
    sessions: [],
    tree: [
      {
        key: "acc:Talabat",
        label: "Talabat",
        level: "account",
        cost: { ...zeroCost(), cost: 10, tokens: 10 },
        lastActivity: 0,
        children: [
          {
            key: "ws:Talabat:[Talabat] Flutter App",
            label: "[Talabat] Flutter App",
            level: "workspace",
            cost: { ...zeroCost(), cost: 10, tokens: 10 },
            lastActivity: 0,
            children: [],
          },
        ],
      },
    ],
    flat: [
      {
        id: "s1",
        label: "proj",
        account: "Talabat",
        workspace: "[Talabat] Flutter App",
        cost: 10,
        partial: false,
        tokens: 10,
        lastActivity: 0,
      },
    ],
    series: [],
    warnings: [],
  };
}

describe("renderHtml tree", () => {
  it("renders account/workspace labels and embeds the flat filter data", () => {
    const html = renderHtml(baseData());
    expect(html).toContain("Talabat");
    expect(html).toContain("[Talabat] Flutter App");
    expect(html).toContain('data-account="Talabat"');
    expect(html).toContain("window.__CMUX_COST__");
  });
});
```

(If `render-html.test.ts` already defines a `baseData`/imports, merge — do not duplicate identical symbols; rename this one `baseTreeData` if there's a clash.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/render-html.test.ts`
Expected: FAIL — `ReportData` has no `tree`/`flat`; markers absent.

- [ ] **Step 3: Implement**

In `src/render-html.ts`:

1. Update imports and `ReportData`:

```ts
import {
  teammateLeaderboard,
  type DayPoint,
  type FlatSession,
  type SessionView,
  type TeammateTotal,
  type TreeNode,
  type WindowTotals,
} from "./aggregate.js";
import { fmtCost, fmtTimeAgo, fmtTokens, fmtUsd } from "./format.js";
import type { CostResult } from "./types.js";

export interface ReportData {
  generatedAt: number;
  currency: string;
  totals: WindowTotals;
  sessions: SessionView[];
  tree: TreeNode[];
  flat: FlatSession[];
  series: DayPoint[];
  warnings: string[];
}
```

2. In `renderHtml`, replace the `<section class="sessions">…</section>` block (the table) with a filter bar + tree section. Replace these lines:

```ts
<section class="sessions">
  <h2>Sessions <span class="hint">— click a row to see its teammates</span></h2>
  <table>
    <thead><tr><th></th><th>Session</th><th>Project</th><th class="num">Cost</th><th class="num">Tokens</th><th class="num">When</th></tr></thead>
    <tbody>${rowsHtml || `<tr><td colspan="6" class="empty">No sessions found.</td></tr>`}</tbody>
  </table>
</section>
```

with:

```ts
<section class="breakdown-section">
  <h2>Breakdown <span class="hint">— account → workspace → session → teammate; click to expand</span></h2>
  ${filterBar(data)}
  <div class="tree">${treeHtml || `<div class="empty">No sessions found.</div>`}</div>
</section>
```

3. Remove the now-unused `rowsHtml` line and the `sessionRows` function. Add, just before `rowsHtml` used to be computed:

```ts
  const treeHtml = data.tree.map((n) => treeNode(n, currency, data.generatedAt)).join("");
  const accountNames = [...new Set(data.flat.map((f) => f.account))];
  const workspaceNames = [...new Set(data.flat.map((f) => f.workspace))];
```

4. Add the embedded data script. Change the closing of the body to include the data payload before `<script>${JS}</script>`:

```ts
<script>window.__CMUX_COST__=${json({ flat: data.flat, currency, generatedAt: data.generatedAt })};</script>
<script>${JS}</script>
```

5. Add these helper functions (replace the deleted `sessionRows`):

```ts
function filterBar(data: ReportData): string {
  const accounts = [...new Set(data.flat.map((f) => f.account))];
  const workspaces = [...new Set(data.flat.map((f) => f.workspace))];
  const chips = (kind: string, names: string[]): string =>
    names
      .map(
        (n) =>
          `<label class="chip"><input type="checkbox" checked data-filter="${kind}" value="${esc(
            n,
          )}" /> ${esc(n)}</label>`,
      )
      .join("");
  return `<div class="filters">
    <div class="filter-group"><span class="fg-label">Account</span>${chips("account", accounts)}</div>
    <div class="filter-group"><span class="fg-label">Workspace</span>${chips("workspace", workspaces)}</div>
    <input class="search" type="search" placeholder="search session…" data-filter="search" />
  </div>`;
}

function treeNode(n: TreeNode, currency: string, now: number): string {
  const hasKids = n.children.length > 0;
  const caret = hasKids ? `<span class="caret">▸</span>` : `<span class="caret-spacer"></span>`;
  const attrs =
    n.level === "account"
      ? ` data-account="${esc(n.label)}"`
      : n.level === "workspace"
        ? ` data-workspace="${esc(n.label)}"`
        : n.level === "session"
          ? ` data-session="${esc(n.label)}"`
          : "";
  const kids = hasKids
    ? `<div class="tnode-children">${n.children
        .map((c) => treeNode(c, currency, now))
        .join("")}</div>`
    : "";
  return `<div class="tnode level-${n.level}"${attrs}>
    <div class="tnode-row${hasKids ? " expandable" : ""}">
      ${caret}
      <span class="tnode-label">${esc(n.label)}</span>
      <span class="tnode-cost">${esc(fmtCost(n.cost, currency))}</span>
      <span class="tnode-tokens dim">${esc(fmtTokens(n.cost.tokens))}</span>
      <span class="tnode-when dim">${esc(fmtTimeAgo(n.lastActivity, now))}</span>
    </div>
    ${kids}
  </div>`;
}

function json(value: unknown): string {
  // Safe to inline in a <script>: escape the sequences that could break out.
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
```

6. Append to the `CSS` template string (before the closing backtick):

```css
.filters{display:flex;flex-wrap:wrap;gap:14px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:12px}
.filter-group{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.fg-label{color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin-right:2px}
.chip{display:inline-flex;align-items:center;gap:5px;background:#0d1117;border:1px solid var(--line);border-radius:14px;padding:3px 9px;font-size:12px;cursor:pointer}
.chip input{margin:0}
.search{margin-left:auto;background:#0d1117;border:1px solid var(--line);border-radius:8px;color:var(--fg);padding:5px 9px;font:13px inherit}
.tree{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:6px 10px}
.tnode-children{display:none;margin-left:18px;border-left:1px solid var(--line);padding-left:8px}
.tnode.open>.tnode-children{display:block}
.tnode-row{display:grid;grid-template-columns:18px 1fr 90px 64px 44px;align-items:center;gap:10px;padding:5px 2px;border-bottom:1px solid #20262e}
.tnode-row.expandable{cursor:pointer}.tnode-row.expandable:hover{background:#1c2128}
.tnode-label{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.level-account>.tnode-row .tnode-label{font-weight:600}
.level-workspace>.tnode-row .tnode-label{color:#79c0ff}
.tnode-cost,.tnode-tokens,.tnode-when{text-align:right;font-variant-numeric:tabular-nums}
.caret{display:inline-block;transition:transform .12s;color:var(--dim)}
.caret-spacer{display:inline-block;width:1em}
.tnode.open>.tnode-row .caret{transform:rotate(90deg)}
.tnode.hidden{display:none}
```

7. Replace the `JS` template string with the tree controller:

```ts
const JS = `
(function(){
  var data = window.__CMUX_COST__ || { flat: [], currency: "USD" };

  function toggle(row){
    var node = row.parentElement;
    node.classList.toggle('open');
  }
  document.querySelectorAll('.tnode-row.expandable').forEach(function(row){
    row.addEventListener('click', function(){ toggle(row); });
  });

  function checked(kind){
    var set = {};
    document.querySelectorAll('input[data-filter="'+kind+'"]').forEach(function(cb){
      if(cb.checked) set[cb.value]=true;
    });
    return set;
  }
  function searchTerm(){
    var el = document.querySelector('input[data-filter="search"]');
    return (el && el.value ? el.value : '').toLowerCase();
  }

  function apply(){
    var accs = checked('account');
    var wss = checked('workspace');
    var term = searchTerm();

    document.querySelectorAll('.tnode.level-account').forEach(function(acc){
      var accName = acc.getAttribute('data-account');
      var accOn = !!accs[accName];
      var anyAccVisible = false;
      acc.querySelectorAll('.tnode.level-workspace').forEach(function(ws){
        var wsName = ws.getAttribute('data-workspace');
        var wsOn = accOn && !!wss[wsName];
        var anyWsVisible = false;
        ws.querySelectorAll('.tnode.level-session').forEach(function(se){
          var label = (se.getAttribute('data-session')||'').toLowerCase();
          var on = wsOn && (!term || label.indexOf(term) >= 0);
          se.classList.toggle('hidden', !on);
          if(on) anyWsVisible = true;
        });
        ws.classList.toggle('hidden', !anyWsVisible);
        if(anyWsVisible) anyAccVisible = true;
      });
      acc.classList.toggle('hidden', !anyAccVisible);
    });

    recomputeKpis(accs, wss, term);
  }

  function recomputeKpis(accs, wss, term){
    var now = data.generatedAt || Date.now();
    var DAY = 86400000;
    var d0 = new Date(now); d0.setHours(0,0,0,0);
    var spans = { today: d0.getTime(), week: now-7*DAY, month: now-30*DAY, all: 0 };
    var sums = { today:0, week:0, month:0, all:0 };
    data.flat.forEach(function(f){
      if(!accs[f.account] || !wss[f.workspace]) return;
      if(term && f.label.toLowerCase().indexOf(term) < 0) return;
      for(var k in spans){ if(f.lastActivity >= spans[k]) sums[k]+=f.cost; }
    });
    var order = ['today','week','month','all'];
    document.querySelectorAll('.kpi-value').forEach(function(el, i){
      var v = sums[order[i]];
      el.textContent = (data.currency==='USD'?'$':'') + (v<1? v.toFixed(4): v.toFixed(2));
    });
  }

  document.querySelectorAll('input[data-filter]').forEach(function(el){
    el.addEventListener('input', apply);
    el.addEventListener('change', apply);
  });
  // accounts expanded by default
  document.querySelectorAll('.tnode.level-account').forEach(function(a){ a.classList.add('open'); });
})();
`;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/render-html.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/render-html.ts src/render-html.test.ts
git -c user.name='guaire94' -c user.email='ai.powered.application@gmail.com' commit -m "Render filterable account/workspace/session/teammate tree"
```

---

## Task 10: Interactive account setup

**Files:**
- Create: `src/setup.ts`
- Test: `src/setup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/setup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { accountsFromPicks } from "./setup.js";

describe("accountsFromPicks", () => {
  const scanned = [
    { dir: "/h/.claude-talabat", label: "Talabat", transcripts: 5 },
    { dir: "/h/.claude-personal", label: "Personal", transcripts: 3 },
    { dir: "/h/.claude", label: "Default", transcripts: 1 },
  ];

  it("marks selected indices enabled and keeps the rest disabled", () => {
    const picks = accountsFromPicks(scanned, new Set([0, 1]), { 0: "Work" });
    expect(picks).toEqual([
      { dir: "/h/.claude-talabat", label: "Work", enabled: true },
      { dir: "/h/.claude-personal", label: "Personal", enabled: true },
      { dir: "/h/.claude", label: "Default", enabled: false },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/setup.test.ts`
Expected: FAIL — `Cannot find module './setup.js'`.

- [ ] **Step 3: Implement**

Create `src/setup.ts`:

```ts
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

  const sel = await ask(
    "Include which? (comma-separated numbers, or 'all') [all]: ",
  );
  const selected = parseSelection(sel, scanned.length);

  const labels: Record<number, string> = {};
  for (const i of selected) {
    const l = await ask(`Label for "${scanned[i].label}" (${scanned[i].dir}) [${scanned[i].label}]: `);
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/setup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/setup.ts src/setup.test.ts
git -c user.name='guaire94' -c user.email='ai.powered.application@gmail.com' commit -m "Add interactive account setup"
```

---

## Task 11: CLI — `accounts` command + first-run gate

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/config.ts` (add a config writer)

- [ ] **Step 1: Add a config writer**

In `src/config.ts`, add at the bottom (it needs `writeFileSync`/`mkdirSync`/`dirname`):

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Persist a config to disk (pretty-printed), creating parent dirs. */
export function saveConfig(cfg: Config, path: string = configPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
}
```

(Merge the new `node:fs` import with the existing `import { readFileSync } from "node:fs";` line → `import { mkdirSync, readFileSync, writeFileSync } from "node:fs";`. Add `import { configPath } from "./paths.js";` already exists — keep it; add the `dirname` import.)

- [ ] **Step 2: Implement the CLI command + gate**

In `src/cli.ts`:

1. Add imports:

```ts
import { loadConfig, saveConfig } from "./config.js";
import { configPath } from "./paths.js";
import { scanClaudeDirs } from "./accounts.js";
import { runAccountSetup } from "./setup.js";
```

2. Add an `accounts` case to the `switch`, before `case "install"`:

```ts
    case "accounts": {
      if (rest[0] === "--list") {
        const cfg = loadConfig();
        if (cfg.accounts.length === 0) {
          process.stdout.write("no accounts configured — auto-discovering:\n");
          for (const s of scanClaudeDirs()) {
            process.stdout.write(`  ${s.label.padEnd(12)} ${s.transcripts} sessions  ${s.dir}\n`);
          }
        } else {
          for (const a of cfg.accounts) {
            process.stdout.write(`  [${a.enabled ? "x" : " "}] ${a.label.padEnd(12)} ${a.dir}\n`);
          }
        }
        return 0;
      }
      const picks = await runAccountSetup();
      if (!picks) {
        process.stderr.write("not a TTY (or no Claude dirs found) — nothing to configure\n");
        return 1;
      }
      const cfg = loadConfig();
      saveConfig({ ...cfg, accounts: picks });
      const enabled = picks.filter((p) => p.enabled).length;
      process.stdout.write(`saved ${enabled} account(s) -> ${configPath()}\n`);
      return 0;
    }
```

3. Add a first-run gate helper near the top of the file (after `selfCommand`/`quote`):

```ts
/** On first run, offer interactive account setup (TTY only). */
async function maybeFirstRunSetup(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.accounts.length > 0) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      "cmux-cost: no accounts configured — including all Claude dirs. Run `cmux-cost accounts` to choose.\n",
    );
    return;
  }
  const picks = await runAccountSetup();
  if (picks) saveConfig({ ...cfg, accounts: picks });
}
```

4. Call it at the start of the `report`, `today`, and `sessions` cases (first line of each):

```ts
    case "report": {
      await maybeFirstRunSetup();
      const path = await openReport();
      ...
```

```ts
    case "today": {
      await maybeFirstRunSetup();
      const { cfg, views } = await loadViews();
      ...
```

```ts
    case "sessions": {
      await maybeFirstRunSetup();
      const { cfg, views } = await loadViews();
      ...
```

5. Add `accounts` to the `HELP` string, after the `uninstall` line:

```
  cmux-cost accounts       Choose/label which Claude accounts to include
```

- [ ] **Step 3: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: PASS (no errors anywhere).

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts src/config.ts
git -c user.name='guaire94' -c user.email='ai.powered.application@gmail.com' commit -m "Add accounts CLI command and first-run setup gate"
```

---

## Task 12: Full test run, build, smoke test, docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS — all suites green (the original 27+ plus the new account/workspace/tree/setup tests).

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS; `dist/cli.js` regenerated.

- [ ] **Step 3: Smoke test the report generation (non-interactive path)**

Run: `node dist/cli.js today`
Expected: prints totals; stderr shows the "no accounts configured — including all Claude dirs" hint (because config has no `accounts` yet). The total should now be HIGHER than before because `.claude-talabat` (281 sessions) is finally included.

Run: `node dist/cli.js report && open ~/.cache/cmux-cost/report.html`
Expected: the report opens; the Breakdown section shows the account → workspace → session → teammate tree with a filter bar; toggling an account checkbox hides its subtree and updates the KPI cards.

- [ ] **Step 4: Smoke test the interactive setup**

Run: `node dist/cli.js accounts`
Expected: lists `.claude-personal`, `.claude`, `.claude-talabat` with session counts; prompts for inclusion + labels; writes them to `~/.config/cmux-cost/config.json`. Verify with: `node dist/cli.js accounts --list`.
Disable `.claude` here (the user does not use it personally).

- [ ] **Step 5: Update the README**

In `README.md`, under the "How costing works" section, add a new subsection:

```markdown
## Accounts & workspaces

- **Accounts** — cmux-cost scans `~/.claude*` (and `~/.config/claude`) for Claude
  config dirs that contain a `projects/` folder. On first run (`cmux-cost report`
  in a terminal) it asks which to include and how to label them; `cmux-cost
  accounts` re-runs that picker, `cmux-cost accounts --list` prints the current
  set. Non-interactive runs (dock, hook) include every discovered dir.
- **Workspaces** — the `Stop` hook records which cmux workspace each session ran
  in (`CMUX_WORKSPACE_ID` → title via `cmux list-workspaces`) into
  `~/.cache/cmux-cost/workspaces.json`. This is captured going forward; sessions
  that ran before the hook recorded them appear under "unknown workspace".
- The HTML report's **Breakdown** is a collapsible tree:
  account → workspace → session → teammate, filterable by account and workspace.
```

Update the "Configuration" block to document `accounts`:

```jsonc
{
  "currency": "USD",
  "budgetSoft": 5,
  "budgetHard": 15,
  "accounts": [],       // [] = scan + first-run setup; else [{dir,label,enabled}]
  "priceOverrides": {}
}
```

- [ ] **Step 6: Commit**

```bash
git add README.md
git -c user.name='guaire94' -c user.email='ai.powered.application@gmail.com' commit -m "Document accounts and workspace breakdown"
```

- [ ] **Step 7: Re-install the hook (so the new workspace-recording hook is live)**

The hook command path is unchanged, but rebuild already updated `dist/cli.js`. No reinstall needed (the hook points at `dist/cli.js`). Confirm the hook still resolves:

Run: `node dist/cli.js version`
Expected: `cmux-cost 0.1.0`.

---

## Self-Review notes (done while writing)

- **Spec coverage:** account discovery + setup (Tasks 3, 10, 11) ✓; account in report (Tasks 6, 9) ✓; workspace name in report (Tasks 4, 8, 9) ✓; 4-level breakdown tree (Tasks 6, 9) ✓; filtering/deep-dive (Task 9) ✓; going-forward workspace only (Task 8, no backfill) ✓; `.claude-talabat` bug fix (Tasks 3, 5, 7) ✓; partial-aware rollup (Task 6 via `addCost`) ✓; hook never throws (Tasks 4, 8) ✓; tests per module ✓.
- **Type consistency:** `Account{dir,label}`, `Workspace{id,title}`, `AccountConfig{dir,label,enabled}`, `ScannedDir{dir,label,transcripts}`, `TreeNode{key,label,level,cost,lastActivity,children}`, `FlatSession{...}` are used identically across tasks. `loadAllSessions(Account[])`, `loadSession(meta, account)`, `buildSessionView(session, prices)` signatures match their call sites in `app.ts`.
- **Out of scope (unchanged):** no CLI `--account/--workspace` filter flags; no historical workspace backfill.
```
