import { json, fail, authorized, hasAlpaca, needKeys, denied } from '../lib/core.js';
import { backtest } from '../lib/perf.js';
import { dcaTraining } from '../lib/dca.js';
// Historical benchmark of the swing rules (walk-forward replay) for stocks, the separate crypto training, and the
// DCA bot's training (cached ~20 h in Blob). Heavy, so cached for a day at the CDN.
export async function GET(req) {
  if (!authorized(req)) return denied();
  if (!hasAlpaca()) return needKeys('the benchmark');
  try {
    const [r, crypto, dca] = await Promise.all([backtest(), backtest({ crypto: true }).catch(e => ({ error: 'upstream', message: e.message })), dcaTraining().catch(e => ({ error: 'upstream', message: e.message }))]);
    return json({ ...r, crypto, dca, at: new Date().toISOString() }, { cache: 86400, swr: 172800 });
  } catch (e) { return fail(e, 'benchmark'); }
}
