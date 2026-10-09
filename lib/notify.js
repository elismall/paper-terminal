// Phone notifications (Web Push) for the bot. No npm packages: VAPID signing and aes128gcm payload encryption
// (RFC 8291 / 8188) use Node's built-in crypto. Device subscriptions live in a Vercel Blob store (BLOB_READ_WRITE_TOKEN).
// Env: VAPID_PUBLIC_KEY (base64url, 65-byte point), VAPID_PRIVATE_KEY (base64url, 32 bytes, Sensitive), BLOB_READ_WRITE_TOKEN.
import crypto from 'node:crypto';
import { env } from './core.js';

// VAPID contact (the push services' "sub"): VAPID_SUBJECT if set, else this copy's own production address (Vercel system variable).
const SITE = env('VAPID_SUBJECT') || (env('VERCEL_PROJECT_PRODUCTION_URL') ? 'https://' + env('VERCEL_PROJECT_PRODUCTION_URL') : 'https://vercel.com');
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

export function pushReady() {
  if (!env('VAPID_PUBLIC_KEY') || !env('VAPID_PRIVATE_KEY')) return { ok: false, why: 'Notifications are not set up on the server yet (VAPID keys missing).' };
  if (!env('BLOB_READ_WRITE_TOKEN')) return { ok: false, why: 'Notifications need the Blob store connected to the project (BLOB_READ_WRITE_TOKEN missing).' };
  return { ok: true };
}

// ---- aes128gcm encryption (RFC 8291). opts.salt / opts.asPrivate only for tests. ----
export function encrypt(uaPublicB64, authB64, plaintext, opts = {}) {
  const uaPublic = unb64u(uaPublicB64), auth = unb64u(authB64);
  const as = crypto.createECDH('prime256v1');
  if (opts.asPrivate) as.setPrivateKey(unb64u(opts.asPrivate)); else as.generateKeys();
  const asPublic = as.getPublicKey();
  const ecdh = as.computeSecret(uaPublic);
  const ikm = hmac(hmac(auth, ecdh), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const salt = opts.salt ? unb64u(opts.salt) : crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// ---- VAPID (RFC 8292): ES256 JWT signed with the server key ----
export function vapidJwt(audience, pub = env('VAPID_PUBLIC_KEY'), priv = env('VAPID_PRIVATE_KEY')) {
  const P = unb64u(pub);
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: priv, x: b64u(P.subarray(1, 33)), y: b64u(P.subarray(33, 65)) }, format: 'jwk' });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SITE }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${claims}.${b64u(sig)}`;
}

// v0.20.0 (audit #13): devices may only point at the browsers' own push services, so a signed-in page cannot make the server
// POST to any other host (server-side request forgery). Chrome/Edge/Android: FCM; Safari: Apple; Firefox: Mozilla; old Edge: WNS.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|([\w-]+\.)*push\.apple\.com|updates\.push\.services\.mozilla\.com|([\w-]+\.)*notify\.windows\.com)$/;
export const pushHostOk = (endpoint) => { try { const u = new URL(endpoint); return u.protocol === 'https:' && !u.port && PUSH_HOSTS.test(u.hostname); } catch { return false; } };
async function sendOne(sub, payload) {
  if (!pushHostOk(sub.endpoint)) return 410; // saved by an older build before the host check: dropped like an expired device
  const body = encrypt(sub.keys.p256dh, sub.keys.auth, JSON.stringify(payload));
  const r = await fetch(sub.endpoint, { method: 'POST', body, signal: AbortSignal.timeout(T.push), headers: {
    TTL: '86400', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
    Authorization: `vapid t=${vapidJwt(new URL(sub.endpoint).origin)}, k=${env('VAPID_PUBLIC_KEY')}` } });
  return r.status;
}

// ---- tiny Blob store helpers (Vercel Blob REST API, public store) ----
// Hobby includes 2,000 "advanced" operations a month (put/list/copy; del is free) and 10,000 "simple" ones (a URL read
// that misses the CDN cache). Going over locks the store for 30 days, so: never list to read. Files have fixed names and
// are read straight from their public URL; page views use the CDN copy (maxAge seconds), bot runs read fresh.
const BLOB = 'https://vercel.com/api/blob';
// v0.20.0 (audit #12): every outside call has a deadline, so a stalled socket cannot hold a run (and its lock) until the 300 s kill.
const T = { read: 10e3, write: 20e3, push: 10e3 };
const bh = (x = {}) => ({ authorization: `Bearer ${env('BLOB_READ_WRITE_TOKEN')}`, 'x-api-version': '12', ...x });
async function bcheck(r, what) { if (!r.ok) throw new Error(`${what} failed (${r.status}): ${(await r.text()).slice(0, 160)}`); return r; }
// token = vercel_blob_rw_<storeId>_<secret>; public files live at https://<storeid>.public.blob.vercel-storage.com/<path>
let learnedBase = null; const memo = new Map();
export const blobBase = () => { if (learnedBase) return learnedBase; const id = String(env('BLOB_READ_WRITE_TOKEN') || '').split('_')[3]; return id ? `https://${id.toLowerCase()}.public.blob.vercel-storage.com` : null; };
const learn = (url, pathname) => { if (url && url.endsWith('/' + pathname)) learnedBase = url.slice(0, -pathname.length - 1); };
export const blobUrl = (pathname) => `${blobBase()}/${pathname}`;
async function putRaw(pathname, text, { maxAge = 300, overwrite = true } = {}) {
  return fetch(`${BLOB}/?${new URLSearchParams({ pathname })}`, { method: 'PUT', body: text, signal: AbortSignal.timeout(T.write),
    headers: bh({ 'x-content-type': 'application/json', 'x-add-random-suffix': '0', 'x-allow-overwrite': overwrite ? '1' : '0', 'x-vercel-blob-access': 'public', 'x-cache-control-max-age': String(maxAge) }) });
}
export async function blobPut(pathname, text, opts) { const j = await (await bcheck(await putRaw(pathname, text, opts), 'Blob save')).json(); learn(j.url, pathname); try { memo.set(pathname, { t: Date.now(), v: JSON.parse(text) }); } catch {} return j; }
// Create only if absent (one advanced op): returns the blob, or 'exists'. Used as the run lock.
export async function blobCreate(pathname, text) {
  const r = await putRaw(pathname, text, { maxAge: 60, overwrite: false });
  if (!r.ok) { const t = await r.text(); if (/exist/i.test(t) || r.status === 409) return 'exists'; throw new Error(`Blob create failed (${r.status}): ${t.slice(0, 160)}`); }
  const j = await r.json(); learn(j.url, pathname); return j;
}
export async function blobList(prefix) { const r = await fetch(`${BLOB}?${new URLSearchParams({ prefix, limit: '100' })}`, { headers: bh(), signal: AbortSignal.timeout(T.read) }); return (await (await bcheck(r, 'Blob list')).json()).blobs || []; }
export async function blobDel(urls) { if (!urls.length) return; await bcheck(await fetch(`${BLOB}/delete`, { method: 'POST', signal: AbortSignal.timeout(T.write), headers: bh({ 'content-type': 'application/json' }), body: JSON.stringify({ urls }) }), 'Blob delete'); }
// Read a JSON file by name. fresh: bypass the CDN copy (bot runs, locks). Otherwise a 30 s per-instance memo on top.
// blobGet answers null for "missing" AND for "could not read": fine for showing things, never for read-modify-write.
// blobGetStrict (v0.20.0, audit #2/#3) answers null only for a confirmed 404 and throws on anything else, so code that saves what
// it read (history, push devices, logs, the kill switch) stops instead of overwriting real data with an empty copy.
const remember = (pathname, v) => { memo.set(pathname, { t: Date.now(), v }); if (memo.size > 100) memo.delete(memo.keys().next().value); };
export async function blobGetStrict(pathname, { fresh = true } = {}) {
  const base = blobBase(); if (!base) throw new Error('Blob store not connected (BLOB_READ_WRITE_TOKEN missing)');
  const m = memo.get(pathname); if (!fresh && m && Date.now() - m.t < 30e3) return m.v;
  const r = await fetch(`${base}/${pathname}${fresh ? `?v=${Date.now()}` : ''}`, { ...(fresh ? { cache: 'no-store' } : {}), signal: AbortSignal.timeout(T.read) });
  if (r.status === 404) { remember(pathname, null); return null; }
  if (!r.ok) throw new Error(`Blob read of ${pathname} failed (${r.status})`);
  const v = await r.json(); remember(pathname, v); return v; // a half-written or garbled file throws too
}
export async function blobGet(pathname, { fresh = false } = {}) {
  if (!blobBase()) return null;
  return blobGetStrict(pathname, { fresh }).catch(() => null); // v0.20.0: a failed read is no longer remembered for 30 s
}
// Small JSON files in the same store (e.g. the DCA training cache). Public store: never put secrets here.
export const blobReadJson = (pathname, opts) => blobGet(pathname, opts);
// Read-modify-write in one place: fn gets the current value (null when the file does not exist yet) and returns what to save
// (undefined = save nothing). A read error throws before anything is written.
export async function blobUpdate(pathname, fn, maxAge = 300) {
  const next = await fn(await blobGetStrict(pathname));
  if (next !== undefined) await blobPut(pathname, JSON.stringify(next), { maxAge });
  return next;
}
export const blobWriteJson = (pathname, obj, maxAge = 300) => blobPut(pathname, JSON.stringify(obj), { maxAge });
// Health probe: one write + one fresh read proves the token works AND that direct URLs point at this store.
export async function probeStore() {
  if (!env('BLOB_READ_WRITE_TOKEN')) return 'no token';
  try { const guess = blobBase(), at = Date.now(), j = await blobPut('health/probe.json', JSON.stringify({ at }), { maxAge: 60 });
    const back = await blobGet('health/probe.json', { fresh: true });
    return { ok: true, urlMatchesGuess: j.url === `${guess}/health/probe.json`, readBack: back?.at === at }; } catch (e) { return e.message.slice(0, 160); }
}
const subPath = (endpoint) => `push/sub-${crypto.createHash('sha1').update(endpoint).digest('hex')}.json`;

// Devices live in one index file (push/subs.json). Older builds kept one file per device: migrated once, then removed.
const SUBS = 'push/subs.json', SEEN = 'push/seen.json';
// v0.20.0 (audit #3): a read error throws instead of looking like "no devices", which used to save an empty list over them all.
async function readSubs() {
  const j = await blobGetStrict(SUBS); if (j) return Array.isArray(j.subs) ? j.subs : [];
  const old = await blobList('push/sub-').catch(() => null); if (!old) return []; // one-time migration (1 list), only after a confirmed 404
  const subs = (await Promise.all(old.map(async b => { const r = await fetch(`${b.url}?v=${Date.now()}`, { cache: 'no-store' }).catch(() => null); return r?.ok ? r.json().catch(() => null) : null; }))).filter(x => x?.endpoint);
  await blobPut(SUBS, JSON.stringify({ subs }), { maxAge: 60 }).catch(() => null);
  if (old.length) await blobDel(old.map(b => b.url)).catch(() => null);
  return subs;
}
export const listSubs = () => readSubs();
export async function addSub(s) {
  if (!pushHostOk(s?.endpoint) || !/^https:\/\/[\w.-]+\//.test(s.endpoint) || typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string' || s.endpoint.length > 1000 || s.keys.p256dh.length > 200 || s.keys.auth.length > 100) throw new Error('That does not look like a push subscription from a supported browser.');
  const subs = (await readSubs()).filter(x => x.endpoint !== s.endpoint);
  subs.push({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, added: new Date().toISOString() });
  await blobPut(SUBS, JSON.stringify({ subs: subs.slice(-20) }), { maxAge: 60 });
}
export async function removeSub(endpoint) { const subs = await readSubs(); await blobPut(SUBS, JSON.stringify({ subs: subs.filter(x => x.endpoint !== endpoint) }), { maxAge: 60 }); }
// "Last checked" time for fills; written only when it has to move (a fill was reported, or first run).
async function lastSeen() { const j = await blobGetStrict(SEEN); return { at: j?.at || null }; } // throws on a read error: fills are reported next run instead
async function markSeen(ms) { await blobPut(SEEN, JSON.stringify({ at: ms }), { maxAge: 60 }); }

// Send one notification to every signed-up device; drop devices the push service says are gone.
export async function notify(payload) {
  if (!pushReady().ok) return 0;
  const subs = await readSubs(); let sent = 0; const gone = [];
  await Promise.all(subs.map(async s => { const st = await sendOne(s, payload).catch(() => 0); if (st >= 200 && st < 300) sent++; else if (st === 404 || st === 410) gone.push(s.endpoint); }));
  if (gone.length) await blobPut(SUBS, JSON.stringify({ subs: subs.filter(x => !gone.includes(x.endpoint)) }), { maxAge: 60 }).catch(() => null);
  return sent;
}

// ---- after each bot run: what it did, plus stop/target fills since the last run ----
const flat = (s) => String(s || '').replace('/', '');
const money = (v) => (v < 0 ? '−$' : '+$') + Math.abs(v).toFixed(2);
export async function botNotify({ stocks, crypto: cr, dca, recent, runStart }) {
  if (!pushReady().ok) return { sent: 0 };
  const subs = await readSubs(); if (!subs.length) return { sent: 0 };
  const ev = [];
  for (const p of [...(stocks?.placed || []), ...(cr?.placed || [])]) if (!p.preview && !p.error)
    ev.push({ title: `Bot bought ${p.s}`, body: `${p.qty} @ ~${p.entry} · stop ${p.stop} · target ${p.target} · ${p.setup}${p.filler ? ' (filler, half size)' : ''}${p.jev?.q != null ? ` · AI score ${p.jev.q}/3` : ''}` });
  for (const x of [...(stocks?.exits || []), ...(cr?.exits || [])]) if (!x.preview && !/failed/.test(x.why || ''))
    ev.push({ title: `Bot sold ${x.s}`, body: String(x.why || '').replace(/^./, c => c.toUpperCase()) });
  for (const x of [...(stocks?.protect || []), ...(cr?.protect || [])]) if (!x.preview && /moved up to breakeven/.test(x.why || ''))
    ev.push({ title: `Stop moved to breakeven: ${x.s}`, body: `New stop ${x.stop}. This trade can no longer turn into a real loss (barring a gap).` });
  for (const d of dca?.started || []) if (!d.preview && d.status)
    ev.push({ title: `DCA deal started: ${d.s}`, body: `Bought $${d.usd} @ ~${d.fill || d.px} · take profit +${d.tp}% · up to ${d.n} dip buys · ${d.why}` });
  for (const x of dca?.exits || []) if (!x.preview && !x.error) ev.push({ title: `DCA hard exit: ${x.s}`, body: String(x.why || '').replace(/^./, c => c.toUpperCase()) });
  // stop / target orders that filled between runs (entries and the bot's own market exits are reported above)
  const seen = await lastSeen().catch(() => null); // unreadable: this run's own events still go out, fills wait for the next run
  if (seen?.at) {
    for (const o of recent || []) {                                            // DCA fills between runs: dip buys and take profits
      const m = /^tbdca-(\d{10})-[A-Z0-9]+-(s\d+|tp|ts)-/.exec(o.client_order_id || '');
      if (!m || !(+o.filled_qty > 0) || !o.filled_at || new Date(o.filled_at).getTime() <= seen.at) continue;
      const qty = +o.filled_qty, px = +o.filled_avg_price;
      if (!/^t[ps]$/.test(m[2])) { ev.push({ title: `DCA dip buy #${m[2].slice(1)} filled: ${o.symbol}`, body: `Bought ${qty} @ ${px} ($${(qty * px).toFixed(2)}). The take profit moves down to the new average on the next run.` }); continue; }
      const deal = (recent || []).filter(x => (x.client_order_id || '').startsWith(`tbdca-${m[1]}-`) && +x.filled_qty > 0);
      const cost = deal.filter(x => x.side === 'buy').reduce((a, x) => a + +x.filled_qty * +x.filled_avg_price, 0), got = deal.filter(x => x.side === 'sell').reduce((a, x) => a + +x.filled_qty * +x.filled_avg_price, 0);
      ev.push({ title: `DCA ${m[2] === 'ts' ? 'trailing ' : ''}take profit: ${o.symbol}`, body: `Sold ${qty} @ ${px}${cost ? ` · deal ${money(got - cost)}` : ''}` });
    }
    for (const o of recent || []) for (const x of [o, ...(o.legs || [])]) {
      if (x.status !== 'filled' || x.side !== 'sell' || !x.filled_at || new Date(x.filled_at).getTime() <= seen.at) continue;
      if (!/^tb(bot|prot|cstop|be)/.test(o.client_order_id || '') && !/^tbbe/.test(x.client_order_id || '')) continue;
      const entry = (recent || []).find(e => e.side === 'buy' && e.filled_at && /^tb(bot|cry)/.test(e.client_order_id || '') && flat(e.symbol) === flat(o.symbol) && e.filled_at < x.filled_at);
      const qty = +x.filled_qty, px = +x.filled_avg_price, pnl = entry ? (px - +entry.filled_avg_price) * qty : null;
      const kind = x.type === 'limit' ? 'Target hit' : pnl != null && pnl >= 0 ? 'Breakeven stop hit' : 'Stop hit';
      ev.push({ title: `${kind}: ${o.symbol}`, body: `Sold ${qty} @ ${px}${pnl != null ? ` · ${money(pnl)}` : ''}` });
    }
  }
  if (seen && (!seen.at || ev.length)) await markSeen(runStart).catch(() => null);         // only moves when something was reported
  if (!ev.length) return { sent: 0 };
  const batch = ev.length > 4 ? [{ title: `Bot: ${ev.length} updates`, body: ev.map(e => e.title).join(' · ').slice(0, 900) }] : ev;
  let sent = 0; for (const e of batch) sent += await notify({ ...e, url: '/#bot', tag: 'bot-' + e.title });
  return { sent, events: ev.length };
}
