import { json, denied, fail, authorized, env } from '../lib/core.js';
import { macroSeries } from '../lib/macro.js';
// Macro dashboard from FRED (free key). Series chosen for a trader's morning check; v0.11.0 adds M2 growth, the 10-year real
// yield and the Fed balance sheet (money conditions that tend to move crypto). The series list lives in lib/macro.js.
export async function GET(req) {
  if (!authorized(req)) return denied();
  if (!env('FRED_API_KEY')) return json({ error: 'no_keys', message: 'Add a free FRED_API_KEY (fred.stlouisfed.org) in Vercel to turn on the macro panel.' }, { cache: 60 });
  try {
    return json({ series: await macroSeries(), at: new Date().toISOString() }, { cache: 3600, swr: 21600 });
  } catch (e) { return fail(e, 'macro'); }
}
