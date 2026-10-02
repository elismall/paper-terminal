// Repo invariants: things an attacker or a stale edit could break without any single route test noticing.
// Each failure message says what to fix. Keep this file's checks cheap (no network, no app state).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ls = (d) => readdirSync(new URL(`../${d}/`, import.meta.url)).filter(f => f.endsWith('.js'));
const SERVER = [...ls('lib').map(f => `lib/${f}`), ...ls('routes').map(f => `routes/${f}`), 'api/router.js'];
const handlers = (src) => [...src.matchAll(/export (?:async )?(?:function|const) (GET|POST|DELETE)\b([\s\S]*?)(?=\nexport |$)/g)].map(m => ({ method: m[1], body: m[2] }));

test('every route file is wired into the router, and the router names no missing file', () => {
  const src = read('api/router.js');
  const imported = [...src.matchAll(/from '\.\.\/routes\/([\w-]+)\.js'/g)].map(m => `${m[1]}.js`).sort();
  assert.deepEqual(imported, ls('routes').sort(), 'api/router.js imports and routes/ disagree');
});

test('every route handler checks sign-in or the cron secret (session is the sign-in itself)', () => {
  for (const f of ls('routes')) {
    if (f === 'session.js') continue;
    for (const h of handlers(read(`routes/${f}`))) assert.match(h.body, /authorized\(|isCron\(|cronOk\(|runBot\(/, `routes/${f} ${h.method} has no auth check`);
  }
});

test('every POST and DELETE handler needs a signed-in device (strict)', () => {
  for (const f of ls('routes')) {
    if (f === 'session.js') continue;
    for (const h of handlers(read(`routes/${f}`))) if (h.method !== 'GET') assert.match(h.body, /authorized\(req, \{ strict: true \}\)/, `routes/${f} ${h.method} must use authorized(req, { strict: true })`);
  }
});

test('security headers stay strict', () => {
  const H = Object.fromEntries(JSON.parse(read('vercel.json')).headers.find(h => h.source === '/(.*)').headers.map(h => [h.key, h.value]));
  const csp = Object.fromEntries(H['Content-Security-Policy'].split(';').map(s => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(csp['script-src'], ["'self'"], 'script-src must stay self only (no inline, eval or CDNs)');
  assert.deepEqual(csp['connect-src'], ["'self'"], 'the browser talks only to this app');
  for (const [k, v] of [['frame-ancestors', "'none'"], ['object-src', "'none'"], ['base-uri', "'none'"]]) assert.deepEqual(csp[k], [v], k);
  assert.equal(H['X-Frame-Options'], 'DENY'); assert.equal(H['X-Content-Type-Options'], 'nosniff'); assert.equal(H['Referrer-Policy'], 'no-referrer');
  assert.match(H['Strict-Transport-Security'], /max-age=\d{8,}/);
});

test('index.html loads exactly the files in js/, and nothing from another site', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scripts.map(s => s.replace(/^\/js\//, '')).sort(), ls('js').sort(), 'a js/ file is missing from index.html or a script tag points at a missing file');
  assert.ok(!/<script\b(?![^>]*\bsrc=)[^>]*>/.test(html), 'no inline scripts (the CSP blocks them anyway)');
});

test('no eval, no secrets in the browser code, no keys committed', () => {
  for (const f of [...SERVER, ...ls('js').map(f => `js/${f}`), 'sw.js']) {
    const src = read(f);
    assert.ok(!/\beval\(|new Function\(/.test(src), `${f}: eval / new Function`);
    assert.ok(!/\b(PK|AK)[A-Z0-9]{16,}\b/.test(src), `${f}: looks like an Alpaca key`);
    assert.ok(!/vercel_blob_rw_[A-Za-z0-9]{8,}/.test(src), `${f}: looks like a Blob token`);
    if (f.startsWith('js/') || f === 'sw.js') assert.ok(!/process\.env|env\('/.test(src), `${f}: browser code cannot read server settings`);
  }
  const tracked = execFileSync('git', ['ls-files'], { cwd: new URL('..', import.meta.url) }).toString().split('\n');
  assert.ok(!tracked.some(f => /(^|\/)\.env(\.|$)(?!example$)/.test(f) && f !== '.env.example'), 'a .env file is committed');
});

test('.env.example documents every setting the server reads', () => {
  const used = new Set(SERVER.flatMap(f => [...read(f).matchAll(/env\('([A-Z_]+)'\)/g)].map(m => m[1])));
  const documented = new Set([...read('.env.example').matchAll(/^([A-Z_]+)=/gm)].map(m => m[1]));
  const missing = [...used].filter(k => !documented.has(k) && !k.startsWith('VERCEL_')); // VERCEL_* are set by Vercel itself
  assert.deepEqual(missing, [], 'add these to .env.example');
});

test('one version everywhere, and the handoff names it', () => {
  const v = /VERSION = '(\d+\.\d+\.\d+)'/.exec(read('lib/version.js'))?.[1];
  assert.ok(v, 'lib/version.js VERSION must be x.y.z');
  assert.match(read('HANDOFF.md'), new RegExp(`\\*\\*Current version:\\*\\* ${v.replace(/\./g, '\\.')}\\b`), 'HANDOFF.md "Current version" is stale');
});

test('repo-only files are kept off the public site', () => {
  // Vercel serves every file in the repo as a static page unless .vercelignore lists it.
  const ignored = read('.vercelignore').split('\n').map(s => s.trim()).filter(Boolean);
  for (const p of ['test/', 'scripts/', '.claude/', '.github/', 'HANDOFF.md', 'CLAUDE.md', '.env.example']) {
    if (existsSync(new URL(`../${p}`, import.meta.url))) assert.ok(ignored.includes(p) || ignored.includes(p.replace(/\/$/, '')), `.vercelignore must list ${p}`);
  }
});

test('every server file parses', () => {
  for (const f of [...SERVER, ...ls('js').map(f => `js/${f}`), 'sw.js']) execFileSync(process.execPath, ['--check', new URL(`../${f}`, import.meta.url).pathname]);
});
