// Passcode lockout (v0.17.0). Wrong passcodes are counted per device (hashed IP) and in total:
//   5 wrong in 15 minutes from one IP  -> that IP is locked out for 15 minutes, doubling on each repeat (max 24 hours);
//   25 wrong in 1 hour from anywhere    -> every new sign-in is locked for 1 hour (signed-in devices keep working).
// Counting happens in memory (Vercel reuses warm instances); only a lockout is written to Blob (control/auth-guard.json), so
// a flood of wrong guesses costs at most a handful of Blob writes (Hobby allows 2,000 a month). The store is public: IPs are
// saved only as a keyed hash, never in the clear. Each lockout also sends a push notification so the owner sees it.
import { createHmac } from 'node:crypto';
import { env } from './core.js';
import { blobGet, blobPut, notify } from './notify.js';

export const GUARD = { file: 'control/auth-guard.json', ipMax: 5, ipWinMs: 15 * 6e4, ipLockMs: 15 * 6e4, ipLockMaxMs: 864e5, allMax: 25, allWinMs: 36e5, allLockMs: 36e5, maxWritesPerHour: 6, failDelayMs: 400 };
const mem = { ips: new Map(), all: [], writes: [] };
export const _resetGuard = () => { mem.ips.clear(); mem.all.length = 0; mem.writes.length = 0; };

export function clientIp(req) {
  const h = req.headers;
  return (h.get('x-real-ip') || (h.get('x-forwarded-for') || '').split(',')[0] || 'unknown').trim().slice(0, 64);
}
const ipKey = (ip) => createHmac('sha256', 'tb-guard-v1').update(`${ip}\n${env('CRON_SECRET')}\n${env('DASH_PASSCODE')}`).digest('base64url').slice(0, 22);

async function readGuard() { return (await blobGet(GUARD.file).catch(() => null)) || { ips: {}, all: 0 }; }
async function writeGuard(g, now) {
  mem.writes = mem.writes.filter(t => now - t < 36e5);
  if (mem.writes.length >= GUARD.maxWritesPerHour) return false; // cap Blob writes under a flood; memory still enforces
  mem.writes.push(now);
  for (const [k, u] of Object.entries(g.ips)) if (u.until < now - GUARD.ipLockMaxMs) delete g.ips[k]; // forget old entries
  await blobPut(GUARD.file, JSON.stringify(g), { maxAge: 60 }).catch(() => null);
  return true;
}

// Before checking a passcode: is this IP (or everyone) locked out right now?
export async function lockState(req, now = Date.now()) {
  const k = ipKey(clientIp(req)), m = mem.ips.get(k), g = await readGuard();
  const until = Math.max(m?.until || 0, g.ips?.[k]?.until || 0, g.all || 0);
  return until > now ? { locked: true, until, retryAfter: Math.ceil((until - now) / 1000), everyone: (g.all || 0) > now } : { locked: false };
}

// After a wrong passcode. Returns the lock if this attempt triggered one.
export async function recordFail(req, now = Date.now()) {
  const k = ipKey(clientIp(req));
  const m = mem.ips.get(k) || { fails: [], locks: 0, until: 0 };
  m.fails = m.fails.filter(t => now - t < GUARD.ipWinMs); m.fails.push(now); mem.ips.set(k, m);
  mem.all = mem.all.filter(t => now - t < GUARD.allWinMs); mem.all.push(now);
  let lock = null;
  if (mem.all.length >= GUARD.allMax) {
    const g = await readGuard(); g.all = now + GUARD.allLockMs; mem.all.length = 0;
    lock = { everyone: true, until: g.all }; await writeGuard(g, now);
  } else if (m.fails.length >= GUARD.ipMax) {
    const g = await readGuard(); const prev = g.ips?.[k];
    m.locks = Math.max(m.locks, prev?.locks || 0) + 1; m.until = now + Math.min(GUARD.ipLockMs * 2 ** (m.locks - 1), GUARD.ipLockMaxMs); m.fails = [];
    g.ips = { ...(g.ips || {}), [k]: { until: m.until, locks: m.locks } };
    lock = { everyone: false, until: m.until }; await writeGuard(g, now);
  }
  if (lock) {
    const mins = Math.round((lock.until - now) / 6e4);
    await notify({ title: 'Security: sign-ins locked', body: lock.everyone ? `Too many wrong passcodes from several devices. New sign-ins are locked for ${mins} minutes; signed-in devices keep working.` : `5 wrong passcodes from one device. That device is locked out for ${mins} minutes.`, tag: 'auth-lock', url: '/#bot' }).catch(() => 0);
  }
  await new Promise(r => setTimeout(r, GUARD.failDelayMs)); // slows guessing
  return lock;
}

// After a correct passcode: forget this IP's recent misses (memory only; a Blob lock simply expires).
export function recordOk(req) { const k = ipKey(clientIp(req)), m = mem.ips.get(k); if (m) m.fails = []; }
