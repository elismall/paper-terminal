// Adversary checks on the kill switch (lib/control.js, issue #2): when storage can't be read, Pause must never turn into "run",
// a run must not take over another run's lock, and nothing may overwrite the saved state.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setEnv } from './helpers.js';
import { getMode, checkLock, acquireLock, ladder } from '../lib/control.js';

const STORE = { BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_TESTSTORE_secret' };
const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });
// Every request is recorded; reads of the public store get `read(url)`, Blob API calls get `api(url, init)`, anything else fails.
function storage({ read, api = () => { throw new Error('unexpected Blob API call'); } }) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    url = String(url); calls.push({ url, method: init.method || 'GET' });
    if (url.includes('.public.blob.vercel-storage.com/')) return read(url);
    if (url.startsWith('https://vercel.com/api/blob')) return api(url, init);
    throw new Error('offline');
  };
  return calls;
}
const res = (status, body = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const writes = (calls) => calls.filter(c => c.method !== 'GET');

test('an unreadable kill switch throws instead of reading as "run", and writes nothing', async () => {
  setEnv(STORE);
  for (const read of [() => res(500), () => res(403), () => { throw new Error('network down'); }, () => new Response('not json', { status: 200 })]) {
    const calls = storage({ read });
    await assert.rejects(getMode({ fresh: true }));
    assert.deepEqual(writes(calls), [], 'no write after a failed read');
  }
});

test('the ladder blocks new trades when the kill switch cannot be read', async () => {
  setEnv({ ...STORE, ALPACA_KEY_ID: 'PKTEST', ALPACA_SECRET_KEY: 'sk-test' });
  storage({ read: () => res(500) });
  const s = await ladder({ dry: true, clock: { is_open: false }, equity: 1000, last: 1000 });
  assert.ok(s.level >= 3, 'level ' + s.level);
  assert.deepEqual(s.entries, { stocks: false, crypto: false, dca: false });
  assert.ok(s.reasons.some(r => /kill switch state could not be read/.test(r)));
});

test('a lock read error is unconfirmed (no new trades), and never deletes the holder\'s lock', async () => {
  setEnv(STORE);
  storage({ read: () => res(503) });
  assert.equal((await checkLock()).unconfirmed, true);
  const calls = storage({ read: () => res(503), api: (url, init) => init.method === 'PUT' ? res(409, { error: 'already exists' }) : res(200) });
  assert.equal((await acquireLock()).unconfirmed, true);
  assert.ok(!calls.some(c => c.url.includes('/delete')), 'must not delete a lock it could not read');
});

test('a confirmed-missing state still reads as "run" (fresh install)', async () => {
  setEnv(STORE);
  storage({ read: () => res(404), api: (url) => url.includes('prefix=') ? res(200, { blobs: [] }) : res(200, { url: 'https://teststore.public.blob.vercel-storage.com/control/mode.json' }) });
  assert.equal((await getMode({ fresh: true })).mode, 'run');
});
