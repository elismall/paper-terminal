import { json, authorized, hasAlpaca, fail } from '../lib/core.js';
import { ordersSince } from '../lib/trade.js';
import { getMode, setMode, lastRun, emergencyStop, RISK } from '../lib/control.js';
import { jevStatus, JEV } from '../lib/jev.js';
import { notify } from '../lib/notify.js';
import { gapToday } from '../lib/gap.js';
import { lastReview } from '../lib/review.js';
// Kill switch. GET: current mode, last run's safety level, AI filter status. POST {action}: pause | resume | stop
// (stop = emergency stop: pause + cancel the bots' orders + close every bot-opened position). Passcode required.
const locked = () => json({ error: 'locked', message: 'Enter your passcode in Settings first.' }, { status: 401 });

export async function GET(req) {
  if (!authorized(req, { strict: true })) return locked();
  try {
    const [mode, last, gap, review] = await Promise.all([getMode().catch(() => ({ mode: 'unknown', reason: 'could not read the saved state; the bots make no new trades until it can be read' })), lastRun(), gapToday(), lastReview()]);
    return json({ ...mode, last, gap, review: review ? { at: review.at, mode: review.mode, n: Object.keys(review.items || {}).length } : null, jev: { ...jevStatus(), gate: JEV.gate }, risk: RISK, at: new Date().toISOString() }, { priv: true });
  } catch (e) { return fail(e, 'control'); }
}
export async function POST(req) {
  if (!authorized(req, { strict: true })) return locked();
  if (!hasAlpaca()) return json({ error: 'no_keys', message: 'Alpaca keys are not set.' }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === 'pause') {
      await setMode('pause', 'you', 'paused from the app');
      await notify({ title: 'Bots paused', body: 'No new trades until you resume. Open trades keep their stops, targets and take profits.', url: '/#bot', tag: 'killswitch' }).catch(() => null);
      return json({ ok: true, mode: 'pause' }, { priv: true });
    }
    if (b.action === 'resume') {
      await setMode('run', 'you', 'resumed from the app');
      await notify({ title: 'Bots resumed', body: 'New trades are allowed again from the next run.', url: '/#bot', tag: 'killswitch' }).catch(() => null);
      return json({ ok: true, mode: 'run' }, { priv: true });
    }
    if (b.action === 'stop') return json({ ok: true, mode: 'pause', ...(await emergencyStop(await ordersSince(120, 8))) }, { priv: true });
    return json({ error: 'bad_request', message: 'action must be pause, resume or stop' }, { status: 400 });
  } catch (e) { return fail(e, 'control'); }
}
