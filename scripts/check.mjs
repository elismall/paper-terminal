// Repo drift check (no dependencies): `node scripts/check.mjs`. Exits 1 on any problem. Run it before every push.
// 1. Every .js/.mjs file parses (node --check).
// 2. Every routes/*.js file is registered in api/router.js, and every route the router names has a file.
// 3. Every env var the server code reads is documented in .env.example (platform-provided VERCEL_* vars excepted).
// 4. Every js/*.js file is loaded by index.html, and every script index.html loads exists.
// 5. HANDOFF.md names the same version as lib/version.js (so the handoff never goes stale).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const ls = (d, re) => readdirSync(join(root, d)).filter(f => re.test(f)).map(f => `${d}/${f}`);
const problems = [];

const code = [...ls('api', /\.js$/), ...ls('lib', /\.js$/), ...ls('routes', /\.js$/), ...ls('js', /\.js$/), ...ls('scripts', /\.m?js$/), 'sw.js'];
for (const f of code) {
  try { execFileSync(process.execPath, ['--check', join(root, f)], { stdio: 'pipe' }); }
  catch (e) { problems.push(`syntax: ${f}: ${String(e.stderr || e.message).split('\n').slice(0, 4).join(' ')}`); }
}

const router = read('api/router.js');
const imported = new Set([...router.matchAll(/from '\.\.\/routes\/([\w-]+)\.js'/g)].map(m => m[1]));
for (const f of ls('routes', /\.js$/)) {
  const name = f.slice('routes/'.length, -3);
  if (!imported.has(name)) problems.push(`router: routes/${name}.js is not imported in api/router.js (unreachable)`);
}
for (const name of imported) if (!existsSync(join(root, 'routes', `${name}.js`))) problems.push(`router: api/router.js imports missing routes/${name}.js`);

const documented = new Set([...read('.env.example').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(m => m[1]));
const used = new Set();
for (const f of [...ls('api', /\.js$/), ...ls('lib', /\.js$/), ...ls('routes', /\.js$/)]) {
  for (const m of read(f).matchAll(/env\('([A-Z][A-Z0-9_]*)'\)|process\.env\.([A-Z][A-Z0-9_]*)/g)) used.add(m[1] || m[2]);
}
for (const k of used) if (!k.startsWith('VERCEL_') && !documented.has(k)) problems.push(`env: ${k} is read by the code but missing from .env.example`);
for (const k of documented) if (!used.has(k)) problems.push(`env: ${k} is in .env.example but no server code reads it`);

const html = read('index.html');
const loaded = new Set([...html.matchAll(/<script[^>]+src="\/?([^"?]+)/g)].map(m => m[1]));
for (const f of ls('js', /\.js$/)) if (!loaded.has(f)) problems.push(`client: ${f} is not loaded by index.html`);
for (const f of loaded) if (!existsSync(join(root, f))) problems.push(`client: index.html loads missing ${f}`);

const version = (read('lib/version.js').match(/VERSION = '([^']+)'/) || [])[1];
const handoff = existsSync(join(root, 'HANDOFF.md')) ? read('HANDOFF.md') : '';
if (!handoff) problems.push('handoff: HANDOFF.md is missing');
else if (!handoff.includes(`v${version}`)) problems.push(`handoff: HANDOFF.md does not mention the current version v${version}; update it`);

if (problems.length) { console.error(`check: ${problems.length} problem(s)\n- ${problems.join('\n- ')}`); process.exit(1); }
console.log(`check: ok (${code.length} files, ${imported.size} routes, ${used.size} env vars, v${version})`);
