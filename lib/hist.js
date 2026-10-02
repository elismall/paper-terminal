// v0.12.2: crypto price history kept in the Blob store (hist/crypto-<timeframe>.json, public store, prices only), so the daily DCA
// training and the weekly lab don't re-download years of candles every run. Alpaca's crypto pages hold only ~10,000 one-minute
// bars' worth (a year of hourly candles is ~50 pages per coin) and the free plan allows 200 requests a minute, so a full download
// takes longer than one run. Each run: read the file, fetch the new candles for every coin, then fill older history backwards in
// chunks (the coin missing the most first) until the time budget runs out, and save once. Coverage says how far back each coin is.
import { barRange } from './core.js';
import { blobBase, blobUrl, blobPut, blobGet } from './notify.js';

const MIN = 6e4, DAY = 864e5;
// keep = days kept per file; chunk = days fetched per backfill step (a few pages each).
export const HIST = { keep: { '1Hour': 400, '4Hour': 1500, '1Day': 1830 }, chunk: { '1Hour': 30, '4Hour': 60, '1Day': 1000 }, conc: 4 };
export const histKey = (tf) => `hist/crypto-${tf}.json`;
export const HIST_STATUS = 'hist/status.json';
export const statusKey = (tf, days) => `${tf}-${days}d`; // one status entry per file and window (training and lab use different daily windows)
const p7 = (x) => +(+x).toPrecision(7);
const short = (e) => String(e?.message || e).slice(0, 160);

// Stored per coin: { from (ms: complete back to here), floor (true: nothing older exists), t0 (minutes), dt (minute gaps), o, h, l, c }
function decode(e) {
  const r = { t: [], o: [], h: [], l: [], c: [], from: e?.from ?? null, floor: !!e?.floor };
  if (!e?.dt) return r;
  let m = e.t0; for (const d of e.dt) { m += d; r.t.push(m * MIN); }
  r.o = e.o.slice(); r.h = e.h.slice(); r.l = e.l.slice(); r.c = e.c.slice();
  return r;
}
function encode(r) {
  const dt = []; let prev = r.t.length ? Math.round(r.t[0] / MIN) : 0; const t0 = prev;
  for (const ms of r.t) { const m = Math.round(ms / MIN); dt.push(m - prev); prev = m; }
  return { from: r.from, ...(r.floor ? { floor: true } : {}), t0, dt, o: r.o.map(p7), h: r.h.map(p7), l: r.l.map(p7), c: r.c.map(p7) };
}
// New candles replace stored ones in the same time span (the last stored candle may have been still forming).
function merge(r, bars) {
  if (!bars.length) return;
  const nb = bars.map(b => [Date.parse(b.t), +b.o, +b.h, +b.l, +b.c]).sort((a, z) => a[0] - z[0]), lo = nb[0][0], hi = nb.at(-1)[0];
  const all = r.t.map((t, i) => [t, r.o[i], r.h[i], r.l[i], r.c[i]]).filter(x => x[0] < lo || x[0] > hi).concat(nb).sort((a, z) => a[0] - z[0]);
  r.t = all.map(x => x[0]); r.o = all.map(x => x[1]); r.h = all.map(x => x[2]); r.l = all.map(x => x[3]); r.c = all.map(x => x[4]);
}
// Two stored copies of one coin (this run's + one saved meanwhile): every candle from both (this run's wins a tie), complete back
// to the older start; `floor` (nothing older exists) comes from whichever copy reaches further back.
function union(a, b) {
  if (!b.t.length && b.from == null) return a;
  const r = { t: b.t.slice(), o: b.o.slice(), h: b.h.slice(), l: b.l.slice(), c: b.c.slice(), from: b.from, floor: b.floor };
  merge(r, a.t.map((t, i) => ({ t: new Date(t).toISOString(), o: a.o[i], h: a.h[i], l: a.l[i], c: a.c[i] })));
  // merge() replaces b's candles inside a's time span with a's, which is right: both are the same exchange data
  const fa = a.from ?? Infinity, fb = b.from ?? Infinity;
  r.from = Math.min(fa, fb) === Infinity ? null : Math.min(fa, fb); r.floor = fa <= fb ? !!a.floor : !!b.floor;
  return r;
}
const covered = (r, win) => r.from != null && (r.floor || r.from <= win);

// A read error must not be mistaken for "no file yet" (saving would then wipe the downloaded history).
async function readFile(tf) {
  if (!blobBase()) return { ok: false, j: null, why: 'no Blob store' };
  try {
    const r = await fetch(`${blobUrl(histKey(tf))}?v=${Date.now()}`, { cache: 'no-store' });
    if (r.status === 404) return { ok: true, j: null };
    if (!r.ok) return { ok: false, j: null, why: `read failed (${r.status})` };
    return { ok: true, j: await r.json() };
  } catch (e) { return { ok: false, j: null, why: short(e) }; }
}

// Returns { data: {SYM: [{t,o,h,l,c}]} (the last `days` only), cov: [per coin], complete, saved, ms, readError }.
export async function histBars(symbols, { timeframe = '1Hour', days = 365, budgetMs = 90e3, save = true, writeStatus = true } = {}) {
  const t00 = Date.now(), now = t00, deadline = t00 + budgetMs, win = now - days * DAY, chunk = (HIST.chunk[timeframe] || 30) * DAY;
  const keepFrom = now - Math.max(HIST.keep[timeframe] || 400, days + 5) * DAY;
  const F = await readFile(timeframe), coins = F.j?.coins || {}, st = {};
  for (const s of symbols) { const r = decode(coins[s]); st[s] = { r, pages: 0, cached: r.t.length, fetched: 0, error: null, busy: false }; }
  let changed = false, progress = !F.j; // progress = older history or a new coin was added (worth a save); new candles alone are cheap to re-fetch
  const pool = async (fn) => { const q = [...symbols]; await Promise.all(Array.from({ length: Math.min(HIST.conc, q.length) }, async () => { while (q.length) await fn(q.shift()); })); };
  // 1) new candles for every coin: from its last stored candle to now, or the most recent chunk for a coin not stored yet
  await pool(async (s) => {
    const S = st[s], r = S.r, start = r.t.length ? r.t.at(-1) : Math.max(win, now - chunk);
    try {
      const x = await barRange(s, { timeframe, start, deadline: r.t.length ? deadline + 60e3 : deadline, minPages: 1 }); // a coin not stored yet gets one page, then obeys the budget (a cut-off first chunk is still contiguous: the next run continues from its last candle)
      S.pages += x.pages; S.fetched += x.bars.length;
      if (x.bars.length) { merge(r, x.bars); changed = true; }
      if (r.from == null) { r.from = start; changed = true; progress = true; }
    } catch (e) { S.error = short(e); }
  });
  // 2) older history, one chunk at a time, the coin missing the most first, until every coin reaches the window start or time is up
  const next = () => symbols.filter(s => !st[s].error && !st[s].busy && !covered(st[s].r, win)).sort((a, z) => st[z].r.from - st[a].r.from)[0];
  await Promise.all(Array.from({ length: HIST.conc }, async () => {
    for (;;) {
      if (Date.now() > deadline) return;
      const s = next(); if (!s) return;
      const S = st[s], r = S.r, b = r.from, a = Math.max(win, b - chunk); S.busy = true;
      try {
        const x = await barRange(s, { timeframe, start: a, end: b - 1000, deadline });
        S.pages += x.pages;
        if (!x.done) return; // out of time mid-chunk: dropped, so stored history never has a hole
        const got = x.bars.filter(k => Date.parse(k.t) < b);
        if (got.length) merge(r, got); else r.floor = true; // nothing in this chunk: the coin wasn't listed yet
        r.from = a; S.fetched += got.length; changed = true; progress = true;
      } catch (e) { S.error = short(e); } finally { S.busy = false; }
    }
  }));
  // 3) drop candles older than the file keeps
  for (const s of symbols) {
    const r = st[s].r; let i = 0; while (i < r.t.length && r.t[i] < keepFrom) i++;
    if (i) { for (const k of ['t', 'o', 'h', 'l', 'c']) r[k] = r[k].slice(i); r.floor = false; changed = true; }
    if (r.from != null && r.from < keepFrom) r.from = keepFrom;
  }
  // Blob puts are the scarce resource (2,000 a month on Hobby): save when older history was added, or every 3 days for new candles.
  const age = F.j?.at ? (now - Date.parse(F.j.at)) / DAY : Infinity;
  let saved = false, saveError = null;
  if (save && changed && F.ok && (progress || age > 3)) {
    // v0.13.1: another run (the background download, training or the lab) may have saved this file while this one was working.
    // Re-read it and keep both runs' candles, so the later save never erases the other's progress. Each stored coin is one
    // unbroken stretch ending near now, so the union is unbroken back to the older of the two starts.
    const F2 = await readFile(timeframe), base = F2.ok && F2.j?.coins ? F2.j.coins : coins;
    const out = { v: 1, tf: timeframe, at: new Date().toISOString(), coins: { ...base } };
    for (const s of symbols) out.coins[s] = encode(F2.ok && F2.j?.coins?.[s] && F2.j.at !== F.j?.at ? union(st[s].r, decode(F2.j.coins[s])) : st[s].r);
    try { await blobPut(histKey(timeframe), JSON.stringify(out), { maxAge: 60 }); saved = true; } catch (e) { saveError = short(e); }
  }
  const done = symbols.filter(s => covered(st[s].r, win)).length, statusEntry = { key: statusKey(timeframe, days), tf: timeframe, days, coins: symbols.length, complete: done };
  if (saved && writeStatus) await saveHistStatus([statusEntry]);
  const data = {}, cov = [];
  for (const s of symbols) {
    const S = st[s], r = S.r, arr = [];
    for (let i = 0; i < r.t.length; i++) if (r.t[i] >= win) arr.push({ t: new Date(r.t[i]).toISOString(), o: r.o[i], h: r.h[i], l: r.l[i], c: r.c[i] });
    if (arr.length) data[s] = arr;
    const complete = covered(r, win);
    cov.push({ s, bars: arr.length, from: arr[0]?.t.slice(0, 10) || null, to: arr.at(-1)?.t.slice(0, 10) || null, pages: S.pages, cached: S.cached, fetched: S.fetched,
      complete, back: r.from != null ? Math.max(0, Math.round((now - Math.max(r.from, win)) / DAY)) : 0, want: days, truncated: !complete, error: S.error });
  }
  return { data, cov, complete: cov.every(c => c.complete), saved, saveError, readError: F.ok ? null : F.why, ms: Date.now() - t00, statusEntry: saved ? statusEntry : null };
}

// Status of every history file (small; read by the backfill job so it can stop early once everything is downloaded).
export const histStatus = () => blobGet(HIST_STATUS, { fresh: true }).catch(() => null);
// entries: [{ key, tf, days, coins, complete }]. Written only when something in it changed (so once everything is downloaded it
// costs no puts), one update at a time per instance.
let statusQ = Promise.resolve();
export function saveHistStatus(entries) {
  statusQ = statusQ.then(async () => {
    const cur = (await histStatus()) || {}, same = (a, z) => a && a.coins === z.coins && a.complete === z.complete && a.days === z.days;
    const todo = entries.filter(Boolean).filter(e => !same(cur[e.key], e)); if (!todo.length) return;
    for (const e of todo) cur[e.key] = { ...e, at: new Date().toISOString() };
    await blobPut(HIST_STATUS, JSON.stringify(cur), { maxAge: 60 });
  }).catch(() => null);
  return statusQ;
}
// One line per file for the health probe and the DCA tab.
export const histLine = (H) => ({ coins: H.cov.length, complete: H.cov.filter(c => c.complete).length, pages: H.cov.reduce((a, c) => a + c.pages, 0),
  short: H.cov.filter(c => !c.complete).map(c => `${c.s} ${c.back}/${c.want}d${c.error ? ' (error)' : ''}`).slice(0, 12), saved: H.saved, readError: H.readError, ms: H.ms });
