// Shared test helpers. No dependencies: node:test + the app's own modules, with process.env and fetch faked per test.
export const HOST = 'https://pt.test';
export const PASS = 'correct horse battery staple';
export const CRON = 'c'.repeat(48);
const KEYS = ['DASH_PASSCODE', 'CRON_SECRET', 'ALPACA_KEY_ID', 'ALPACA_SECRET_KEY', 'BLOB_READ_WRITE_TOKEN', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY',
  'TRADING_MODE', 'LIVE_CONFIRM', 'ALPACA_LIVE_KEY_ID', 'ALPACA_LIVE_SECRET_KEY', 'LIVE_MAX_USD', 'BOT_PAUSED', 'TYPESAFE_API_KEY', 'FRED_API_KEY'];
// A clean environment: only the keys given are set (Blob and push stay off, so nothing reaches the network).
export function setEnv(vars = {}) { for (const k of KEYS) delete process.env[k]; Object.assign(process.env, vars); }
export const signedOut = () => setEnv({ DASH_PASSCODE: PASS, CRON_SECRET: CRON, ALPACA_KEY_ID: 'PKTEST', ALPACA_SECRET_KEY: 'sk-test' });

// fetch stand-in: records every call and answers from `routes` ({ 'substring of url': body | (url, init) => body }).
// Anything unmatched throws, so a test fails loudly if code reaches a service it should not.
export function fakeFetch(routes = {}) {
  const calls = [], real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    url = String(url); calls.push({ url, method: init.method || 'GET', body: init.body });
    const k = Object.keys(routes).find(k => url.includes(k));
    if (!k) throw new Error(`unexpected network call: ${init.method || 'GET'} ${url}`);
    const v = typeof routes[k] === 'function' ? routes[k](url, init) : routes[k];
    return new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

export const req = (path, { method = 'GET', headers = {}, body } = {}) =>
  new Request(HOST + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
