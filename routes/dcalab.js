import { json, fail, authorized, hasAlpaca, needKeys, snapshots, quoteOf, cronOk as isCron } from '../lib/core.js';
import { runLab } from '../lib/dcalab.js';
import { labLatest, bullState } from '../lib/dca.js';
import { perpStats, perpOf, levMode } from '../lib/leverage.js';
import { liquidity } from '../lib/macro.js';
import { readLedger, ledgerView, runSmall } from '../lib/small.js';
// DCA lab (DCA tab): which coins the crypto DCA bot trades, how it does in bull runs, and bull-run mode.
// GET = the latest saved lab + today's bull-run state + the live crypto signals (perp funding, money conditions) + the $100 plan's
// virtual accounts (lib/small.js) at live prices. ?run=1 (passcode) or the weekly cron re-runs the lab (about 1–2 minutes);
// ?small=1 (passcode) runs the $100 plan's hourly step now.
export async function GET(req) {
  const u = new URL(req.url).searchParams, cronOk = isCron(req);
  if (!cronOk && !authorized(req, { strict: true })) return json({ error: 'locked', message: 'Enter your passcode in Settings to see the DCA lab.' }, { status: 401 });
  if (!hasAlpaca()) return needKeys('the DCA lab');
  try {
    const run = cronOk || u.get('run') === '1';
    const lab = run ? await runLab() : await labLatest({ fresh: true, any: true });
    const [bull, PS, LQ] = await Promise.all([bullState().catch(e => ({ error: e.message })), perpStats().catch(e => ({ __error: e.message })), liquidity().catch(e => ({ error: e.message }))]);
    const coins = (lab?.pick?.active || []).map(s => ({ s, apr: PS.__error ? null : perpOf(PS, s)?.apr ?? null }));
    let small = null;
    if (!cronOk && u.get('small') === '1') small = await runSmall().catch(e => ({ error: e.message }));
    else { const st = await readLedger().catch(() => null), held = st?.acct ? [...new Set(Object.values(st.acct).flatMap(A => Object.keys(A.pos || {})))] : [];
      const sn = held.length ? await snapshots(held).catch(() => ({})) : {}, px = Object.fromEntries(held.map(s => [s, quoteOf(s, sn[s])?.p]).filter(x => x[1]));
      small = ledgerView(st, px); }
    return json({ lab: lab || null, bull, signals: { mode: levMode(), funding: PS.__error ? { error: PS.__error } : { coins }, liquidity: LQ }, small, ran: run, at: new Date().toISOString() }, { priv: true });
  } catch (e) { return fail(e, 'dcalab'); }
}
