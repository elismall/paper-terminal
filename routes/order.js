import { json, fail, authorized, hasAlpaca, needKeys } from '../lib/core.js';
import { buildOrder, ppost, pdel, compactOrder } from '../lib/trade.js';
// Paper orders. POST = place, DELETE ?id= cancel, DELETE ?close=SYMBOL close position, DELETE ?all=1 cancel all open orders.
// Always requires the passcode token (strict) and never caches.
const locked = () => json({ error: 'locked', message: 'Set DASH_PASSCODE in Vercel and enter it in Settings before trading.' }, { status: 401 });
export async function POST(req) {
  if (!authorized(req, { strict: true })) return locked();
  if (!hasAlpaca()) return needKeys('trading');
  let t; try { t = await req.json(); } catch { return json({ error: 'bad_request', message: 'Order must be JSON' }, { status: 400 }); }
  let body; try { body = buildOrder(t); } catch (e) { return json({ error: 'invalid', message: e.message }, { status: 400 }); }
  if (t.preview) return json({ ok: true, preview: body }, { priv: true });
  try { const o = await ppost('/v2/orders', body); return json({ ok: true, order: compactOrder(o), sent: body }, { priv: true }); }
  catch (e) { if (e.status) return json({ error: 'rejected', message: e.message, sent: body }, { status: 422 }); return fail(e, 'order'); }
}
export async function DELETE(req) {
  if (!authorized(req, { strict: true })) return locked();
  if (!hasAlpaca()) return needKeys('trading');
  const u = new URL(req.url).searchParams;
  try {
    if (u.get('id')) { await pdel('/v2/orders/' + encodeURIComponent(u.get('id'))); return json({ ok: true, cancelled: u.get('id') }, { priv: true }); }
    if (u.get('close')) { const o = await pdel('/v2/positions/' + encodeURIComponent(u.get('close').replace('/', ''))); return json({ ok: true, order: o ? compactOrder(o) : null }, { priv: true }); }
    if (u.get('all') === '1') { const r = await pdel('/v2/orders'); return json({ ok: true, cancelled: (r || []).length }, { priv: true }); }
    return json({ error: 'bad_request', message: 'Nothing to cancel or close' }, { status: 400 });
  } catch (e) { if (e.status) return json({ error: 'rejected', message: e.message }, { status: 422 }); return fail(e, 'order-delete'); }
}
