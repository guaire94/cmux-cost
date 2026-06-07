import { execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { windowTotals } from "./aggregate.js";
import { loadViews } from "./app.js";
import { scanClaudeDirs } from "./accounts.js";
import { loadConfig, saveConfig } from "./config.js";
import { runAccountSetup } from "./setup.js";
import { claudeSettingsPath, configPath, dockConfigPath } from "./paths.js";
import {
  installDock,
  installHook,
  uninstallDock,
  uninstallHook,
} from "./install.js";
import { renderSessionDetail, renderSessions, renderTotals } from "./render-text.js";
import { runDock } from "./render-tui.js";
import { runHook } from "./hook.js";
import { openReport } from "./report.js";

const VERSION = "0.1.0";

/** Absolute command that re-invokes this CLI with a subcommand (for hooks/dock). */
function selfCommand(sub: string): string {
  const script = fileURLToPath(import.meta.url);
  return `${quote(execPath)} ${quote(script)} ${sub}`;
}
function quote(s: string): string {
  return /[\s"']/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

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

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case "hook": {
      await runHook(await readStdin());
      return 0;
    }
    case "dock": {
      await runDock();
      return 0;
    }
    case "report": {
      await maybeFirstRunSetup();
      const path = await openReport();
      process.stdout.write(`report: ${path}\n`);
      return 0;
    }
    case "today": {
      await maybeFirstRunSetup();
      const { cfg, views } = await loadViews();
      process.stdout.write(renderTotals(windowTotals(views, Date.now()), cfg.currency) + "\n");
      return 0;
    }
    case "sessions": {
      await maybeFirstRunSetup();
      const { cfg, views } = await loadViews();
      process.stdout.write(renderSessions(views, cfg.currency, Date.now()) + "\n");
      return 0;
    }
    case "session": {
      const id = rest[0];
      if (!id) {
        process.stderr.write("usage: cmux-cost session <id>\n");
        return 1;
      }
      const { cfg, views } = await loadViews();
      const view = views.find((v) => v.id === id || v.id.startsWith(id));
      if (!view) {
        process.stderr.write(`session not found: ${id}\n`);
        return 1;
      }
      process.stdout.write(renderSessionDetail(view, cfg.currency) + "\n");
      return 0;
    }
    case "accounts": {
      if (rest[0] === "--list") {
        const cfg = loadConfig();
        if (cfg.accounts.length === 0) {
          process.stdout.write("no accounts configured — auto-discovering:\n");
          for (const s of scanClaudeDirs()) {
            process.stdout.write(
              `  ${s.label.padEnd(12)} ${s.transcripts} sessions  ${s.dir}\n`,
            );
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
    case "install": {
      const hookCmd = selfCommand("hook");
      installHook(claudeSettingsPath(), hookCmd);
      installDock(dockConfigPath(), selfCommand("dock"));
      process.stdout.write(
        `installed:\n  hook -> ${claudeSettingsPath()}\n  dock -> ${dockConfigPath()}\n`,
      );
      return 0;
    }
    case "uninstall": {
      uninstallHook(claudeSettingsPath(), selfCommand("hook"));
      uninstallDock(dockConfigPath());
      process.stdout.write("uninstalled hook + dock control\n");
      return 0;
    }
    case "version":
    case "--version":
    case "-v":
      process.stdout.write(`cmux-cost ${VERSION}\n`);
      return 0;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(HELP);
      return 0;
    default:
      process.stderr.write(`unknown command: ${cmd}\n\n${HELP}`);
      return 1;
  }
}

const HELP = `cmux-cost ${VERSION} — token cost for cmux

Usage:
  cmux-cost install        Register the Claude hook + add the dock control
  cmux-cost uninstall      Remove both
  cmux-cost accounts       Choose/label which Claude accounts to include
  cmux-cost report         Generate the HTML report and open it in cmux
  cmux-cost dock           Run the dock summary TUI (used by the dock control)
  cmux-cost today          Print today / 7d / 30d / all-time totals
  cmux-cost sessions       Print a table of sessions
  cmux-cost session <id>   Print the per-teammate breakdown for one session
  cmux-cost hook           Internal — invoked by the Claude Stop hook
  cmux-cost version
`;

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
