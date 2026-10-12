// synthetic hourly/daily prices for tests
let seed = 7; export const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const cache = {};
const vol = (s) => /PEPE|SHIB|BONK|WIF|TRUMP|DOGE/.test(s) ? 0.018 : s.includes('/') ? 0.009 : 0.0025;       // hourly vol
export function hourly(s, startMs) {
  const key = s; if (!cache[key]) {
    const n = 24 * 720, t0 = Math.floor((Date.now() - n * 36e5) / 36e5) * 36e5; let p = s.includes('BTC') ? 60000 : s.includes('DOGE') ? 0.2 : /PEPE|SHIB|BONK/.test(s) ? 0.00001 : 100; const out = [];
    let drift = 0.00002;
    for (let i = 0; i < n; i++) { if (i % 2000 === 0) drift = (rnd() - 0.45) * 0.0006; const o = p; p = p * (1 + drift + (rnd() - 0.5) * 2 * vol(s)); const h = Math.max(o, p) * (1 + rnd() * vol(s)), l = Math.min(o, p) * (1 - rnd() * vol(s)); out.push({ t: new Date(t0 + i * 36e5).toISOString(), o, h, l, c: p, v: 1000 }); }
    cache[key] = out;
  }
  return cache[key].filter(b => Date.parse(b.t) >= startMs && Date.parse(b.t) + 36e5 <= Date.now() + 36e5);
}
const dcache = {};
export function daily(s, startMs) {
  if (dcache[s]) return dcache[s].filter(b => Date.parse(b.t) >= startMs);
  const H = hourly(s, 0), byDay = new Map();
  for (const b of H) { const d = b.t.slice(0, 10); const x = byDay.get(d); if (!x) byDay.set(d, { t: d + 'T00:00:00Z', o: b.o, h: b.h, l: b.l, c: b.c, v: 1 }); else { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; } }
  dcache[s] = [...byDay.values()];
  return dcache[s].filter(b => Date.parse(b.t) >= startMs);
}
// v0.12.1 test switches: limit = emulate Alpaca's page limit shared by every symbol in a request (symbol order, page tokens);
// short[s] = only the last n bars exist; fail[s] = HTTP status for any request that includes s.
// v0.12.2: end = last bar time allowed (Alpaca's end); calls counts bar requests per symbol list (to check the stored history saves downloads).
export const BAR_OPT = { limit: 0, short: {}, fail: {}, calls: 0 };
export function barsResponse(u) {
  const syms = u.searchParams.get('symbols').split(','), tf = u.searchParams.get('timeframe'), start = Date.parse(u.searchParams.get('start')) || 0, b = {};
  const end = Date.parse(u.searchParams.get('end')) || Infinity; BAR_OPT.calls++;
  const bad = syms.find(s => BAR_OPT.fail[s]); if (bad) return new Response('error', { status: BAR_OPT.fail[bad] });
  for (const s of syms) { let x = tf === '1Day' ? daily(s, 0) : hourly(s, 0); if (BAR_OPT.short[s] != null) x = x.slice(-BAR_OPT.short[s]); b[s] = x.filter(k => Date.parse(k.t) >= start && Date.parse(k.t) <= end); }
  if (!BAR_OPT.limit) return new Response(JSON.stringify({ bars: b }));
  const flatB = syms.flatMap(s => b[s].map(x => [s, x])), off = +(u.searchParams.get('page_token') || 0), lim = Math.min(+u.searchParams.get('limit') || 10000, BAR_OPT.limit), page = {};
  for (const [s, x] of flatB.slice(off, off + lim)) (page[s] ||= []).push(x);
  return new Response(JSON.stringify({ bars: page, next_page_token: off + lim < flatB.length ? String(off + lim) : null }));
}
