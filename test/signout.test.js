// Adversary checks on "Sign out everywhere" (v0.20.0, audit #13) across instances: a sign-in never overwrites a cut-off another
// instance saved, and a cold instance applies the stored cut-off as soon as it reads it. Module state matters, so the order of the
// tests matters too, and they live in their own file (own process).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setEnv, fakeFetch, req, status, PASS, CRON } from './helpers.js';
import { sessionOf, sessionToken, SESSION } from '../lib/core.js';
import { ensureSignOutFile, refreshSignOut } from '../lib/authguard.js';

const FILE = 'store5.public.blob.vercel-storage.com/control/signout.json';
let net;
afterEach(() => net?.restore());
const env = () => setEnv({ DASH_PASSCODE: PASS, CRON_SECRET: CRON, BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_STORE5_testsecret' });
const cookieOf = (t) => ({ cookie: `${SESSION.cookie}=${t.value}` });

test('a sign-in on a cold instance applies the stored sign-out at once', async () => {
  env(); const old = sessionToken(Date.now() - 36e5);
  net = fakeFetch({ [FILE]: { before: Date.now() - 6e4 } });
  await ensureSignOutFile();
  assert.equal(sessionOf(req('/', { headers: cookieOf(old) })), null, 'a cookie from before the cut-off is dead on this instance too');
  assert.equal(net.calls.filter(c => c.method === 'PUT').length, 0);
});

test('a sign-in never overwrites a cut-off another instance saved', async () => {
  env(); let saved = null;
  net = fakeFetch({ [FILE]: status(404), 'vercel.com/api/blob': (u, init) => init.headers['x-allow-overwrite'] === '1' || !saved ? (saved = init.body, {}) : status(409, { error: 'This blob already exists' }) });
  const real = Date.now, later = real() + 36e5; Date.now = () => later; // an hour on: past the refresh interval and the read memo
  try {
    await refreshSignOut(req('/', { headers: cookieOf(sessionToken()) })); // this instance saw "no file"
    saved = JSON.stringify({ before: later }); // meanwhile another instance signed everyone out
    await ensureSignOutFile();
  } finally { Date.now = real; }
  const puts = net.calls.filter(c => c.method === 'PUT');
  assert.equal(puts.length, 1); assert.equal(puts[0].headers['x-allow-overwrite'], '0', 'create-only');
  assert.notEqual(JSON.parse(saved).before, 0, 'the real cut-off survives');
});
