// Local dev server (no Vercel CLI needed): serves the static front end and sends /api/* to api/router.js like vercel.json's rewrite.
// Run from the repo root: `npm run dev` (or `node scripts/dev-server.mjs`), then open http://localhost:3000. Env vars come from the
// shell (see .env.example). Listens on this computer only (HOST=0.0.0.0 to open it to your network) and never serves dotfiles
// (.env, .git) or files .vercelignore keeps off the real site, so it shows what production shows.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = process.cwd(); const router = await import(path.join(root, 'api/router.js'));
const hidden = fs.readFileSync(path.join(root, '.vercelignore'), 'utf8').split('\n').map(s => s.trim().replace(/\/$/, '')).filter(s => s && !s.startsWith('#'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const port = process.env.PORT ? +process.env.PORT : 3000, host = process.env.HOST || '127.0.0.1';
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const fn = router[req.method]; if (!fn) { res.writeHead(405); return res.end(); }
    try { const out = await fn(r); res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(Buffer.from(await out.arrayBuffer())); }
    catch (e) { console.error(e); res.writeHead(500); res.end('server error (see the terminal)'); }
    return;
  }
  let rel; try { rel = path.normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(/^[/\\]+/, ''); } catch { res.writeHead(400); return res.end('bad path'); }
  const p = path.join(root, rel), parts = rel.split(/[/\\]/), low = (s) => s.toLowerCase(); // lower-case: macOS and Windows disks ignore case
  if (!p.startsWith(root + path.sep) || parts.some(s => s.startsWith('.')) || hidden.some(h => low(h) === low(parts[0]) || low(h) === low(rel)) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).on('error', () => res.destroy()).pipe(res);
});
server.listen(port, host, () => console.log(`Paper Terminal dev server on http://${host === '127.0.0.1' ? 'localhost' : host}:${server.address().port}`));
