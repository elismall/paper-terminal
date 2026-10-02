// Paper Terminal front end, part 3f: daily scoreboard history on the Benchmark tab (v0.10.0; bull-run core column v0.11.0). One dated row per day, saved by the
// evening crypto run (lib/history.js). "Copy as Markdown" gives the same table docs/RESULTS-LOG.md keeps in the repo.
SCHED.history = 3e5; NEED.perf.push('history');
const HS = { busy: false, note: '' };
function historyView(H) {
  if (!H) return `<div class="pb">${loading}</div>`; if (H.error) return `<div class="pb">${msg(H)}</div>`;
  const c = (s) => !s || !s.n ? '<span class="muted">0</span>' : `${s.n} · <span class="${cls(s.pnl)}">${f$(s.pnl)}</span>`;
  const rows = [...(H.days || [])].reverse().slice(0, 60).map(x => `<tr><td>${esc(x.d)}</td><td>${f$(x.equity)}</td><td class="${cls(x.dayPnl)}">${f$(x.dayPnl)} <span class="muted">${x.dayPct == null ? '' : fpct(x.dayPct)}</span></td>
    <td>${x.open.stock} / ${x.open.dcaCrypto} / ${x.open.dcaMeme} / ${x.open.dcaEtf} / ${x.open.cryptoCore ?? 0}</td><td class="${cls(x.open.openPnl)}">${f$(x.open.openPnl)}</td><td>${c(x.closedToday.swing)}</td><td>${c(x.closedToday.dca)}</td><td>${c(x.closedToday.dcaMeme)}</td><td class="l muted" style="white-space:normal;min-width:180px">${esc(x.settings?.dcaCrypto?.text || '')}</td></tr>`).join('');
  return `<div class="botrow" style="gap:8px;flex-wrap:wrap"><button class="btn" data-hist="save" ${HS.busy ? 'disabled' : ''}>${HS.busy ? 'Saving…' : 'Save today’s snapshot now'}</button><button class="btn" data-hist="copy">Copy as Markdown</button><button class="btn" data-hist="dl">Download .md</button><span class="muted" style="font-size:12px">${esc(HS.note)}</span></div>
    ${rows ? `<div class="scroll"><table><thead><tr><th>Day (ET)</th><th>Equity</th><th>Day P&amp;L</th><th>Open: stock / DCA crypto / meme / ETF / bull core</th><th>Open P&amp;L</th><th>Swing closed</th><th>DCA closed</th><th>…meme</th><th class="l">DCA crypto settings that day</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="empty">No daily snapshots yet. The evening crypto run (about 7 pm ET) saves one each day, or press Save.</div>'}`;
}
const _perfViewBase = perfView;
perfView = function () { const v = _perfViewBase(); v.notes += `<div class="sub amber" style="padding:8px 10px 0">Daily scoreboard history</div>${historyView(state.history)}`; return v; };
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-hist]'); if (!b) return; const k = b.dataset.hist, md = state.history?.md || '';
  if (k === 'save') { HS.busy = true; HS.note = ''; render(); const j = await api('history', { save: '1' }).catch(x => ({ error: 'network', message: x.message })); HS.busy = false; if (!j.error) state.history = j; HS.note = j.error ? (j.message || j.error) : 'Saved.'; render(); return; }
  if (k === 'copy') { try { await navigator.clipboard.writeText(md); HS.note = 'Copied.'; } catch { HS.note = 'Copy blocked by the browser: use Download.'; } render(); return; }
  if (k === 'dl') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`# PAPER TERMINAL daily results\n\n${md}`], { type: 'text/markdown' })); a.download = `eli-terminal-results-${new Date().toISOString().slice(0, 10)}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
});
