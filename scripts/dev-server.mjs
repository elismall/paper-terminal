// Local dev server (no Vercel CLI needed): serves the static front end and sends /api/* to api/router.js like vercel.json's rewrite.
// Run from the repo root: `node scripts/dev-server.mjs`, then open http://localhost:3000. Env vars come from the shell (see .env.example).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = process.cwd(); const router = await import(path.join(root,'api/router.js'));
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
http.createServer(async (req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks=[]; for await (const c of req) chunks.push(c);
    const r = new Request(url, {method:req.method, headers:req.headers, body: ['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
    const fn = router[req.method]; if(!fn){res.writeHead(405);return res.end();}
    try { const out = await fn(r); res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(Buffer.from(await out.arrayBuffer())); }
    catch(e){ res.writeHead(500); res.end('THROWN: '+e.stack); }
    return;
  }
  const p = path.join(root, url.pathname==='/'?'index.html':url.pathname);
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200,{'content-type':types[path.extname(p)]||'application/octet-stream'}); fs.createReadStream(p).pipe(res);
}).listen(process.env.PORT || 3000, ()=>console.log(`Paper Terminal dev server on http://localhost:${process.env.PORT || 3000}`));
