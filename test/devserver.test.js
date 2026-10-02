// The local dev server must not hand out secrets or repo-only files, and a bad URL must not kill it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const root = new URL('..', import.meta.url).pathname;
const srv = spawn(process.execPath, ['scripts/dev-server.mjs'], { cwd: root, env: { PATH: process.env.PATH, PORT: '0' } });
after(() => srv.kill());
const port = new Promise((ok, no) => { srv.stdout.on('data', d => { const m = /:(\d+)\s*$/m.exec(String(d)); if (m) ok(+m[1]); }); srv.on('exit', c => no(new Error('dev server exited ' + c))); });
// Raw paths (no URL normalising on the client side), so traversal attempts reach the server as written.
const get = async (path) => { const p = await port; return new Promise((ok, no) => request({ host: '127.0.0.1', port: p, path }, r => { r.resume(); ok(r.statusCode); }).on('error', no).end()); };

test('dev server refuses dotfiles, repo-only files and traversal, and survives bad escapes', async () => {
  for (const p of ['/%E0', '/.env', '/.env.example', '/.git/config', '/.vercelignore', '/%2e%2e/%2e%2e/etc/passwd', '/../../etc/passwd', '/HANDOFF.md', '/handoff.md',
    '/CLAUDE.md', '/test/helpers.js', '/scripts/dev-server.mjs', '/.claude/skills/steward/SKILL.md', '/.claude/agents/adversary-auditor.md', '/README.md']) assert.ok([400, 404].includes(await get(p)), p);
  assert.equal(await get('/'), 200, 'still up and serving the app');
  assert.equal(await get('/api/account'), 401);
});
