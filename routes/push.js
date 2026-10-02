import { json, authorized, env } from '../lib/core.js';
import { pushReady, listSubs, addSub, removeSub, notify } from '../lib/notify.js';
// Phone notifications. GET: status + public key. POST {subscription}: sign this device up (sends a welcome push).
// POST {test:true}: send a test. DELETE {endpoint}: remove a device. Passcode required for everything.
const locked = () => json({ error: 'locked', message: 'Enter your passcode in Settings first.' }, { status: 401 });
const fail = (e) => json({ error: 'push_failed', message: e.message }, { status: 502 });

export async function GET(req) {
  if (!authorized(req, { strict: true })) return locked();
  const r = pushReady();
  let count = 0; if (r.ok) try { count = (await listSubs()).length; } catch (e) { return fail(e); }
  return json({ ready: r.ok, message: r.why || null, publicKey: env('VAPID_PUBLIC_KEY') || null, count }, { priv: true });
}
export async function POST(req) {
  if (!authorized(req, { strict: true })) return locked();
  if (!pushReady().ok) return json({ error: 'not_ready', message: pushReady().why }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  try {
    if (b.subscription) {
      await addSub(b.subscription);
      const sent = await notify({ title: 'Notifications are on', body: "You'll get a push when the bot buys or sells, moves a stop to breakeven, or a stop or target fills.", url: '/#bot', tag: 'welcome' });
      return json({ ok: true, sent }, { priv: true });
    }
    if (b.test) return json({ ok: true, sent: await notify({ title: 'Test from Paper Terminal', body: 'Push notifications are working on this device.', url: '/#bot', tag: 'test' }) }, { priv: true });
  } catch (e) { return fail(e); }
  return json({ error: 'bad_request', message: 'Send a subscription or test:true.' }, { status: 400 });
}
export async function DELETE(req) {
  if (!authorized(req, { strict: true })) return locked();
  const b = await req.json().catch(() => ({}));
  try { if (b.endpoint) await removeSub(b.endpoint); return json({ ok: true }, { priv: true }); } catch (e) { return fail(e); }
}
