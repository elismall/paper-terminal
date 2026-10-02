// Paper Terminal front end, part 3e: the News tab (v0.10.0). Market Brief · 24h, every free source merged (Benzinga, SEC 8-K,
// GlobeNewswire, PR Newswire, Federal Reserve), source filters, the "does news help the bot?" scorecard, and (v0.11.0) the
// economic calendar the bot checks before a stock entry (CPI, jobs report, Fed decision = half size in gate mode).
// Classic script; loads after js/1-core.js and js/2-views.js and replaces newsList() for the full News tab only.
SCHED.news = 3e4; SCHED.brief = 6e5;
NEED.news = ['news', 'brief', 'performance'];
// briefOpen: the Market Brief dropdown (remembered on this device); rows: which brief rows are expanded into their detail card.
const NW = { src: 'all', seen: null, fresh: new Set(), briefOpen: LS.get('briefOpen', false), rows: new Set() };
(() => { const st = document.createElement('style'); st.textContent = `
.nwbar{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--line)}
.nwchips{display:flex;flex-wrap:wrap;gap:4px}.nwchips button{background:#151515;border:1px solid var(--line2);color:var(--ink2);padding:2px 9px;font:600 12px var(--mono)}
.nwchips button[aria-pressed=true]{background:var(--amber);border-color:var(--amber);color:#000}
.nwsrc{font:11.5px var(--mono);color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 10px}.nwsrc .bad{color:var(--down)}
.brief{border-bottom:1px solid var(--line)}
.bhead{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;width:100%;background:none;border:0;color:var(--ink);padding:9px 10px;text-align:left;cursor:pointer}
.bhead:hover{background:#121212}.bhead .chev{color:var(--amber);font:700 13px var(--mono);width:12px}
.bhead b{font:800 15px var(--disp);letter-spacing:.02em;color:var(--amber)}.bhead .bsum{font:12.5px var(--mono);color:var(--ink2)}
.bbody{padding:0 10px 10px}
.brief .lead{margin:0 0 10px;color:var(--ink2);font:500 13.5px var(--sans);max-width:1100px}
.bgrp{margin:0 0 10px}.bgrp .sub{margin:0 0 2px}
.blist2{list-style:none;margin:0;padding:0;border-top:1px solid #1c1c1c}
.brow{border-bottom:1px solid #1c1c1c}
.bline{display:grid;grid-template-columns:64px 72px 84px 62px minmax(0,236px) minmax(0,1fr) 14px;gap:8px;align-items:center;width:100%;background:none;border:0;color:var(--ink);padding:5px 4px;text-align:left;font:12.5px var(--mono);cursor:pointer}
.bline:hover,.brow.on>.bline{background:#141414}
.bline .sy{color:var(--orange);font-weight:800}.bline .px,.bline .n{color:var(--ink2)}.bline .chev{color:var(--muted)}
.bline .tg{display:flex;gap:3px;overflow:hidden;white-space:nowrap}
.bline .rd{font:500 12.5px var(--sans);color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brow .bcard{margin:2px 0 8px}
.bcard{background:var(--panel2);border:1px solid var(--line);padding:8px 10px;display:grid;gap:5px;min-width:0}
.bcard header{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;position:static;background:none;padding:0}
.bcard header .sy{background:none;border:0;padding:0;color:var(--orange);font:800 16px var(--mono)}
.bcard .mv{font:700 14px var(--mono)}.bcard .meta{font:11.5px var(--mono);color:var(--muted)}
.bcard .tags{display:flex;flex-wrap:wrap;gap:3px}.bcard .read{margin:0;color:var(--ink);font:500 13px var(--sans)}
.bcard .jv{font:12px var(--mono);color:var(--ink2);border-left:2px solid var(--s1);padding-left:6px}
.bcard ul{margin:0;padding:0;list-style:none;display:grid;gap:3px}.bcard li a{color:#ddd;text-decoration:none;font:500 12.5px var(--sans);overflow-wrap:anywhere}.bcard li a:hover{color:var(--amber)}
.bmacro{margin-top:10px;display:grid;gap:3px}.bmacro a{color:#ddd;text-decoration:none;font:500 13px var(--sans)}.bmacro a:hover{color:var(--amber)}
.bcal{display:flex;flex-wrap:wrap;gap:4px 12px;margin:0 0 10px;font:12.5px var(--mono);color:var(--ink2)}.bcal .top{color:var(--amber);font-weight:700}
.nsc{padding:8px 10px;border-bottom:1px solid var(--line)}.nsc table{width:100%;border-collapse:collapse;font:12.5px var(--mono)}.nsc td,.nsc th{padding:3px 6px;text-align:right;border-bottom:1px solid #151515}.nsc td:first-child,.nsc th:first-child{text-align:left}
.news li.nwnew{box-shadow:inset 3px 0 0 var(--amber)}
.ntag{display:inline-block;font:700 10px var(--mono);padding:0 4px;background:#2e2e2e;color:#ddd}.ntag.pos{background:var(--upblk);color:#fff}.ntag.neg{background:var(--dnblk);color:#fff}
@media (max-width:640px){.nwbar{flex-direction:column;align-items:flex-start}.bcard header .sy{font-size:15px}.bline{grid-template-columns:54px 66px minmax(0,1fr) 14px}.bhead .bx{display:none}.bline .px,.bline .n,.bline .rd{display:none}}`; document.head.appendChild(st); })();
const NW_SRC = [['all', 'All'], ['news', 'Benzinga'], ['8k', 'SEC 8-K'], ['pr', 'Press releases'], ['fed', 'Fed']];
const NW_POS = new Set(['beat', 'upgrade', 'buyback']), NW_NEG = new Set(['miss', 'downgrade', 'offering', 'legal', 'bankrupt', 'restatement', 'layoffs', 'impairment', 'auditor']);
const NW_LBL = { beat: 'BEAT/RAISE', miss: 'MISS/CUT', earnings: 'EARNINGS', upgrade: 'UPGRADE', downgrade: 'DOWNGRADE', offering: 'OFFERING', mna: 'M&A', buyback: 'BUYBACK', dividend: 'DIVIDEND', fda: 'FDA', legal: 'LEGAL', exec: 'EXEC', bankrupt: 'BANKRUPTCY', layoffs: 'LAYOFFS', macro: 'MACRO', restatement: 'RESTATEMENT', agreement: 'AGREEMENT', auditor: 'AUDITOR', impairment: 'IMPAIRMENT', regfd: 'UPDATE', other: 'EVENT' };
const nwTag = (k) => `<span class="ntag ${NW_POS.has(k) ? 'pos' : NW_NEG.has(k) ? 'neg' : ''}">${esc(NW_LBL[k] || String(k).toUpperCase())}</span>`;
const nwPct = (v) => v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%';
const calDay = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
function calView(C) {
  if (!C) return '';
  const ev = C.events || [];
  return `<div class="bcal"><b class="amber">Economic calendar</b> ${ev.length ? ev.map(e => `<span class="${e.top ? 'top' : ''}">${esc(e.name)} ${calDay(e.d)} ${esc(e.time)}</span>`).join('') : '<span>No major US releases in the next 10 days.</span>'}${C.error ? `<span class="muted">(${esc(C.error)})</span>` : ''}<span class="muted">Bold = the bot treats that day and the day before as a half-size day.</span></div>`;
}
// Market Brief · last 24 h: a dropdown (closed by default) with a one-line summary. Inside: Top Gainers and Top Decliners as
// compact rows; clicking a row opens that stock's full card (read, Jev, headlines) right under it.
const nwJev = (j) => j ? `<div class="jv">Jev: impact ${j.impact ?? '—'}/3 · ${j.dir === 'up' ? '<span class="up">likely higher</span>' : j.dir === 'down' ? '<span class="down">likely lower</span>' : 'direction unclear'}${j.dirConf != null ? ` (${Math.round(j.dirConf * 100)}%)` : ''} · priced in ${j.priced != null ? Math.round(j.priced * 100) + '%' : '—'} · event risk ${j.risk != null ? Math.round(j.risk * 100) + '%' : '—'}</div>` : '';
const briefCard = (m) => `<article class="bcard"><header><button class="sy" data-sym="${esc(m.s)}" title="Open ${esc(m.s)} chart">${esc(m.s)}</button><b class="mv ${cls(m.move)}">${nwPct(m.move)}</b><span class="meta">${fp(m.px)} · ${m.n} item${m.n === 1 ? '' : 's'}${m.relVol != null ? ` · vol ${m.relVol}× prior day` : ''}</span></header>
    ${m.cats.length ? `<div class="tags">${m.cats.map(c => `<span class="ntag">${esc(c.toUpperCase())}</span>`).join('')}</div>` : ''}<p class="read">${esc(m.read)}</p>${nwJev(m.jev)}
    <ul>${m.heads.map(h => `<li><a href="${safeUrl(h.url)}" target="_blank" rel="noopener noreferrer">${esc(h.h)}</a> <span class="meta">${esc(h.src)} · ${ago(h.t)}</span></li>`).join('')}</ul></article>`;
const briefRow = (m) => { const on = NW.rows.has(m.s);
  return `<li class="brow${on ? ' on' : ''}"><button class="bline" data-brow="${esc(m.s)}" aria-expanded="${on}"><b class="sy">${esc(m.s)}</b><b class="${cls(m.move)}">${nwPct(m.move)}</b><span class="px">${fp(m.px)}</span><span class="n">${m.n} item${m.n === 1 ? '' : 's'}</span><span class="tg">${m.cats.slice(0, 2).map(c => `<span class="ntag">${esc(c.toUpperCase())}</span>`).join('')}</span><span class="rd">${esc(m.read)}</span><span class="chev">${on ? '▾' : '▸'}</span></button>${on ? briefCard(m) : ''}</li>`; };
function briefView(B) {
  const ok = B && !B.error, up = ok ? B.movers.filter(m => m.move > 0).sort((a, z) => z.move - a.move) : [], dn = ok ? B.movers.filter(m => m.move < 0).sort((a, z) => a.move - z.move) : [], flat = ok ? B.movers.filter(m => !m.move) : [];
  const next = ok ? (B.calendar?.events || []).find(e => e.top) : null;
  const sum = !B ? 'loading…' : B.error ? 'unavailable right now' : `${up.length} gainer${up.length === 1 ? '' : 's'} · ${dn.length} decliner${dn.length === 1 ? '' : 's'}<span class="bx">${up[0] ? ` · best ${esc(up[0].s)} ${nwPct(up[0].move)}` : ''}${dn[0] ? ` · worst ${esc(dn[0].s)} ${nwPct(dn[0].move)}` : ''}${next ? ` · next: ${esc(next.name)} ${calDay(next.d)}` : ''}</span>`;
  const head = `<button class="bhead" data-brief="toggle" aria-expanded="${NW.briefOpen}"><span class="chev">${NW.briefOpen ? '▾' : '▸'}</span><b>MARKET BRIEF · LAST 24H</b><span class="bsum">${!B || B.error ? esc(sum) : sum}</span></button>`;
  if (!NW.briefOpen) return `<section class="brief" aria-label="Market Brief">${head}</section>`;
  if (!ok) return `<section class="brief" aria-label="Market Brief">${head}<div class="bbody">${B ? msg(B) : loading}</div></section>`;
  const grp = (title, list, c) => list.length ? `<div class="bgrp"><div class="sub ${c}">${title} · ${list.length}</div><ul class="blist2">${list.map(briefRow).join('')}</ul></div>` : '';
  return `<section class="brief" aria-label="Market Brief">${head}<div class="bbody"><p class="lead">${esc(B.lead)}</p>${calView(B.calendar)}
    ${B.movers.length ? grp('Top Gainers', up, 'up') + grp('Top Decliners', dn, 'down') + grp('Little change', flat, 'muted') : '<div class="empty">No stock news with price data in the last 24 hours.</div>'}
    ${B.macro?.length ? `<div class="bmacro"><div class="sub amber">Macro and Fed</div>${B.macro.map(x => `<div><a href="${safeUrl(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.h)}</a> <span class="muted num" style="font-size:11.5px">${esc(x.src)} · ${ago(x.t)}</span></div>`).join('')}</div>` : ''}
    <div class="muted num" style="font-size:11.5px;margin-top:8px">Click a row for the full read and headlines. Ranked by headline count, price reaction and catalyst type. Reads are rule-based tendencies, not predictions${B.jev === 'off' ? '' : '; Jev reads the top 6'}. Updated <span data-ago="${esc(B.at)}">${ago(B.at)}</span> · refreshes every 10 min.</div></div></section>`;
}
function newsScoreView(P) {
  const N = P && !P.error ? P.news : null; if (!N) return '';
  if (!N.n) return `<div class="nsc muted" style="font-size:12.5px"><b class="amber">Does news help the bot?</b> Mode: ${esc(N.mode)}. Every new stock trade now records what the news rule and Jev thought at entry; this table fills in as those trades close (worth acting on after 30+).</div>`;
  const row = (b) => `<tr><td>${esc(b.label)}</td><td>${b.n}</td><td>${nf(b.win, 1, '%')}</td><td class="${cls(b.avg)}">${b.n ? f$(b.avg) : '—'}</td><td class="${cls(b.realized)}">${f$(b.realized || 0)}</td></tr>`;
  return `<div class="nsc"><b class="amber" style="font-size:12.5px">Does news help the bot?</b> <span class="muted" style="font-size:12px">mode ${esc(N.mode)} · ${N.n} closed stock trades with a news tag</span>
    <div class="scroll"><table><thead><tr><th>At entry</th><th>Closed</th><th>Win</th><th>Avg P&amp;L</th><th>Total</th></tr></thead><tbody>${[...N.buckets, ...N.jev].map(row).join('')}</tbody></table></div></div>`;
}
const _newsListBase = newsList;
newsList = function (j, n, bar = true) {
  if (n !== 0 || !bar) return _newsListBase(j, n, bar);                  // Home "Top News" and the detail drawer keep the simple list
  if (!j) return briefView(state.brief) + loading; if (j.error) return briefView(state.brief) + msg(j);
  const all = (j.items || []).filter(x => !x.noise), ads = (j.items || []).length - all.length;
  if (NW.seen == null) NW.seen = new Set(all.map(x => x.id)); else for (const x of all) if (!NW.seen.has(x.id)) { NW.seen.add(x.id); NW.fresh.add(x.id); }
  const items = NW.src === 'all' ? all : all.filter(x => (x.kind || 'news') === NW.src);
  const srcs = (j.sources || []).map(s => `<span class="${s.error ? 'bad' : ''}" title="${esc(s.error || '')}">${esc(s.src)} ${s.error ? 'unavailable' : s.n}</span>`).join('');
  const bar2 = `<div class="nwbar"><div class="nwchips" role="group" aria-label="Source">${NW_SRC.map(([k, l]) => `<button data-nwsrc="${k}" aria-pressed="${NW.src === k}">${l}</button>`).join('')}</div>
    <div class="nwsrc">${srcs}<span>refresh every 30 s · updated <span data-ago="${esc(j.at)}">${ago(j.at)}</span>${ads ? ` · ${ads} law-firm ads hidden` : ''}</span></div><button class="btn" data-act="news-refresh">Refresh news</button></div>`;
  const li = (x) => `<li class="${NW.fresh.has(x.id) ? 'nwnew' : ''}"><a href="${safeUrl(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.h)}</a><div class="m"><span>${ago(x.t)}</span><span>${esc(x.src)}</span>${(x.cats || []).filter(c => c !== 'lawfirm').slice(0, 4).map(nwTag).join('')}${(x.syms || []).map(s => `<button data-sym="${esc(s)}">${esc(s)}</button>`).join('')}</div>${x.sum ? `<p>${esc(x.sum)}</p>` : ''}</li>`;
  return briefView(state.brief) + newsScoreView(state.performance) + bar2 + `<ul class="news">${items.map(li).join('') || '<li class="muted">No headlines from this source right now.</li>'}</ul>`;
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-nwsrc]'); if (b) { NW.src = b.dataset.nwsrc; render(); return; }
  if (e.target.closest('[data-brief="toggle"]')) { NW.briefOpen = !NW.briefOpen; LS.set('briefOpen', NW.briefOpen); render(); return; }
  const r = e.target.closest('[data-brow]'); if (r) { const k = r.dataset.brow; NW.rows.has(k) ? NW.rows.delete(k) : NW.rows.add(k); render(); }
});
