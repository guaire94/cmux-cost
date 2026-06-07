# cmux-cost — Design Spec

**Date:** 2026-06-07
**Status:** Approved (user delegated full trust to proceed to implementation)

## Goal

A standalone, reusable tool (`cmux-cost`, npm/brew) that surfaces AI coding-agent
token cost into [cmux](https://github.com/manaflow-ai/cmux), the terminal
multiplexer. It reads agent session transcripts (the same local JSONL files
`ccusage` reads), computes cost from an OpenRouter-sourced price table, and shows
it in three places:

1. **Live badge per cmux workspace** — updated on every Claude turn via a hook.
2. **Dock control "Cost"** — a compact live TUI in the cmux right sidebar that
   also launches the full report.
3. **Full HTML report** — opened in a cmux browser pane on demand.

Plus on-demand CLI text output (`today`, `sessions`, `session <id>`).

## Non-goals (YAGNI)

- No background daemon (Approach 1: stateless/on-demand; badge is hook-driven).
- No budget-enforcement / hard stops — colour hints only.
- No real-time auto-refresh of the HTML report in v1 (regenerate on click; a
  `--watch` flag is a thin future extension).
- Not an upstream cmux change — integrates purely via cmux's public CLI + config
  files and the agent's standard hook mechanism.

## Granularity (all four, per user)

- **Per workspace (live)** — cost of the Claude session running in that workspace.
- **Per session** — ccusage-style: one row per session, input/output/cache/$ totals.
- **Per teammate / subagent** — breakdown of a multi-agent session, one row per
  `subagents/agent-*.jsonl`.
- **Totals** — today / 7d / 30d / all-time.

## Architecture

Single Node/TypeScript binary. Pure-logic units are isolated and unit-tested;
I/O units (cmux CLI wrapper, hook stdin) are thin and mocked in tests.

### Units

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `discover` | Find Claude project roots. Respect `CLAUDE_CONFIG_DIR`, else `~/.claude`, `~/.config/claude`. (This user: `~/.claude-personal/projects`.) | fs |
| `parse` | One JSONL file → aggregated `Usage` per model (`input`, `output`, `cacheCreation`, `cacheRead`). Skips unparseable lines. | — |
| `pricing` | Fetch OpenRouter `/api/v1/models`, cache to `~/.cache/cmux-cost/prices.json` (TTL 24h), normalize model IDs, expose `priceFor(modelId)`. | fetch, fs |
| `normalizeModelId` | Map Claude Code IDs (`claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5-*`) → OpenRouter IDs (`anthropic/...`). Config overrides win. | — |
| `cost` | `Usage` × price → `$`. Aggregate session (main + subagents), teammate (one subagent), and time-window rollups. | parse, pricing |
| `cmux` | Thin wrapper over the cmux CLI: `setStatus`, `clearStatus`, `browserOpen`. Resolves the cmux binary; no-op gracefully if cmux absent. | child_process |
| `renderHtml` | Self-contained HTML (inline CSS+JS, data embedded as JSON) → file. Sessions table, click-to-expand teammates, 14-day SVG bar chart, totals header. | cost |
| `renderTui` | Compact dock TUI: session/today/month totals + budget bar; keys `o` (open HTML), `r` (refresh), `q` (quit). | cost, cmux |
| `renderText` | Plain text tables for `today` / `sessions` / `session <id>`. | cost |
| `install` | Idempotent + timestamped backup. Writes `Stop`/`SubagentStop` hook into Claude `settings.json`; adds dock control to `~/.config/cmux/dock.json`. `uninstall` reverses both. | fs |
| `hook` | Internal. Reads hook JSON from stdin (`session_id`, `transcript_path`, `cwd`), computes session cost, calls `cmux setStatus` for `CMUX_WORKSPACE_ID`. Non-blocking, fails silent, logs to `~/.cache/cmux-cost/hook.log`. | cost, cmux |
| `cli` | Arg routing for `install|uninstall|hook|dock|report|today|sessions|session`. | all |

### Cost model

- **Session total** = main `<id>.jsonl` + all `<id>/subagents/agent-*.jsonl`.
- **Teammate** = a single `agent-*.jsonl`; label derived from its first task
  prompt (`Your scope:` line, else first ~80 chars).
- Per-model: `input·priceIn + output·priceOut + cacheCreation·priceCacheWrite + cacheRead·priceCacheRead`.

### Pricing (the real risk)

OpenRouter `pricing` fields are per-token USD strings:
`prompt`, `completion`, `input_cache_read`, `input_cache_write`. Model-ID
mismatch is the main risk → `normalizeModelId` + config `priceOverrides`.
**Fallback:** unknown price ⇒ show tokens, omit `$`, emit a warning. Never crash,
never fabricate a number.

### The three surfaces

1. **Badge** — hook runs inside the pane (`CMUX_WORKSPACE_ID` set) and receives
   `transcript_path` → `cmux set-status cost "$2.75 · 1.2M" --workspace … --icon
   dollarsign --color <green|orange|red by budget>`.
2. **Dock control** — cmux dock entries run a command in a Ghostty terminal
   section, so the "button" is a small live TUI (`cmux-cost dock`) acting as
   summary + launcher.
3. **HTML report** — `cmux-cost report --open` writes `~/.cache/cmux-cost/report.html`
   then `cmux browser open file://…`.

## Config

`~/.config/cmux-cost/config.json`:
```jsonc
{
  "currency": "USD",
  "budgetSoft": 5,      // badge turns orange above this (per session)
  "budgetHard": 15,     // badge turns red above this
  "projectRoots": [],   // [] = auto-discover
  "priceOverrides": {}  // { "claude-opus-4-8": "anthropic/claude-opus-4.x" } or explicit prices
}
```

## Error handling / guardrails

- Hook is non-blocking (<~100ms target), fails silently, logs to hook.log.
- Unparseable JSONL lines skipped; partial files tolerated.
- OpenRouter unreachable → use cached prices; if none, token-only + warning.
- `install` backs up every file it edits (`<file>.bak-<timestamp>`), idempotent.
- `cmux` wrapper no-ops if the cmux binary is not found.

## Testing

vitest + fixtures. Unit-test pure logic: `parse`, `normalizeModelId`, `cost`
(session/teammate/window aggregation), `renderHtml` (snapshot), `pricing`
(parse + TTL + fallback, network mocked). I/O (`cmux`, `hook` stdin) mocked.

## Packaging

TypeScript, `tsup` → single `cmux-cost` bin, npm `bin`, Node ≥18 (native fetch).
Repo: `~/Documents/projects/perso/cmux-cost`. Brew formula later.

## Open follow-ups (post-v1)

- `--watch` live HTML report.
- Support other agents' transcripts (codex/opencode/gemini) via their JSONL.
- Brew distribution.
