# cmux-cost

Token cost for [cmux](https://github.com/manaflow-ai/cmux) — a ccusage-style
breakdown surfaced directly in your terminal multiplexer.

It reads the local JSONL transcripts that Claude Code (and other agents) write,
prices them from the OpenRouter model table, and shows cost in three places:

- **Live badge per workspace** — `$2.75 · 1.2M` on the cmux workspace running
  Claude, updated on every turn via a `Stop` hook. Colour-coded by budget.
- **Dock control "💰 Cost"** — a compact live summary in the cmux right sidebar
  that also launches the full report (`o`).
- **HTML report** — a self-contained dashboard opened in a cmux browser pane:
  today / 7d / 30d / all-time totals, a daily-spend chart, and a sessions table
  where each row expands to a **per-teammate (subagent) breakdown**.

Plus on-demand CLI output: `today`, `sessions`, `session <id>`.

## Install

```sh
npm install      # deps
npm run build    # -> dist/cli.js
node dist/cli.js install   # register the Claude hook + add the dock control
```

`install` is idempotent and backs up every file it touches
(`<file>.bak-<timestamp>`). It writes:

- the `Stop`/`SubagentStop` hook into your Claude `settings.json`
  (honours `CLAUDE_CONFIG_DIR`), and
- the `cost` control into `~/.config/cmux/dock.json`.

Then `cmux reload-config` to show the dock control.

## Usage

```sh
cmux-cost report          # generate the HTML dashboard and open it in cmux
cmux-cost today           # today / 7d / 30d / all-time totals
cmux-cost sessions        # table of sessions, newest first
cmux-cost session <id>    # per-teammate breakdown for one session
cmux-cost uninstall       # remove the hook + dock control
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

## Configuration

`~/.config/cmux-cost/config.json` (all optional):

```jsonc
{
  "currency": "USD",
  "budgetSoft": 5,      // badge turns orange above this (per session)
  "budgetHard": 15,     // badge turns red above this
  "projectRoots": [],   // [] = auto-discover (honours CLAUDE_CONFIG_DIR)
  "priceOverrides": {}  // { "some-model-id": "anthropic/claude-opus-4.8" }
}
```

## Develop

```sh
npm test          # vitest
npm run typecheck
npm run dev       # tsup --watch
```
