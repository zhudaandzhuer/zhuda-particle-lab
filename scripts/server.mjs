import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const basePath = (process.env.BASE_PATH || '').replace(/\/$/, '');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' };
http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (basePath) {
    if (pathname !== basePath && !pathname.startsWith(basePath + '/')) { res.writeHead(404).end(); return; }
    pathname = pathname.slice(basePath.length) || '/';
  }
  const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(data);
  });
}).listen(Number(process.env.PORT || 8894), '0.0.0.0', () => console.log('Particle Lab: http://localhost:' + (process.env.PORT || 8894)));
