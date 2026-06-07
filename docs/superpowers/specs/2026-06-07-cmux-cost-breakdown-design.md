# cmux-cost — Hierarchical breakdown: Account → Workspace → Session → Teammate

Date: 2026-06-07
Status: Approved (design)

## Goal

Let the user slice cost along four nested axes and deep-dive into any of them:

```
Claude account  →  cmux workspace  →  session  →  teammate (subagent)
```

Concretely:

- Each session is attributed to a **Claude account** (which config dir the
  transcript lives under) and a **cmux workspace** (the named workspace it ran
  in).
- The account appears in the report; the workspace name appears in the report.
- The HTML report becomes an interactive, collapsible tree filterable by
  account and workspace, so the user can drill from a grand total down to a
  single teammate.

## Motivation / current state

`defaultProjectRoots()` is hardcoded to `$CLAUDE_CONFIG_DIR/projects`,
`~/.claude/projects`, `~/.config/claude/projects`, `~/.claude-personal/projects`.
On the user's machine the real dirs are:

| Dir | Transcripts | Counted today? |
|---|---|---|
| `.claude-personal` | 677 | yes |
| `.claude` | 105 | yes |
| `.claude-talabat` | 281 | **no — invisible** |

So 281 Talabat sessions are silently excluded. Replacing the hardcoded list
with a scanned + user-confirmed account list fixes this as a side effect.

## Decisions (from brainstorming)

1. **Workspace attribution is going-forward only.** The hook records
   `session → workspace` live; historical sessions show "unknown workspace".
   No best-effort cwd backfill (avoids false attribution).
2. **Primary surface is the interactive HTML report.** CLI gains only the
   `accounts` setup command and account/workspace columns in `sessions`; no
   `--account`/`--workspace` filter flags for now (YAGNI).
3. **Accounts are discovered by scanning and confirmed interactively** on first
   run, with config override. Labels default from the dir name.

## Architecture

### New / changed modules

| Module | Responsibility |
|---|---|
| `accounts.ts` (new) | Scan `~/.claude*` + `~/.config/claude` for dirs with a `projects/` subdir; derive default labels; resolve the active account list (config or fallback); map a project root → account. |
| `workspaces.ts` (new) | Sidecar read/write (`~/.cache/cmux-cost/workspaces.json`); parse `cmux --id-format both list-workspaces` into `UUID → title`; `recordWorkspace()` upsert; `loadWorkspaceMap()`. |
| `setup.ts` (new) | Interactive first-run account picker (TTY only): list scanned dirs with counts, ask include + label, persist to config. |
| `config.ts` | Add `accounts: AccountConfig[]` to `Config` + `mergeConfig`. |
| `discover.ts` | `loadAllSessions` keeps roots; roots now come from the account list. Each `Session` is tagged with its `account` and source root. |
| `aggregate.ts` | `SessionView` gains `account` + `workspace`; add `buildTree()` producing the Account→Workspace→Session→Teammate rollup. |
| `hook.ts` | After computing cost, call `recordWorkspace(session_id, CMUX_WORKSPACE_ID, resolvedTitle)`. Best-effort, never throws. |
| `app.ts` | `loadViews` resolves accounts → roots, joins the workspace sidecar, attaches `account`/`workspace` to each view. |
| `render-html.ts` | Render the collapsible tree + filter bar; embed the tree + per-session data as JSON for client-side filtering. |
| `cli.ts` | New `accounts` command; first-run setup gate on `report`/`today`/`sessions` (TTY only). |

### Data model additions

```ts
// config.ts
interface AccountConfig {
  dir: string;        // absolute path to the Claude config dir (…/.claude-talabat)
  label: string;      // human label shown in the report ("Talabat")
  enabled: boolean;   // false = scanned but excluded
}
// Config gains: accounts: AccountConfig[]   (default [])

// types.ts
interface Account { dir: string; label: string; }
interface Workspace { id: string; title: string; }

// Session gains:
//   account: Account            // always set (derived from root)
//   workspace?: Workspace       // set when sidecar has the session id

// aggregate.ts
interface SessionView {
  …existing…
  account: Account;
  workspace?: Workspace;         // undefined → "unknown workspace" bucket
}

interface TreeNode {
  key: string;                   // stable id for the DOM
  label: string;
  level: "account" | "workspace" | "session" | "teammate";
  cost: CostResult;              // sum of descendants (partial-aware)
  tokens: number;
  lastActivity: number;
  children: TreeNode[];          // empty for teammate leaves
}
```

### Account discovery & setup flow

```
cmux-cost report (TTY)
  └─ config.accounts empty?
       ├─ yes → scanClaudeDirs() → interactive picker → write config.accounts
       └─ no  → use config.accounts (enabled only)

cmux-cost report (non-TTY: dock, browser-open, hook)
  └─ config.accounts empty? → fallback: every scanned dir, label = derived
                              (prints hint: "run `cmux-cost accounts`")
```

- `scanClaudeDirs()` returns `{ dir, label, transcripts }[]`, sorted by count
  desc. Label derivation: strip leading `.claude`, drop separators →
  `.claude-talabat` → "Talabat", `.claude-personal` → "Personal", `.claude` →
  "Default".
- The picker lets the user toggle inclusion and edit each label. `.claude`
  (the 105-transcript default dir) is presented like any other; the user may
  disable it.
- `cmux-cost accounts` re-runs the picker anytime; `cmux-cost accounts --list`
  prints the current config non-interactively.

### Workspace capture (going-forward)

- Sidecar: `~/.cache/cmux-cost/workspaces.json`
  `{ [sessionId]: { workspaceId, title, lastSeen } }`.
- In the hook: `CMUX_WORKSPACE_ID` gives the UUID; resolve the title by parsing
  `cmux --id-format both list-workspaces` (lines: `* workspace:N <UUID> <title> [flags]`).
  Cache the parse per process. Upsert keyed by `session_id` from the hook
  payload. Wrapped so any failure is logged and swallowed.
- Report join: `view.workspace = sidecar[session.id]` (else undefined →
  grouped under a single "unknown workspace" node within its account).

### Aggregation: tree rollup

`buildTree(views)`:
- Group views by `account.label` → within each, by `workspace.title`
  (undefined → "unknown workspace") → list sessions → each session's teammates.
- Every node's `cost`/`tokens`/`lastActivity` = aggregate of its children using
  the existing `addCost` (so `partial` / `+` lower-bound semantics bubble up).
- Nodes sorted by cost desc at each level.
- Grand total = sum of account nodes (used for the "% of total" share bars).

### HTML report

- **Filter bar:** account chips (multi-select) + workspace chips (multi-select,
  scoped to selected accounts) + a text search box. Default: all selected.
- **Tree:** four indent levels, each row = caret (if children) · label ·
  cost (with `+` when partial) · tokens · share bar · last activity. Accounts
  expanded by default; deeper levels collapsed.
- **Totals cards + daily chart** recompute from the filtered set.
- Implementation: the full tree + a flat session index are serialized to JSON
  and embedded in the page; a small vanilla-JS controller handles
  expand/collapse, filtering, and recomputation. The page stays self-contained
  (no network), consistent with the current report.

### CLI changes

- `cmux-cost accounts [--list]` — interactive setup / print config.
- `sessions` text output gains `account` and `workspace` columns.
- First-run setup gate added to `report`/`today`/`sessions` (TTY only).
- `today` output unchanged in shape (totals already span all accounts).

## Error handling

- Hook stays panic-proof: workspace resolution/sidecar write are best-effort,
  logged to `hook.log`, never thrown.
- `cmux` binary missing → workspace titles unresolved → sidecar stores
  `title: ""`; report shows the UUID-less "unknown workspace" bucket. No crash.
- Non-TTY + empty accounts → auto-fallback, never blocks the dock/report.
- Corrupt/missing sidecar or config → treated as empty (existing `try/catch`
  pattern in `loadConfig`).

## Testing

Keep the existing vitest discipline (pure logic unit-tested; thin FS/`cmux`
wrappers not unit-tested):

- `accounts.test.ts` — label derivation; scan result shaping; enabled-only
  resolution; config merge of `accounts`.
- `workspaces.test.ts` — parse `list-workspaces --id-format both` output
  (incl. the `*`/`[selected]` markers); sidecar upsert merge.
- `aggregate.test.ts` — `buildTree` grouping, cost rollup, partial bubbling,
  "unknown workspace" bucketing, sort order.
- `render-html.test.ts` — embedded tree JSON shape; filter index presence.
- `config.test.ts` — `accounts` default + merge.

## Migration / back-compat

- Existing `config.json` without `accounts` → first-run setup on next TTY run,
  else auto-fallback. No manual migration needed.
- No sidecar yet → all sessions "unknown workspace" until hooks repopulate it.
- Hook/badge/dock behavior unchanged for the live badge.
- `npm link`-ed install keeps working; no new runtime deps (picker uses Node
  `readline`, no inquirer).

## Out of scope

- Backfilling workspace names for historical sessions.
- CLI `--account`/`--workspace` filter flags (can be added later).
- Cross-account dedup or merging of identically-named workspaces across
  accounts (kept separate by account on purpose).
