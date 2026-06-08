# cmux-cost

Token cost for [cmux](https://github.com/manaflow-ai/cmux) — a ccusage-style
breakdown surfaced directly in your terminal multiplexer.

It reads the local JSONL transcripts that Claude Code (and other agents) write,
prices them from the OpenRouter model table, and shows cost in three places:

- **Live badge per workspace** — `$2.75 · 1.2M` on the cmux workspace running
  Claude, updated on every turn via a `Stop` hook. Colour-coded by budget.
  cmux drops these badges when it is killed; `cmux-cost refresh` (or clicking the
  💰 button) re-applies them.
- **💰 button in the surface tab bar** — a `cmux.json` action added next to the
  built-in terminal/browser/split buttons. One click refreshes every workspace
  badge and opens the full HTML report.
- **HTML report** — a self-contained dashboard opened in a cmux browser pane:
  today / 7d / 30d / all-time totals, a daily-spend chart, and a sessions table
  where each row expands to a **per-teammate (subagent) breakdown**.

Plus on-demand CLI output: `today`, `sessions`, `session <id>`.

## Install

```sh
npm install      # deps
npm run build    # -> dist/cli.js
node dist/cli.js install   # register the Claude hook + add the 💰 tab-bar button
```

`install` is idempotent and backs up every file it touches
(`<file>.bak-<timestamp>`). It writes:

- the `Stop`/`SubagentStop` hook into your Claude `settings.json`
  (honours `CLAUDE_CONFIG_DIR`), and
- the `cmux-cost.report` action + 💰 surface-tab-bar button into
  `~/.config/cmux/cmux.json` (preserving the built-in buttons).

Then `cmux reload-config` to show the button.

## Usage

```sh
cmux-cost report          # generate the HTML dashboard and open it in cmux
cmux-cost today           # today / 7d / 30d / all-time totals
cmux-cost sessions        # table of sessions, newest first
cmux-cost session <id>    # per-teammate breakdown for one session
cmux-cost accounts        # choose/label which Claude accounts to include
cmux-cost uninstall       # remove the hook + 💰 button
```

## How costing works

- A **session** = its main transcript `<id>.jsonl` plus every subagent
  transcript under `<id>/subagents/agent-*.jsonl`.
- A **teammate** is one subagent transcript; its label is taken from the first
  task prompt (`Your scope:` marker, else the first line).
- Per model: `input·pIn + output·pOut + cacheCreation·pCacheWrite + cacheRead·pCacheRead`.
- Prices come from `https://openrouter.ai/api/v1/models`, cached for 24h in
  `~/.cache/cmux-cost/prices.json`. Model ids are normalised
  (`claude-opus-4-8` → `anthropic/claude-opus-4.8`).
- **Honesty over guessing:** a cost is always the sum of the *known* model
  costs. If a model's price can't be resolved, the figure is shown as a lower
  bound with a `+` (e.g. `$152.02+`) rather than a fabricated exact number.

## Accounts & workspaces

- **Accounts** — cmux-cost scans `~/.claude*` (and `~/.config/claude`) for Claude
  config dirs that contain a `projects/` folder. On first run (`cmux-cost report`
  in a terminal) it asks which to include and how to label them; `cmux-cost
  accounts` re-runs that picker, `cmux-cost accounts --list` prints the current
  set. Non-interactive runs (button, hook) include every discovered dir.
- **Workspaces & session names** — the `Stop` hook records which cmux workspace
  each session ran in (`CMUX_WORKSPACE_ID` → title via `cmux list-workspaces`)
  and the session's cmux **tab title** (`CMUX_SURFACE_ID` → title via
  `cmux list-pane-surfaces`, e.g. "Refactor cost report") into
  `~/.cache/cmux-cost/workspaces.json`. Both are captured going forward; sessions
  that ran before appear under "unknown workspace" and fall back to a short
  `id · project` name.
- The HTML report is **account-first**: four global totals (today / 7d / 30d /
  all-time) sit on top, then a tab per Claude account. Selecting an account shows
  only its data — cost-by-teammate, daily spend, and a collapsible
  workspace → session → teammate **Breakdown** (filterable by workspace, with a
  session search). Nothing is ever aggregated across accounts except the four
  global totals.

## Configuration

`~/.config/cmux-cost/config.json` (all optional):

```jsonc
{
  "currency": "USD",
  "budgetSoft": 5,      // badge turns orange above this (per session)
  "budgetHard": 15,     // badge turns red above this
  "accounts": [],       // [] = scan + first-run setup; else [{dir,label,enabled}]
  "priceOverrides": {}  // { "some-model-id": "anthropic/claude-opus-4.8" }
}
```

## Develop

```sh
npm test          # vitest
npm run typecheck
npm run dev       # tsup --watch
```
