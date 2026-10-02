// Shared by lib/catalyst.js, lib/ledger.js and lib/orb.js (v0.16.0; moved out of catalyst.js unchanged).
// Walk one plan over daily candles i0..end: stop / target / time exit. A candle that opens past a level exits at the open (gaps
// can jump a stop). A candle touching both levels is 'ambiguous' unless `order(i)` (5-minute bars) says which came first.
export function walk(B, i0, end, { entry, stop, target, up }, order = null) {
  for (let i = i0; i <= end && i < B.length; i++) {
    const b = B[i];
    if (up ? b.o <= stop : b.o >= stop) return { why: 'stop', exit: b.o, i, gap: true };
    if (up ? b.o >= target : b.o <= target) return { why: 'target', exit: b.o, i, gap: true };
    const hs = up ? b.l <= stop : b.h >= stop, ht = up ? b.h >= target : b.l <= target;
    if (hs && ht) { const o = order ? order(i) : null; if (o === 'stop') return { why: 'stop', exit: stop, i }; if (o === 'target') return { why: 'target', exit: target, i }; return { why: 'ambiguous', exit: null, i }; }
    if (hs) return { why: 'stop', exit: stop, i }; if (ht) return { why: 'target', exit: target, i };
  }
  const j = Math.min(end, B.length - 1); return { why: 'time', exit: B[j].c, i: j };
}
