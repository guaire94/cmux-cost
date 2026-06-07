import type { DayPoint, SessionView, WindowTotals } from "./aggregate.js";
import { fmtCost, fmtTimeAgo, fmtTokens, fmtUsd } from "./format.js";

export interface ReportData {
  generatedAt: number;
  currency: string;
  totals: WindowTotals;
  sessions: SessionView[];
  series: DayPoint[];
  warnings: string[];
}

/** Render a self-contained HTML cost dashboard (inline CSS + JS, data embedded). */
export function renderHtml(data: ReportData): string {
  const { currency } = data;
  const kpis = [
    ["Today", data.totals.today],
    ["Last 7 days", data.totals.week],
    ["Last 30 days", data.totals.month],
    ["All time", data.totals.all],
  ] as const;

  const kpiHtml = kpis
    .map(
      ([label, c]) => `
      <div class="kpi">
        <div class="kpi-label">${esc(label)}</div>
        <div class="kpi-value">${esc(fmtCost(c, currency))}</div>
        <div class="kpi-sub">${esc(fmtTokens(c.tokens))} tokens</div>
      </div>`,
    )
    .join("");

  const rowsHtml = data.sessions
    .map((v, i) => sessionRows(v, i, currency, data.generatedAt))
    .join("");

  const warnHtml = data.warnings.length
    ? `<div class="warn">⚠ ${data.warnings.map(esc).join(" · ")}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>cmux-cost</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>💰 cmux-cost</h1>
  <div class="generated">generated ${esc(new Date(data.generatedAt).toLocaleString())}</div>
</header>
${warnHtml}
<section class="kpis">${kpiHtml}</section>
<section class="chart"><h2>Daily spend</h2>${chart(data.series, currency)}</section>
<section class="sessions">
  <h2>Sessions</h2>
  <table>
    <thead><tr><th></th><th>Session</th><th>Project</th><th class="num">Cost</th><th class="num">Tokens</th><th class="num">When</th></tr></thead>
    <tbody>${rowsHtml || `<tr><td colspan="6" class="empty">No sessions found.</td></tr>`}</tbody>
  </table>
</section>
<script>${JS}</script>
</body>
</html>`;
}

function sessionRows(v: SessionView, i: number, currency: string, now: number): string {
  const hasMates = v.teammates.length > 0;
  const caret = hasMates ? `<span class="caret">▸</span>` : "";
  const main = `<tr class="session${hasMates ? " expandable" : ""}" data-row="${i}">
    <td class="caret-cell">${caret}</td>
    <td class="mono">${esc(v.id.slice(0, 8))}</td>
    <td>${esc(v.project)}</td>
    <td class="num">${esc(fmtCost(v.cost, currency))}</td>
    <td class="num">${esc(fmtTokens(v.cost.tokens))}</td>
    <td class="num dim">${esc(fmtTimeAgo(v.lastActivity, now))}</td>
  </tr>`;
  if (!hasMates) return main;
  const mates = v.teammates
    .map(
      (t) => `<tr class="mate" data-parent="${i}">
      <td></td>
      <td class="mono dim">${esc(t.id.slice(0, 8))}</td>
      <td class="label" colspan="1">${esc(t.label.slice(0, 80))}</td>
      <td class="num">${esc(fmtCost(t.cost, currency))}</td>
      <td class="num">${esc(fmtTokens(t.cost.tokens))}</td>
      <td></td>
    </tr>`,
    )
    .join("");
  return main + mates;
}

function chart(series: DayPoint[], currency: string): string {
  const w = 720;
  const h = 140;
  const pad = 24;
  const max = Math.max(0.0001, ...series.map((d) => d.cost));
  const bw = series.length ? (w - pad * 2) / series.length : 0;
  const bars = series
    .map((d, i) => {
      const bh = (d.cost / max) * (h - pad * 2);
      const x = pad + i * bw;
      const y = h - pad - bh;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 3).toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" rx="2"><title>${esc(d.date)}: ${esc(fmtUsd(d.cost, currency))}</title></rect>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="bars" preserveAspectRatio="none">${bars}</svg>`;
}

const CSS = `
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--dim:#8b949e;--accent:#3fb950}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px}
header{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:20px}
h1{font-size:20px;margin:0}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:0 0 10px}
.generated{color:var(--dim);font-size:12px}
.warn{background:#3d2d00;border:1px solid #6b5200;color:#f0d98a;padding:8px 12px;border-radius:8px;margin-bottom:16px;font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
.kpi-label{color:var(--dim);font-size:12px}.kpi-value{font-size:24px;font-weight:600;margin:4px 0}.kpi-sub{color:var(--dim);font-size:12px}
section{margin-bottom:24px}
.bars{width:100%;height:140px;background:var(--panel);border:1px solid var(--line);border-radius:10px}
.bars rect{fill:var(--accent);opacity:.85}.bars rect:hover{opacity:1}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--line)}
th{color:var(--dim);font-weight:500;font-size:12px}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dim{color:var(--dim)}
.expandable{cursor:pointer}.expandable:hover{background:#1c2128}
.caret-cell{width:24px;color:var(--dim)}.caret{display:inline-block;transition:transform .12s}
.session.open .caret{transform:rotate(90deg)}
.mate{display:none;background:#0f141a}.mate.show{display:table-row}
.mate .label{color:var(--dim)}
.empty{text-align:center;color:var(--dim);padding:24px}
`;

const JS = `
document.querySelectorAll('tr.expandable').forEach(function(row){
  row.addEventListener('click',function(){
    var i=row.getAttribute('data-row');
    row.classList.toggle('open');
    document.querySelectorAll('tr.mate[data-parent="'+i+'"]').forEach(function(m){m.classList.toggle('show');});
  });
});
`;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
