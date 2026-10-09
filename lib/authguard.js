// Passcode lockout (v0.17.0, hardened v0.20.0). Wrong passcodes are counted per device (hashed IP) and in total:
//   5 wrong in 15 minutes from one IP  -> that IP is locked out for 15 minutes, doubling on each repeat (max 24 hours);
//   25 wrong in 1 hour from anywhere    -> every new sign-in is locked for 1 hour, doubling on each repeat within a day (max 24 hours).
// v0.20.0 (audit #5): every attempt is counted BEFORE its passcode is checked (and un-counted if it was right), so firing many
// guesses at once no longer lets them all through before the first failure is recorded.
// v0.20.0 (audit #10): a device that holds this site's session cookie (still valid, or expired within the last 30 days) is not
// stopped by the "everyone" lock, so a stranger flooding wrong guesses cannot lock the owner out of their own devices.
// Counting happens in memory (Vercel reuses warm instances); only a lockout is written to Blob (control/auth-guard.json), so
// a flood of wrong guesses costs at most a handful of Blob writes (Hobby allows 2,000 a month). Other instances see a lockout
// through the CDN copy (up to about 90 s late); fresh reads would spend the store's monthly read allowance under a flood. The store
// is public: IPs are saved only as a keyed hash, never in the clear. Each lockout also sends a push notification so the owner sees it.
// v0.20.0 (audit #13): "Sign out everywhere" also lives here: control/signout.json holds a time (nothing secret); sessions issued
// before it stop working. Reads cost from the store's monthly allowance, so only requests that carry a session cookie refresh it,
// at most every 30 minutes per instance, through the CDN copy (cached 30 minutes). Other instances can therefore honor a sign-out
// up to about an hour late; changing CRON_SECRET in Vercel signs everyone out at once.
import { createHmac } from 'node:crypto';
import { env, sessionOf, setSignedOutBefore, SESSION } from './core.js';
import { blobGet, blobGetStrict, blobPut, notify } from './notify.js';

export const GUARD = { file: 'control/auth-guard.json', ipMax: 5, ipWinMs: 15 * 6e4, ipLockMs: 15 * 6e4, ipLockMaxMs: 864e5, allMax: 25, allWinMs: 36e5, allLockMs: 36e5, allLockMaxMs: 864e5, maxWritesPerHour: 6, failDelayMs: 400, graceDays: 30 };
const mem = { ips: new Map(), all: [], writes: [], allUntil: 0 };
export const _resetGuard = () => { mem.ips.clear(); mem.all.length = 0; mem.writes.length = 0; mem.allUntil = 0; };

export function clientIp(req) {
  const h = req.headers;
  return (h.get('x-real-ip') || (h.get('x-forwarded-for') || '').split(',')[0] || 'unknown').trim().slice(0, 64);
}
const ipKey = (ip) => createHmac('sha256', 'tb-guard-v1').update(`${ip}\n${env('CRON_SECRET')}\n${env('DASH_PASSCODE')}`).digest('base64url').slice(0, 22);
const slot = (k) => { let m = mem.ips.get(k); if (!m) { m = { fails: [], locks: 0, until: 0 }; mem.ips.set(k, m); } return m; };
const prune = (m, now) => { m.fails = m.fails.filter(t => now - t < GUARD.ipWinMs); mem.all = mem.all.filter(t => now - t < GUARD.allWinMs); };

async function readGuard() { return (await blobGet(GUARD.file).catch(() => null)) || { ips: {}, all: 0 }; }
async function writeGuard(g, now) {
  mem.writes = mem.writes.filter(t => now - t < 36e5);
  if (mem.writes.length >= GUARD.maxWritesPerHour) return false; // cap Blob writes under a flood; memory still enforces
  mem.writes.push(now);
  for (const [k, u] of Object.entries(g.ips || {})) if (u.until < now - GUARD.ipLockMaxMs) delete g.ips[k]; // forget old entries
  await blobPut(GUARD.file, JSON.stringify(g), { maxAge: 60 }).catch(() => null);
  return true;
}
const lockedOut = (until, now, everyone) => ({ locked: true, until, retryAfter: Math.max(1, Math.ceil((until - now) / 1000)), everyone });

// Before checking a passcode: is this IP (or everyone) locked out right now? If not, the attempt is counted now and the answer
// carries its ticket `t` (recordOk takes it back when the passcode was right).
export async function lockState(req, now = Date.now()) {
  const k = ipKey(clientIp(req)), m = slot(k), g = await readGuard();
  const owner = !!sessionOf(req, { graceDays: GUARD.graceDays });
  const all = owner ? 0 : Math.max(g.all || 0, mem.allUntil);
  const until = Math.max(m.until, g.ips?.[k]?.until || 0, all);
  if (until > now) return lockedOut(until, now, all >= until);
  prune(m, now);
  if (m.fails.length >= GUARD.ipMax) return lockedOut(now + GUARD.ipWinMs, now, false);            // guesses still in flight fill the window
  if (!owner && mem.all.length >= GUARD.allMax) return lockedOut(now + GUARD.allWinMs, now, true);
  m.fails.push(now); mem.all.push(now);
  return { locked: false, t: now };
}

// After a wrong passcode (already counted by lockState). Returns the lock if this attempt triggered one.
export async function recordFail(req, now = Date.now()) {
  const k = ipKey(clientIp(req)), m = slot(k);
  prune(m, now);
  let lock = null;
  if (mem.all.length >= GUARD.allMax) {
    const g = await readGuard(), repeat = g.allAt && now - g.allAt < 864e5 ? g.allLocks || 0 : 0;
    g.allLocks = repeat + 1; g.allAt = now; g.all = now + Math.min(GUARD.allLockMs * 2 ** repeat, GUARD.allLockMaxMs);
    mem.allUntil = g.all; mem.all.length = 0;
    lock = { everyone: true, until: g.all }; await writeGuard(g, now);
  } else if (m.fails.length >= GUARD.ipMax) {
    const g = await readGuard(); const prev = g.ips?.[k];
    m.locks = Math.max(m.locks, prev?.locks || 0) + 1; m.until = now + Math.min(GUARD.ipLockMs * 2 ** (m.locks - 1), GUARD.ipLockMaxMs); m.fails = [];
    g.ips = { ...(g.ips || {}), [k]: { until: m.until, locks: m.locks } };
    lock = { everyone: false, until: m.until }; await writeGuard(g, now);
  }
  if (lock) {
    const mins = Math.round((lock.until - now) / 6e4);
    await notify({ title: 'Security: sign-ins locked', body: lock.everyone ? `Too many wrong passcodes from several devices. New sign-ins are locked for ${mins} minutes; devices that were signed in before keep working.` : `5 wrong passcodes from one device. That device is locked out for ${mins} minutes.`, tag: 'auth-lock', url: '/#bot' }).catch(() => 0);
  }
  await new Promise(r => setTimeout(r, GUARD.failDelayMs)); // slows guessing
  return lock;
}

// After a correct passcode: take this attempt back out of the totals and forget this IP's recent misses (memory only; a Blob
// lock simply expires).
export function recordOk(req, t) {
  const m = mem.ips.get(ipKey(clientIp(req))); if (m) m.fails = [];
  const i = mem.all.lastIndexOf(t); if (i >= 0) mem.all.splice(i, 1);
}

// ---- sign out everywhere ----
const SIGNOUT = 'control/signout.json', SO = { every: 30 * 6e4, at: 0, missing: false };
export async function refreshSignOut(req, now = Date.now()) {
  if (!(req.headers.get('cookie') || '').includes(SESSION.cookie + '=') || now - SO.at < SO.every) return; SO.at = now;
  // unreadable: keep what this instance knew (signing everyone out on a storage hiccup would lock you out of the kill switch)
  const j = await blobGetStrict(SIGNOUT, { fresh: false }).then(v => { SO.missing = !v; return v; }).catch(() => null);
  if (j?.before) setSignedOutBefore(j.before);
}
// After a sign-in: make sure the file exists, because the CDN does not cache a missing file and every check would then be a paid
// read. One write the first time only.
export async function ensureSignOutFile() {
  if (!SO.at) { SO.missing = (await blobGetStrict(SIGNOUT, { fresh: false }).catch(() => 'unread')) === null; SO.at = Date.now(); }
  if (SO.missing) { await blobPut(SIGNOUT, JSON.stringify({ before: 0 }), { maxAge: 1800 }).catch(() => null); SO.missing = false; }
}
export async function signOutEverywhere(now = Date.now()) {
  const before = Math.floor(now / 1000) * 1000;
  await blobPut(SIGNOUT, JSON.stringify({ before }), { maxAge: 1800 }); SO.missing = false;
  setSignedOutBefore(before);
  return before;
}
