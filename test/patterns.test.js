// Chart patterns (lib/patterns.js) on made-up candles: each rule fires on the setup it names and not on a normal day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patternsAt, history, describe, ivLabel, PATTERN } from '../lib/patterns.js';

// n normal days: price drifts by `drift` a day plus a fixed zig-zag of +3, -2, +2 ... (so 5 days cover several normal days of
// movement), each day reaches 0.5 past its open and close (ATR about 3.3), volume 1M.
// From day `turn` on, the drift becomes `drift2` (a trend that rolls over).
function series(n = 300, drift = 1, { turn = Infinity, drift2 = 0 } = {}) {
  const b = [], zig = [3, -2, 2, -3, 2, -2]; let c = 100;
  for (let i = 0; i < n; i++) { const o = c; c = o + (i >= turn ? drift2 : drift) + zig[i % zig.length]; b.push({ t: new Date(Date.UTC(2024, 0, 1) + i * 864e5).toISOString(), o, h: Math.max(o, c) + 0.5, l: Math.min(o, c) - 0.5, c, v: 1e6 }); }
  return b;
}
const lastOf = (b) => b[b.length - 1];
const keys = (b, frac) => patternsAt(b, b.length - 1, frac).map(p => p.key);

test('a normal day matches nothing', () => {
  for (let n = 280; n < 292; n++) assert.deepEqual(keys(series(n)), [], `day ${n}`);
});

test('tight range: under half the usual daily range, leaning with an uptrend', () => {
  const b = series(), x = lastOf(b); x.o = b.at(-2).c; x.c = x.o + 0.1; x.h = x.c + 0.3; x.l = x.o - 0.3;
  const p = patternsAt(b, b.length - 1).find(q => q.key === 'tight');
  assert.ok(p, 'tight should fire'); assert.equal(p.dir, 'up'); assert.equal(p.trend, 'up');
  assert.deepEqual(keys(b, 0.2), [], 'not with under 2 hours of the session');
});

test('tight range is two-sided when there is no trend', () => {
  const b = series(300, 0.4, { turn: 280, drift2: -0.4 }), x = lastOf(b); x.o = b.at(-2).c; x.c = x.o + 0.1; x.h = x.c + 0.3; x.l = x.o - 0.3;
  assert.equal(patternsAt(b, b.length - 1).find(q => q.key === 'tight').dir, 'either');
});

test('coil: five days inside 1.5 normal days of movement', () => {
  const b = series(), c = b[b.length - 6].c;
  for (let k = b.length - 5; k < b.length; k++) Object.assign(b[k], { o: c, c: c + (k % 2 ? 0.6 : -0.6), h: c + 1.5, l: c - 1.5 });
  assert.ok(keys(b).includes('coil'));
});

test('breakout needs the volume; today is paced to a full day', () => {
  const b = series(), x = lastOf(b), hi = Math.max(...b.slice(-21, -1).map(y => y.h));
  Object.assign(x, { o: hi - 0.5, c: hi + 1, h: hi + 1.2, l: hi - 0.6, v: 1e6 });
  assert.ok(!keys(b).includes('breakout'), 'normal volume is not a breakout');
  x.v = 2e6; assert.equal(patternsAt(b, b.length - 1)[0].key, 'breakout');
  x.v = 1e6; assert.ok(keys(b, 0.5).includes('breakout'), '1M by midday paces to 2M');
});

test('failed breakout: above the 20-day high, closed back below and below the open', () => {
  const b = series(), x = lastOf(b), hi = Math.max(...b.slice(-21, -1).map(y => y.h));
  Object.assign(x, { o: hi - 0.2, h: hi + 1, c: hi - 0.8, l: hi - 1 });
  const p = patternsAt(b, b.length - 1).find(q => q.key === 'failed');
  assert.ok(p); assert.equal(p.dir, 'down');
});

test('history counts each past setup once and says how it went', () => {
  const b = series(400);
  for (const j of [150, 250]) { const c = b[j].c; Object.assign(b[j], { o: c, h: c + 0.2, l: c - 0.2 }); for (let k = j + 1; k <= j + 3; k++) b[k].c = c + 3; }
  const h = history(b, 'tight', 'up');
  assert.equal(h.n, 2); assert.equal(h.up, 2); assert.equal(h.days, PATTERN.tight.days);
});

test('describe gives a trigger and an exit level in plain words', () => {
  const b = series(), x = lastOf(b); x.h = x.c + 0.2; x.l = x.c - 0.2;
  const d = describe(patternsAt(b, b.length - 1)[0], x.c);
  assert.match(d.trigger, /closes above \$/); assert.match(d.off, /closes below \$/); assert.match(d.text, /usually moves/);
});

test('options cheap or expensive vs how much the stock moved', () => {
  assert.equal(ivLabel(30, 40), 'cheap'); assert.equal(ivLabel(45, 40), 'fairly priced'); assert.equal(ivLabel(80, 40), 'expensive'); assert.equal(ivLabel(null, 40), null);
});
