import {
  type AccountSection,
  type DayPoint,
  type TeammateTotal,
  type TreeNode,
  type WindowTotals,
} from "./aggregate.js";
import { fmtCost, fmtTimeAgo, fmtTokens, fmtUsd } from "./format.js";

export interface ReportData {
  generatedAt: number;
  currency: string;
  /** GLOBAL window totals — the only multi-account numbers in the report. */
  totals: WindowTotals;
  /** one self-contained section per Claude account, highest-cost first */
  accounts: AccountSection[];
  warnings: string[];
}

/** Render a self-contained HTML cost dashboard (inline CSS + JS). */
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

  const warnHtml = data.warnings.length
    ? `<div class="warn">⚠ ${data.warnings.map(esc).join(" · ")}</div>`
    : "";

  const body = data.accounts.length
    ? `<div class="acc-tabs" role="tablist">${data.accounts
        .map((a, i) => accountTab(a, currency, i === 0))
        .join("")}</div>
      ${data.accounts.map((a, i) => accountPanel(a, currency, data.generatedAt, i === 0)).join("")}`
    : `<div class="acc-panel"><div class="empty">No sessions found.</div></div>`;

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
<section class="global">
  <div class="global-label">All accounts</div>
  <div class="kpis">${kpiHtml}</div>
</section>
${body}
<script>${JS}</script>
</body>
</html>`;
}

/** A pill in the account selector — name + this account's all-time total. */
function accountTab(a: AccountSection, currency: string, active: boolean): string {
  return `<button class="acc-tab${active ? " active" : ""}" role="tab" data-acc-tab="${esc(a.label)}">
    <span class="acc-tab-name">${esc(a.label)}</span>
    <span class="acc-tab-total">${esc(fmtCost(a.total, currency))}</span>
  </button>`;
}

/** The full panel for one account: leaderboard + chart, then the breakdown tree. */
function accountPanel(
  a: AccountSection,
  currency: string,
  now: number,
  active: boolean,
): string {
  const board = a.leaderboard.length
    ? leaderboard(a.leaderboard.slice(0, 14), currency)
    : `<div class="empty small">No named teammates.</div>`;

  const treeHtml = a.tree.children.length
    ? a.tree.children.map((n) => treeNode(n, currency, now)).join("")
    : `<div class="empty small">No sessions.</div>`;

  const tmCount = a.leaderboard.length;
  const meta = [
    `${a.sessions} session${a.sessions === 1 ? "" : "s"}`,
    tmCount ? `${tmCount} teammate${tmCount === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return `<section class="acc-panel${active ? "" : " hidden"}" role="tabpanel" data-acc-panel="${esc(a.label)}">
  <div class="acc-head"><strong>${esc(a.label)}</strong> · ${esc(meta)}</div>
  <div class="acc-cols">
    <div class="col">
      <h3>Cost by teammate</h3>
      ${board}
    </div>
    <div class="col">
      <h3>Daily spend</h3>
      ${chart(a.series, currency)}
    </div>
  </div>
  <div class="breakdown">
    <h3>Breakdown <span class="hint">— workspace → session → teammate; click to expand</span></h3>
    ${filterBar(a)}
    <div class="tree">${treeHtml}</div>
  </div>
</section>`;
}

function leaderboard(items: TeammateTotal[], currency: string): string {
  const max = Math.max(0.0001, ...items.map((t) => t.cost.cost));
  return `<div class="board-list">${items
    .map((t) => {
      const pct = (t.cost.cost / max) * 100;
      const sub = t.sessions > 1 ? ` <span class="dim">×${t.sessions}</span>` : "";
      return `<div class="bk">
        <div class="bk-label"><span class="bk-name">${esc(t.name)}</span>${sub}</div>
        <div class="bk-bar"><span style="width:${pct.toFixed(1)}%"></span></div>
        <div class="bk-num">${esc(fmtCost(t.cost, currency))}</div>
        <div class="bk-num dim">${esc(fmtTokens(t.cost.tokens))}</div>
      </div>`;
    })
    .join("")}</div>`;
}

/** In-account filters: one chip per workspace + a session search box. */
function filterBar(a: AccountSection): string {
  const chips = a.workspaces
    .map(
      (n) =>
        `<label class="chip"><input type="checkbox" checked data-filter="workspace" value="${esc(
          n,
        )}" /> ${esc(n)}</label>`,
    )
    .join("");
  return `<div class="filters">
    <div class="filter-group"><span class="fg-label">Workspace</span>${chips}</div>
    <input class="search" type="search" placeholder="search session…" data-filter="search" />
  </div>`;
}

function treeNode(n: TreeNode, currency: string, now: number): string {
  const hasKids = n.children.length > 0;
  const caret = hasKids ? `<span class="caret">▸</span>` : `<span class="caret-spacer"></span>`;
  const attrs =
    n.level === "workspace"
      ? ` data-workspace="${esc(n.label)}"`
      : n.level === "session"
        ? ` data-session="${esc(n.label)}"`
        : "";
  const kids = hasKids
    ? `<div class="tnode-children">${n.children
        .map((child) => treeNode(child, currency, now))
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
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--dim:#8b949e;--accent:#3fb950;--lead:#d29922}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px;max-width:960px;margin:0 auto}
header{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:20px}
h1{font-size:20px;margin:0}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:0 0 10px}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:0 0 8px;font-weight:600}
h3 .hint{text-transform:none;letter-spacing:0;font-weight:400}
.generated{color:var(--dim);font-size:12px}
.warn{background:#3d2d00;border:1px solid #6b5200;color:#f0d98a;padding:8px 12px;border-radius:8px;margin-bottom:16px;font-size:13px}
.global{margin-bottom:20px}
.global-label{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
.kpi-label{color:var(--dim);font-size:12px}.kpi-value{font-size:24px;font-weight:600;margin:4px 0}.kpi-sub{color:var(--dim);font-size:12px}
.acc-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.acc-tab{display:inline-flex;align-items:baseline;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:7px 15px;cursor:pointer;color:var(--fg);font:inherit}
.acc-tab:hover{border-color:var(--dim)}
.acc-tab-name{font-weight:600}
.acc-tab-total{color:var(--dim);font-size:12px;font-variant-numeric:tabular-nums}
.acc-tab.active{border-color:var(--accent);background:#13251a}
.acc-tab.active .acc-tab-total{color:var(--fg)}
.acc-panel{border:1px solid var(--line);border-radius:12px;padding:16px;background:#11151b}
.acc-panel.hidden{display:none}
.acc-head{color:var(--dim);font-size:12px;margin-bottom:16px}
.acc-head strong{color:var(--fg);font-size:14px}
.acc-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
.col{min-width:0}
@media (max-width:720px){.acc-cols{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr)}}
.board-list{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 14px}
.bk{display:grid;grid-template-columns:minmax(90px,1fr) 1.2fr 70px;align-items:center;gap:10px;padding:5px 0}
.bk-label{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.bk-name{font-weight:600}
.bk-bar{height:8px;background:#0d1117;border-radius:5px;overflow:hidden}
.bk-bar span{display:block;height:100%;background:var(--accent);border-radius:5px}
.bk-num{text-align:right;font-variant-numeric:tabular-nums}
.bk-num.dim{display:none}
.bars{width:100%;height:140px;background:var(--panel);border:1px solid var(--line);border-radius:10px}
.bars rect{fill:var(--accent);opacity:.85}.bars rect:hover{opacity:1}
.dim{color:var(--dim)}
.empty{text-align:center;color:var(--dim);padding:24px}
.empty.small{padding:14px;font-size:13px}
.breakdown{margin-top:4px}
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
.level-workspace>.tnode-row .tnode-label{color:#79c0ff;font-weight:600}
.tnode-cost,.tnode-tokens,.tnode-when{text-align:right;font-variant-numeric:tabular-nums}
.caret{display:inline-block;transition:transform .12s;color:var(--dim)}
.caret-spacer{display:inline-block;width:1em}
.tnode.open>.tnode-row .caret{transform:rotate(90deg)}
.tnode.hidden{display:none}
`;

const JS = `
(function(){
  var tabs = document.querySelectorAll('[data-acc-tab]');
  var panels = document.querySelectorAll('[data-acc-panel]');

  function showAccount(label){
    tabs.forEach(function(t){ t.classList.toggle('active', t.getAttribute('data-acc-tab') === label); });
    panels.forEach(function(p){ p.classList.toggle('hidden', p.getAttribute('data-acc-panel') !== label); });
  }
  tabs.forEach(function(t){
    t.addEventListener('click', function(){ showAccount(t.getAttribute('data-acc-tab')); });
  });

  document.querySelectorAll('.tnode-row.expandable').forEach(function(row){
    row.addEventListener('click', function(){ row.parentElement.classList.toggle('open'); });
  });

  // Each account panel filters its own tree — no cross-account state.
  panels.forEach(function(panel){
    function checkedWs(){
      var set = {};
      panel.querySelectorAll('input[data-filter="workspace"]').forEach(function(cb){
        if(cb.checked) set[cb.value] = true;
      });
      return set;
    }
    function term(){
      var el = panel.querySelector('input[data-filter="search"]');
      return (el && el.value ? el.value : '').toLowerCase();
    }
    function apply(){
      var wss = checkedWs();
      var t = term();
      panel.querySelectorAll('.tnode.level-workspace').forEach(function(ws){
        var wsName = ws.getAttribute('data-workspace');
        var wsOn = !!wss[wsName];
        var anyVisible = false;
        ws.querySelectorAll('.tnode.level-session').forEach(function(se){
          var label = (se.getAttribute('data-session') || '').toLowerCase();
          var on = wsOn && (!t || label.indexOf(t) >= 0);
          se.classList.toggle('hidden', !on);
          if(on) anyVisible = true;
        });
        ws.classList.toggle('hidden', !anyVisible);
      });
    }
    panel.querySelectorAll('input[data-filter]').forEach(function(el){
      el.addEventListener('input', apply);
      el.addEventListener('change', apply);
    });
  });

  // Workspaces expanded by default so sessions are visible at a glance.
  document.querySelectorAll('.tnode.level-workspace').forEach(function(w){ w.classList.add('open'); });
})();
`;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
