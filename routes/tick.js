import { json, authorized, hasAlpaca, fail, cronOk as isCron, waitUntilFn } from '../lib/core.js';
import { pget } from '../lib/trade.js';
import { planTick, dayPlan, etNow, SCHED } from '../lib/schedule.js';
import { eveningDone } from '../lib/control.js';
import { runBot } from '../lib/botcore.js';
import { gapCheck } from '../lib/gap.js';
import { stockTraining } from '../lib/perf.js';
import { gradeLog } from '../lib/catalyst.js';
import { gradeTradeFit } from '../lib/tradefit.js';
import { gradeCandidates } from '../lib/ledger.js';
import { orbRun } from '../lib/orb.js';
// The heartbeat (v0.14.0; every 15 minutes from cron-job.org on the free setup, every 5 on Vercel Pro). Asks Alpaca's calendar what kind of day it is, then
// lib/schedule.js picks the job: pre-market gap check, the stock job (watch / morning / scan), the after-close retrain and the
// crypto check. v0.15.0: the 7:00 PM ET evening tick also grades the research logs (Catalyst scenarios, Trade fit asks) whose
// windows have ended. v0.16.0: the evening tick also grades the candidate ledger, and the 4:20 PM wrap replays the day for the
// opening-range shadow (lib/orb.js). Cron only (CRON_SECRET); with the passcode, ?plan=1 shows what a tick would do right now (runs nothing).
// Free mode (v0.17.1, Vercel Hobby, whose own crons run once a day): an outside scheduler (cron-job.org, free) calls
// /api/tick?every=15 with the same Authorization header. every = minutes between calls (planTick covers the whole window, scans
// every 30 minutes), the run only reads the lock (no Blob write), and the answer comes back at once (202) while the work
// continues (waitUntil), because cron-job.org hangs up after 30 seconds.
// v0.20.0: &lock=1 (the vercel.json daily backup, 00:40 UTC = 8:40 PM EDT / 7:40 PM EST) takes the real one-run lock (one Blob write a
// day), so a 15-minute tick that starts while it works stands down. After 7 PM ET the tick checks whether the evening run already
// happened today (audit #8): done → never again; not done → only the backup catches it up (one try per instance per day), so two
// schedulers never both run it; unreadable → only the usual 7 PM window.
const caughtUp = new Set(); // New York days this instance already ran an evening catch-up for
export async function GET(req) {
  const u = new URL(req.url).searchParams;
  const cronOk = isCron(req);
  const manual = authorized(req, { strict: true });
  if (!cronOk && !(manual && u.get('plan') === '1')) return json({ error: 'locked', message: 'The heartbeat runs on its schedule. With your passcode, ?plan=1 shows what it would do now.' }, { status: 401 });
  if (!hasAlpaca()) return json({ error: 'no_keys', message: 'Alpaca keys are not set.' });
  try {
    const now = Date.now(), day = etNow(now).day;
    const cal = await pget(`/v2/calendar?start=${day}&end=${day}`).catch(() => null);
    const session = Array.isArray(cal) ? cal.find(c => c.date === day) || null : null;
    const every = Math.max(5, Math.min(60, Math.round(+u.get('every')) || 5)), free = every >= 10;
    const backup = u.get('lock') === '1', late = etNow(now).min >= SCHED.evening;
    let done = late ? await eveningDone(day) : null;
    if (done === false && !(backup && !caughtUp.has(day))) done = null; // catch-up is the backup's job, once
    if (done === false && cronOk) caughtUp.add(day);
    const plan = planTick(now, session, { step: every, eveningDone: done });
    if (!cronOk) return json({ plan, today: dayPlan(session, { step: every }), calendar: cal ? 'ok' : 'unavailable' }, { priv: true });
    const work = runTick({ req, plan, session, now, free: free && !backup });
    const wu = free ? waitUntilFn() : null;
    if (wu) { wu(work.catch(e => console.error('tick', e))); return json({ accepted: true, plan }, { status: 202, priv: true }); }
    return json(await work, { priv: true });
  } catch (e) { return fail(e, 'tick'); }
}
async function runTick({ req, plan, session, now, free }) {
  const out = { plan, free };
  if (plan.pre) out.pre = await gapCheck({ refresh: true }).then(r => r.skipped ? r : { checked: r.checked, skip: Object.keys(r.skip || {}).length, movers: r.movers }).catch(e => ({ error: e.message }));
  if (plan.wrap) out.wrap = await stockTraining({ fresh: true }).then(t => ({ lastBar: t.lastBar, chosen: t.chosen, minScore: t.recMinScore, error: t.error })).catch(e => ({ error: e.message }));
  if (plan.wrap) out.orb = await orbRun(session, { now }).then(r => ({ day: r.day, signals: r.signals, skipped: r.skipped, error: r.error })).catch(e => ({ error: e.message }));
  if (plan.crypto === 'evening') out.research = await Promise.all([gradeLog().then(r => ({ graded: r.score.graded, waiting: r.score.waiting })), gradeTradeFit().then(r => ({ asked: r.score.asked, swingGraded: r.score.swingGraded })),
    gradeCandidates().then(r => ({ graded: r.graded, waiting: r.waiting })).catch(e => ({ error: e.message }))])
    .then(([catalyst, tradeFit, candidates]) => ({ catalyst, tradeFit, candidates })).catch(e => ({ error: e.message }));
  // One bot run per tick: the stock job when there is one (it includes the crypto check), else the crypto check alone.
  const slot = plan.stocks || (plan.crypto === 'evening' ? 'cx' : 'chk');
  const r = await runBot(req, slot, { free });
  out.bot = await r.json().catch(() => ({ error: 'unreadable bot result' }));
  return out;
}
