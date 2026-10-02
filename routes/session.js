// Sign in / out (v0.17.0). POST {passcode} -> session cookie + today's market-data key; GET -> is this device signed in (and
// the key again, so a page open past midnight can refresh it); DELETE -> sign this device out. Every answer is private, no-store.
import { json, env, safeEq, sessionOf, sessionToken, sessionCookie, gateFor, SESSION } from '../lib/core.js';
import { lockState, recordFail, recordOk } from '../lib/authguard.js';

const withCookie = (res, cookie) => { res.headers.append('set-cookie', cookie); return res; };
const view = (s) => ({ ok: true, locked: !!env('DASH_PASSCODE'), authorized: !!s, exp: s ? new Date(s.exp * 1000).toISOString() : null, gate: s ? gateFor() : null, days: SESSION.days });

export async function GET(req) {
  if (!env('DASH_PASSCODE')) return json({ ...view(null), message: 'No passcode set: market data is open, the account stays locked. Add DASH_PASSCODE in Vercel.' }, { priv: true });
  return json(view(sessionOf(req)), { priv: true });
}

export async function POST(req) {
  const pass = env('DASH_PASSCODE');
  if (!pass) return json({ error: 'no_passcode', message: 'Set DASH_PASSCODE in Vercel → Settings → Environment Variables first, then redeploy.' }, { status: 400, priv: true });
  if (!env('CRON_SECRET')) return json({ error: 'setup', message: 'Set CRON_SECRET in Vercel first (it also protects your sign-in), then redeploy.' }, { status: 400, priv: true });
  const L = await lockState(req);
  if (L.locked) return json({ error: 'locked_out', retryAfter: L.retryAfter, message: `Too many wrong passcodes${L.everyone ? ' from several devices' : ''}. Try again in ${Math.ceil(L.retryAfter / 60)} minutes.` }, { status: 429, priv: true });
  let body = {}; try { body = await req.json(); } catch {}
  const given = typeof body?.passcode === 'string' ? body.passcode.slice(0, 200) : '';
  if (!given || !safeEq(given, pass)) {
    const lock = await recordFail(req);
    return json(lock ? { error: 'locked_out', retryAfter: Math.ceil((lock.until - Date.now()) / 1000), message: `Too many wrong passcodes. Try again in ${Math.ceil((lock.until - Date.now()) / 6e4)} minutes.` } : { error: 'wrong', message: 'Wrong passcode.' }, { status: lock ? 429 : 401, priv: true });
  }
  recordOk(req);
  const t = sessionToken();
  return withCookie(json(view({ exp: t.exp }), { priv: true }), sessionCookie(t.value));
}

export async function DELETE() {
  return withCookie(json({ ok: true, authorized: false }, { priv: true }), sessionCookie('', 0));
}
