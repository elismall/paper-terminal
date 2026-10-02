import { json, authorized, hasAlpaca, fail, cronOk as isCron } from '../lib/core.js';
import { gapCheck, gapToday } from '../lib/gap.js';
// Pre-market gap check. Run by the heartbeat (/api/tick) every 15 minutes 8:00-9:15 AM ET plus 9:25 (v0.14.0), or
// manual from the Bot tab with the passcode: ?run=1 runs it now (after the open it compares with yesterday's close).
// No orders are ever placed here. GET without run=1 returns today's result.
export async function GET(req) {
  const u = new URL(req.url).searchParams;
  const cronOk = isCron(req);
  const manual = authorized(req, { strict: true });
  if (!cronOk && !manual) return json({ error: 'locked', message: 'Enter your passcode in Settings first.' }, { status: 401 });
  if (!hasAlpaca()) return json({ error: 'no_keys', message: 'Alpaca keys are not set.' }, { status: 400 });
  try {
    if (manual && !cronOk && u.get('run') !== '1') return json({ gap: await gapToday() }, { priv: true });
    return json(await gapCheck({ force: manual && u.get('run') === '1' }), { priv: true });
  } catch (e) { return fail(e, 'gapcheck'); }
}
