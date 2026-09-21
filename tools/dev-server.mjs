/* ===========================================================================
   dev-server.mjs  ·  xem ca trang VA cac route api, ngay tren may
   ---------------------------------------------------------------------------
       node tools/dev-server.mjs          mo o http://localhost:8099
       node tools/dev-server.mjs 3000     doi cong

   Vi sao co file nay ben canh `npx vercel dev`: vercel dev bat dang nhap va
   link project truoc khi chay dong nao. File nay khong can mang, khong can
   tai khoan, khong co dependency, va goi thang cac handler trong api/ nen
   /api/tape, /api/memes, /api/posts deu tra loi that.

   Day CHI la may chu de thu. No khong bat chuoc header trong vercel.json,
   khong bat chuoc CSP, va khong bat chuoc cache. Truoc khi push van phai xem
   ban preview tren Vercel.
   =========================================================================== */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const publicDir = join(root, 'public');
const apiDir = join(root, 'api');
const port = Number(process.argv[2]) || 8099;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
};

/* Handler trong api/ viet theo kieu Vercel: response.status(n).end(body).
   Node khong co san hai ham do, nen boc them o day. */
function vercelShim(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

/**
 * Doc than yeu cau va phan tich JSON, y het cach Vercel lam truoc khi goi
 * handler. Than rong hoac khong phai JSON thi tra ve undefined, dung nhu
 * Vercel, de handler tu quyet dinh do la loi hay khong.
 */
function readJsonBody(request) {
  const method = (request.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (c) => {
      raw += c;
      /* tran an toan, xap xi gioi han than yeu cau cua Vercel */
      if (raw.length > 5 * 1024 * 1024) { raw = ''; request.destroy(); resolve(undefined); }
    });
    request.on('end', () => {
      if (!raw) return resolve(undefined);
      const type = String(request.headers['content-type'] || '');
      if (!type.includes('application/json')) return resolve(raw);
      try { resolve(JSON.parse(raw)); } catch { resolve(undefined); }
    });
    request.on('error', () => resolve(undefined));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  let path = decodeURIComponent(url.pathname);

  /* ---- route api ---- */
  if (path.startsWith('/api/')) {
    const name = path.slice(5).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!name || name.startsWith('_')) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ ok: false, error: 'no such route' }));
    }
    try {
      /* them query moi lan de sua file xong khong phai khoi dong lai */
      const mod = await import(pathToFileURL(join(apiDir, name + '.js')).href + '?t=' + Date.now());
      req.query = Object.fromEntries(url.searchParams.entries());
      /* Vercel tu doc than JSON thanh request.body truoc khi goi handler.
         Khong lam viec do o day thi moi route POST se thay than rong va tra
         ve "Bad request", trong khi tren that no chay binh thuong. */
      req.body = await readJsonBody(req);
      await mod.default(req, vercelShim(res));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
    }
    return;
  }

  /* ---- file tinh ---- */
  if (path === '/') path = '/index.html';
  /* chan di nguoc len tren public/ */
  const safe = path.split('/').filter((p) => p && p !== '.' && p !== '..').join('/');
  let file = join(publicDir, safe);

  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    /* cleanUrls trong vercel.json: /faq cung phuc vu /faq.html */
    try { await stat(file + '.html'); file += '.html'; }
    catch { res.statusCode = 404; return res.end('404 ' + path); }
  }

  try {
    const buf = await readFile(file);
    res.setHeader('content-type', TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('content-length', buf.length);
    res.end(buf);
  } catch {
    res.statusCode = 404;
    res.end('404 ' + path);
  }
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('cong ' + port + ' dang co thu khac dung. Thu: node tools/dev-server.mjs ' + (port + 1));
    process.exit(1);
  }
  throw err;
});

server.listen(port, () => {
  console.log('site cua $ZECAT dang chay o  http://localhost:' + port);
  console.log('  /api/tape   /api/memes   /api/posts   deu song');
  console.log('  Ctrl+C de dung');
});
