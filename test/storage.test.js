// Adversary checks on storage (v0.20.0, audit #2, #3, #12, #13): a Blob read that fails must never look like "no file" to code
// that saves what it read, the kill switch and run lock fail closed, and push devices can only point at real push services.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setEnv, fakeFetch, status } from './helpers.js';
import { blobGet, blobGetStrict, blobUpdate, listSubs, addSub, pushHostOk } from '../lib/notify.js';
import { getMode, checkLock, ladder, eveningDone, saveLastRun } from '../lib/control.js';
import { saveDaily } from '../lib/history.js';

const STORE = 'https://store1.public.blob.vercel-storage.com';
let net;
beforeEach(() => setEnv({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_STORE1_testsecret', ALPACA_KEY_ID: 'PKTEST', ALPACA_SECRET_KEY: 'sk-test' }));
afterEach(() => net?.restore());
const puts = () => net.calls.filter(c => c.method === 'PUT');
const down = () => { throw new Error('socket hang up'); };

test('strict reads: 404 is "missing", anything else throws; lenient reads do not remember a failure', async () => {
  net = fakeFetch({ [`${STORE}/a.json`]: status(404), [`${STORE}/b.json`]: status(503), [`${STORE}/c.json`]: down, [`${STORE}/d.json`]: { ok: 1 } });
  assert.equal(await blobGetStrict('a.json'), null);
  await assert.rejects(blobGetStrict('b.json'), /503/);
  await assert.rejects(blobGetStrict('c.json'));
  assert.deepEqual(await blobGetStrict('d.json'), { ok: 1 });
  assert.equal(await blobGet('b.json'), null);
  net.restore(); net = fakeFetch({ [`${STORE}/b.json`]: { back: true } });
  assert.deepEqual(await blobGet('b.json'), { back: true }, 'a failed read must not be cached as null for 30 s');
});

test('read-modify-write never saves after a failed read', async () => {
  net = fakeFetch({ [`${STORE}/stats/history.json`]: status(500), 'vercel.com/api/blob': {} });
  await assert.rejects(saveDaily({ d: '2026-10-08' }));
  await assert.rejects(blobUpdate('stats/history.json', () => ({ days: [] })));
  assert.equal(puts().length, 0, 'the scoreboard must not be overwritten');
});

test('a missing file is created; an existing one is extended', async () => {
  net = fakeFetch({ [`${STORE}/stats/history.json`]: { days: [{ d: '2026-10-07' }] }, 'vercel.com/api/blob': {} });
  const h = await saveDaily({ d: '2026-10-08' });
  assert.deepEqual(h.days.map(x => x.d), ['2026-10-07', '2026-10-08']);
  assert.equal(puts().length, 1);
});

test('push devices: an unreadable list throws instead of being saved as empty', async () => {
  net = fakeFetch({ [`${STORE}/push/subs.json`]: status(502), 'vercel.com/api/blob': { blobs: [] } });
  await assert.rejects(listSubs());
  await assert.rejects(addSub({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } }));
  assert.equal(puts().length, 0, 'saved devices must survive a storage hiccup');
});

test('push devices: only the browsers\' own push services are accepted', async () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://web.push.apple.com/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-by3p.notify.windows.com/w/?token=x'])
    assert.equal(pushHostOk(ok), true, ok);
  for (const bad of ['https://evil.test/x', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://fcm.googleapis.com.evil.test/x', 'https://169.254.169.254/latest', 'https://apple.com.evil.test/push.apple.com', 'not a url'])
    assert.equal(pushHostOk(bad), false, bad);
  net = fakeFetch({});
  await assert.rejects(addSub({ endpoint: 'https://evil.test/hook', keys: { p256dh: 'p', auth: 'a' } }), /supported browser/);
  assert.equal(net.calls.length, 0);
});

test('kill switch fails closed: an unreadable state blocks new trades and is never overwritten', async () => {
  net = fakeFetch({ [`${STORE}/control/mode.json`]: status(500), 'vercel.com/api/blob': { blobs: [] } });
  await assert.rejects(getMode({ fresh: true }));
  const s = await ladder({ dry: true, clock: { is_open: false }, equity: 1000, last: 1000 });
  assert.ok(s.level >= 3, 'no new trades');
  assert.deepEqual(s.entries, { stocks: false, crypto: false, dca: false });
  assert.ok(s.reasons.some(r => /kill switch state could not be read/.test(r)), s.reasons.join(' | '));
  assert.equal(puts().length, 0, 'never saves "run" over an unreadable pause');
});

test('kill switch: a stored pause is honored', async () => {
  net = fakeFetch({ [`${STORE}/control/mode.json`]: { mode: 'pause', by: 'you' } });
  const s = await ladder({ dry: true, clock: { is_open: false }, equity: 1000, last: 1000 });
  assert.equal(s.level, 4); assert.equal(s.mode, 'pause');
});

test('run lock: an unreadable lock is "unconfirmed" (no new trades), not "free"', async () => {
  net = fakeFetch({ [`${STORE}/control/lock.json`]: status(503) });
  assert.equal((await checkLock()).unconfirmed, true);
  net.restore(); net = fakeFetch({ [`${STORE}/control/lock.json`]: { at: Date.now() } });
  assert.equal(await checkLock(), null, 'a fresh lock means another run is working');
  net.restore(); net = fakeFetch({ [`${STORE}/control/lock.json`]: status(404) });
  assert.equal((await checkLock()).checked, true);
});

test('evening run marker: done, not done, or unknown', async () => {
  net = fakeFetch({ [`${STORE}/control/last.json`]: { evening: '2026-10-08' } });
  assert.equal(await eveningDone('2026-10-08'), true);
  assert.equal(await eveningDone('2026-10-09'), false);
  net.restore(); net = fakeFetch({ [`${STORE}/control/last.json`]: status(500) });
  assert.equal(await eveningDone('2026-10-08'), null);
});

test('a manual crypto run before 7 PM does not mark the evening run done; one after 7 PM does', async () => {
  net = fakeFetch({ [`${STORE}/control/last.json`]: { evening: '2026-10-07' }, 'vercel.com/api/blob': {} });
  await saveLastRun({ slot: 'cx', level: 1 }, Date.parse('2026-10-08T16:00:00Z')); // noon EDT
  assert.equal(JSON.parse(puts()[0].body).evening, '2026-10-07', 'noon run keeps yesterday\'s marker');
  await saveLastRun({ slot: 'cx', level: 1 }, Date.parse('2026-10-08T23:05:00Z')); // 7:05 PM EDT
  assert.equal(JSON.parse(puts()[1].body).evening, '2026-10-08');
});

test('kill switch: a 404 at the guessed address never overwrites a mode.json the store lists', async () => {
  const REAL = 'https://real-store.public.blob.vercel-storage.com/control/mode.json';
  net = fakeFetch({ [`${STORE}/control/mode.json`]: status(404), [REAL]: { mode: 'pause', by: 'you' },
    'vercel.com/api/blob?': { blobs: [{ pathname: 'control/mode.json', url: REAL }] }, 'vercel.com/api/blob': {} });
  assert.equal((await getMode({ fresh: true })).mode, 'pause');
  assert.equal(puts().length, 0, 'the pause is never overwritten with "run"');
});
