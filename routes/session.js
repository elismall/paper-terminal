// Sign in / out (v0.17.0). POST {passcode} -> session cookie + today's market-data key; GET -> is this device signed in (and
// the key again, so a page open past midnight can refresh it); DELETE -> sign this device out; DELETE ?all=1 (v0.20.0, signed-in
// devices only) -> sign out every other device, including a stolen cookie; this one gets a fresh session. Every answer is private, no-store.
import { json, env, safeEq, sessionOf, sessionToken, sessionCookie, gateFor, SESSION, authorized } from '../lib/core.js';
import { lockState, recordFail, recordOk, signOutEverywhere, ensureSignOutFile, GUARD } from '../lib/authguard.js';

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
  recordOk(req, L.t);
  await ensureSignOutFile();
  const t = sessionToken();
  // v0.20.0 (audit #10): the cookie outlives the 7-day session by GUARD.graceDays, so a device whose session ran out still shows
  // it was signed in before and can get past an "everyone" sign-in lock. It unlocks nothing on its own.
  return withCookie(json(view({ exp: t.exp }), { priv: true }), sessionCookie(t.value, (SESSION.days + GUARD.graceDays) * 86400));
}

export async function DELETE(req) {
  if (new URL(req.url).searchParams.get('all') === '1') {
    if (!authorized(req, { strict: true })) return json({ error: 'locked', message: 'Sign in on this device first.' }, { status: 401, priv: true });
    const now = Date.now();
    try { await signOutEverywhere(now); } catch (e) { return json({ error: 'upstream', message: 'Could not save the sign-out (storage did not answer). Nothing changed; try again.' }, { status: 502, priv: true }); }
    // This device gets a fresh session issued at the cut-off, so the owner stays signed in (and keeps the "everyone"-lock grace)
    // while every other cookie, a stolen one included, stops working.
    const t = sessionToken(now);
    return withCookie(json({ ...view({ exp: t.exp }), everywhere: true }, { priv: true }), sessionCookie(t.value, (SESSION.days + GUARD.graceDays) * 86400));
  }
  return withCookie(json({ ok: true, authorized: false }, { priv: true }), sessionCookie('', 0));
}
