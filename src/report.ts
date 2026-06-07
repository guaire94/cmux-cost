import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildReportData, loadViews } from "./app.js";
import { browserOpen } from "./cmux.js";
import { reportPath } from "./paths.js";
import { renderHtml } from "./render-html.js";

/** Generate the HTML report file and return its path. */
export async function generateReport(nowMs: number = Date.now()): Promise<string> {
  const loaded = await loadViews();
  const html = renderHtml(buildReportData(loaded, nowMs));
  const path = reportPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
  return path;
}

/** Generate the report and open it in a cmux browser pane. */
export async function openReport(nowMs: number = Date.now()): Promise<string> {
  const path = await generateReport(nowMs);
  browserOpen(`file://${path}`);
  return path;
}
