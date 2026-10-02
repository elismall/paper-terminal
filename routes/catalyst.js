import { json, fail, authorized, hasAlpaca, needKeys } from '../lib/core.js';
import { runScenario, gradeLog, KINDS, CAT } from '../lib/catalyst.js';
import { jevStatus } from '../lib/jev.js';
// v0.13.0 Catalyst Scenario (Options tab, stocks only; lib/catalyst.js). Passcode required.
// GET                      the saved scenarios (graded once their holding period is over) + the scorecard by catalyst type
// GET ?symbol=AAPL&text=…&kind=&dir=&date=YYYY-MM-DD&horizon=5   run a scenario (saved to the log). Never places an order.
export async function GET(req) {
  if (!authorized(req, { strict: true })) return json({ error: 'locked', message: 'Enter your passcode in Settings to use the catalyst scenarios.' }, { status: 401 });
  if (!hasAlpaca()) return needKeys('catalyst scenarios');
  const u = new URL(req.url).searchParams;
  try {
    if (!u.get('symbol')) return json({ ...(await gradeLog()), kinds: KINDS, horizons: CAT.horizons, jev: jevStatus().mode, at: new Date().toISOString() }, { priv: true });
    const r = await runScenario({ symbol: u.get('symbol'), text: (u.get('text') || '').slice(0, 500), kind: u.get('kind') || '', dir: u.get('dir') || '', date: u.get('date') || '', horizon: +u.get('horizon') || 5 });
    return json(r, { priv: true });
  } catch (e) {
    if (e.code) return json({ error: e.code, message: e.message }, { status: 400 });
    return fail(e, 'catalyst');
  }
}
