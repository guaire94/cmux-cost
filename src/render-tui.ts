import { windowTotals } from "./aggregate.js";
import { loadViews } from "./app.js";
import { pushWorkspaceBadges } from "./badges.js";
import { fmtCost, fmtTokens } from "./format.js";
import { openReport } from "./report.js";
import { renderSessions, renderTotals } from "./render-text.js";

/**
 * The dock control: a compact, always-on summary that doubles as a launcher
 * for the full HTML report. Runs in a cmux Ghostty terminal section.
 *
 * Because the dock command starts as soon as cmux renders the sidebar, it also
 * re-applies every workspace's cost badge here — that is what brings the costs
 * back right after cmux is killed and relaunched (badges are runtime state).
 *
 * Keys: o = open HTML report, r = refresh, q = quit.
 */
export async function runDock(): Promise<void> {
  const draw = async () => {
    process.stdout.write("\x1b[2J\x1b[H"); // clear + home
    try {
      const { cfg, views } = await loadViews();
      pushWorkspaceBadges(views, cfg);
      const totals = windowTotals(views, Date.now());
      const top = views.find((v) => v.lastActivity > 0);
      const line = (s: string) => process.stdout.write(s + "\n");
      line("\x1b[1m💰 cmux-cost\x1b[0m");
      line("");
      line(
        `  Most recent: ${top ? `${fmtCost(top.cost, cfg.currency)} (${fmtTokens(top.cost.tokens)})` : "—"}`,
      );
      line("");
      line("  " + renderTotals(totals, cfg.currency));
      line("");
      line(renderSessions(views, cfg.currency, Date.now(), 8));
      line("");
      line("\x1b[2m  [o] open report   [r] refresh   [q] quit\x1b[0m");
    } catch (err) {
      process.stdout.write(`error: ${String(err)}\n`);
    }
  };

  await draw();
  const timer = setInterval(draw, 5000);

  const stdin = process.stdin;
  if (stdin.isTTY) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", async (key: string) => {
      if (key === "q" || key === "") {
        clearInterval(timer);
        if (stdin.isTTY) stdin.setRawMode(false);
        process.exit(0);
      } else if (key === "o") {
        await openReport();
      } else if (key === "r") {
        await draw();
      }
    });
  }
}
