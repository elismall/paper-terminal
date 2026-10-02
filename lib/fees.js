// Fee accounting (v0.16.0, Phase A). Alpaca paper fills are at the traded price with no fees or slippage, so live scorecards
// looked better than training (which already charges costs). Live trades and DCA deals are now scored AFTER estimated costs,
// the same way training scores them:
//   stocks  0.05% a side (slippage + regulatory fees; Alpaca charges no stock commission) = perf.js COST
//   crypto  Alpaca tier 1 (under $100,000 of 30-day volume): taker 0.25% (market and stop orders), maker 0.15% (resting limit orders)
//           Source: docs.alpaca.markets/us/docs/crypto-fees (checked 2026-09-30).
// If the account ever shows real crypto fee activities (CFEE), the fee is already inside the fills, so no estimate is added
// for crypto and the scorecard says so. /api/health?probe=fees reports what the account shows.
import { pget } from './trade.js';
export const FEES = { stock: 0.0005, cryptoTaker: 0.0025, cryptoMaker: 0.0015, source: 'docs.alpaca.markets/us/docs/crypto-fees (tier 1), checked 2026-09-30' };
export const isCryptoSym = (s, cls) => cls ? cls === 'crypto' : String(s || '').includes('/');
// Fee rate for one fill: limit orders rest on the book (maker) unless marketable; the bot's crypto limits are resting take
// profits and dip buys, so they are counted as maker. Market, stop and stop-limit fills are taker.
export function feeRate({ crypto, type, charged }) {
  if (!crypto) return FEES.stock;
  if (charged) return 0;
  return type === 'limit' ? FEES.cryptoMaker : FEES.cryptoTaker;
}
let memo = null;
// Does this account get charged real crypto fees? One small activities call, remembered for 10 minutes.
export async function feeMode({ fresh = false } = {}) {
  if (!fresh && memo && Date.now() - memo.at < 6e5) return memo.v;
  let v;
  try {
    const a = await pget('/v2/account/activities?activity_types=CFEE,FEE&direction=desc&page_size=20');
    const list = Array.isArray(a) ? a : [];
    v = { charged: list.some(x => x.activity_type === 'CFEE'), n: list.length, last: list[0]?.date || list[0]?.transaction_time || null, checked: true };
  } catch (e) { v = { charged: false, n: 0, checked: false, error: e.message }; }
  memo = { at: Date.now(), v };
  return v;
}
export const feeNote = (m) => m?.charged ? 'Crypto: Alpaca charged real fees, already inside the fills (no estimate added). Stocks: 0.05% a side estimated.'
  : 'After estimated costs: stocks 0.05% a side; crypto 0.25% taker (market/stop) or 0.15% maker (resting limit), Alpaca tier 1. Paper fills include no fees.';
export const _resetFeeMemo = () => { memo = null; };
