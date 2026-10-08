// Chart patterns for the Options tab's "Plays from the chart" panel (v0.18.0). Pure math on daily candles: no network, no orders.
// Each pattern is checked on one day (index i) so the same rule finds today's setup AND counts every past time it showed up on
// this stock (history). Rules, fixed in advance (ATR = average daily range over the 14 days before i):
//   tight     today's high-to-low range is under half the ATR (needs 2+ hours of the session when today is still trading)
//   coil      the last 5 days stayed inside 1.25 ATRs of movement
//   breakout  closes above the 20-day high (or below the 20-day low) on 1.5x normal volume (today's volume is paced to a full day)
//   pullback  uptrend (above a rising 50-day average) that dipped to the 20-day average and closed back above it
//   failed    pushed above the 20-day high, then closed back below it and below its open
// Trend = above a rising 50-day average (up), below a falling one (down), else flat. Range patterns lean with the trend and are
// two-sided ("either way") when it is flat. Counts are past outcomes, never forecasts.
import { sma, atr, round } from './core.js';

const rangeAt = (b, i) => b[i].h - b[i].l;
const atrAt = (b, i) => atr(b.slice(Math.max(0, i - 40), i), 14);
const closes = (b, i) => b.slice(0, i + 1).map(x => x.c);
function trendAt(b, i) {
  if (i < 60) return 'flat';
  const c = closes(b, i), m = sma(c, 50), m10 = sma(c.slice(0, -10), 50);
  return b[i].c > m && m > m10 ? 'up' : b[i].c < m && m < m10 ? 'down' : 'flat';
}
const hiLo = (b, from, to) => { let h = -Infinity, l = Infinity; for (let k = from; k <= to; k++) { h = Math.max(h, b[k].h); l = Math.min(l, b[k].l); } return { h, l }; };
const avgVol = (b, from, to) => { let s = 0; for (let k = from; k <= to; k++) s += b[k].v || 0; return s / (to - from + 1); };

// Each check returns null or { key, dir: 'up' | 'down' | 'either', hi, lo } (hi / lo = the levels that matter).
// frac = how much of the session today's candle covers (1 for a finished day); only the last candle can be partial.
const RULES = {
  breakout(b, i, A, frac) {
    const { h, l } = hiLo(b, i - 20, i - 1), v = (b[i].v || 0) / Math.max(frac, 0.05), av = avgVol(b, i - 20, i - 1);
    if (!(av > 0 && v >= 1.5 * av)) return null;
    if (b[i].c > h) return { key: 'breakout', dir: 'up', hi: h, lo: b[i].l, vol: v / av };
    if (b[i].c < l) return { key: 'breakout', dir: 'down', hi: b[i].h, lo: l, vol: v / av };
    return null;
  },
  failed(b, i) {
    const { h } = hiLo(b, i - 20, i - 1);
    return b[i].h > h && b[i].c < h && b[i].c < b[i].o ? { key: 'failed', dir: 'down', hi: b[i].h, lo: b[i].l, level: h } : null;
  },
  tight(b, i, A, frac, trend) {
    if (frac < 0.3 || !(rangeAt(b, i) < 0.5 * A)) return null;
    return { key: 'tight', dir: trend === 'flat' ? 'either' : trend, hi: b[i].h, lo: b[i].l, ratio: rangeAt(b, i) / A };
  },
  coil(b, i, A, frac, trend) {
    const { h, l } = hiLo(b, i - 4, i);
    return h - l < 1.25 * A ? { key: 'coil', dir: trend === 'flat' ? 'either' : trend, hi: h, lo: l, ratio: (h - l) / A } : null;
  },
  pullback(b, i, A, frac, trend) {
    if (trend !== 'up') return null;
    const m20 = sma(closes(b, i), 20);
    return b[i].l <= m20 && b[i].c > m20 ? { key: 'pullback', dir: 'up', hi: b[i].h, lo: b[i].l, m20 } : null;
  },
};
// Order = which one wins when several match (the most specific first).
const ORDER = ['breakout', 'failed', 'tight', 'coil', 'pullback'];
export const PATTERN = {
  breakout: { name: 'Breakout on volume', days: 5, want: 21 },
  failed: { name: 'Failed breakout', days: 5, want: 21 },
  tight: { name: 'Tight range all day', days: 3, want: 10 },
  coil: { name: 'Coiling for several days', days: 5, want: 14 },
  pullback: { name: 'Pullback in an uptrend', days: 5, want: 28 },
};

// Every pattern that matches on day i (most specific first), or [] (needs about 60 days of history before i).
export function patternsAt(b, i, frac = 1) {
  if (i < 60) return [];
  const A = atrAt(b, i); if (!A) return [];
  const trend = trendAt(b, i), out = [];
  for (const k of ORDER) { const p = RULES[k](b, i, A, frac, trend); if (p) out.push({ ...p, atr: A, trend }); }
  return out;
}

// What happened after every past match of the same pattern and direction on this stock (the last `lookback` finished days,
// one count per setup: a match within `days` of the last counted one is the same setup). Range patterns (tight, coil): which side
// of the range it closed beyond first within `days`, else it stayed in the range. The others: the close `days` later vs the
// signal day's close, with half an ATR either way counted as flat.
export function history(b, key, dir, { lookback = 500 } = {}) {
  const H = PATTERN[key].days, out = { n: 0, up: 0, down: 0, flat: 0, upAvg: null, downAvg: null, days: H };
  const ups = [], downs = [], end = b.length - 1 - H; let lastAt = -Infinity;
  for (let j = Math.max(60, b.length - 1 - lookback); j < end; j++) {
    if (j - lastAt <= H) continue;
    const p = patternsAt(b, j).find(x => x.key === key); if (!p || p.dir !== dir) continue;
    lastAt = j; out.n++;
    let res = 'flat', mv = 0;
    if (key === 'tight' || key === 'coil') {
      for (let k = j + 1; k <= j + H; k++) { if (b[k].c > p.hi) { res = 'up'; break; } if (b[k].c < p.lo) { res = 'down'; break; } }
    } else {
      const d = b[j + H].c - b[j].c; res = d > 0.5 * p.atr ? 'up' : d < -0.5 * p.atr ? 'down' : 'flat';
    }
    mv = (b[j + H].c / b[j].c - 1) * 100;
    out[res]++; if (res === 'up') ups.push(mv); if (res === 'down') downs.push(mv);
  }
  const avg = (a) => a.length ? round(a.reduce((s, v) => s + v, 0) / a.length, 1) : null;
  out.upAvg = avg(ups); out.downAvg = avg(downs);
  return out;
}

// Options cheap or expensive: implied volatility vs how much the stock actually moved over the last 20 days (annualized).
export function ivLabel(iv, rv) {
  if (!(iv > 0 && rv > 0)) return null;
  const r = iv / rv;
  return r < 1 ? 'cheap' : r <= 1.3 ? 'fairly priced' : 'expensive';
}

// The plain-language read of one pattern: what it is, the trigger to wait for, and the level where the idea is off.
export function describe(p, px) {
  const $ = (v) => '$' + round(v).toFixed(2), pct = (v) => round(v, 1) + '%';
  const tr = p.trend === 'up' ? 'Trend: up (above its rising 50-day average).' : p.trend === 'down' ? 'Trend: down (below its falling 50-day average).' : 'Trend: none (no clear direction over 50 days).';
  const usual = `it usually moves about ${$(p.atr)} (${pct(p.atr / px * 100)}) a day`;
  const two = { trigger: `a close above ${$(p.hi)} or below ${$(p.lo)}`, off: 'it is still inside the range at expiry' };
  const lean = p.dir === 'up' ? { trigger: `it closes above ${$(p.hi)}`, off: `it closes below ${$(p.lo)}` } : { trigger: `it closes below ${$(p.lo)}`, off: `it closes above ${$(p.hi)}` };
  switch (p.key) {
    case 'tight': return { text: `Today's range is only ${$(p.hi - p.lo)}; ${usual}. ${tr}`, ...(p.dir === 'either' ? two : lean) };
    case 'coil': return { text: `The last 5 days stayed between ${$(p.lo)} and ${$(p.hi)}, about ${round(p.ratio, 1)} normal days of movement; ${usual}. ${tr}`, ...(p.dir === 'either' ? two : lean) };
    case 'breakout': return p.dir === 'up'
      ? { text: `Closed above its 20-day high (${$(p.hi)}) on about ${round(p.vol, 1)}x normal volume. ${tr}`, trigger: null, off: `it closes back below ${$(p.hi)}` }
      : { text: `Closed below its 20-day low (${$(p.lo)}) on about ${round(p.vol, 1)}x normal volume. ${tr}`, trigger: null, off: `it closes back above ${$(p.lo)}` };
    case 'pullback': return { text: `Dipped to its 20-day average (${$(p.m20)}) and closed back above it. ${tr}`, trigger: null, off: `it closes below ${$(p.lo)}` };
    case 'failed': return { text: `Pushed above its 20-day high (${$(p.level)}) but closed back below it, lower than it opened. ${tr}`, trigger: null, off: `it closes above ${$(p.hi)}` };
  }
}
