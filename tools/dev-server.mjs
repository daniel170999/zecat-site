/* ===========================================================================
   dev-server.mjs  -  serve the site and API routes locally
   ---------------------------------------------------------------------------
       node tools/dev-server.mjs          open http://localhost:8099
       node tools/dev-server.mjs 3000     use another port

   Unlike `npx vercel dev`, this local server needs no login, linked project,
   network access, or dependencies. It invokes the real api/ handlers.

   This is only a development server. It does not reproduce vercel.json
   headers, CSP, or caching. Verify a Vercel preview before production.
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

/* Adapt Node's response object to the Vercel handler interface. */
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
 * Parse JSON request bodies as Vercel does before invoking handlers. Empty
 * or invalid JSON becomes undefined so each handler can decide the response.
 */
function readJsonBody(request) {
  const method = (request.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (c) => {
      raw += c;
      /* Safety ceiling near Vercel's request-body limit. */
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
      /* Bust the module cache so file edits work without a restart. */
      const mod = await import(pathToFileURL(join(apiDir, name + '.js')).href + '?t=' + Date.now());
      req.query = Object.fromEntries(url.searchParams.entries());
      /* Vercel supplies parsed request.body; reproduce that for POST routes. */
      req.body = await readJsonBody(req);
      await mod.default(req, vercelShim(res));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
    }
    return;
  }

  /* ---- static files ---- */
  if (path === '/') path = '/index.html';
  /* Prevent traversal outside public/. */
  const safe = path.split('/').filter((p) => p && p !== '.' && p !== '..').join('/');
  let file = join(publicDir, safe);

  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    /* Match cleanUrls: /faq also serves /faq.html. */
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
    console.error('Port ' + port + ' is in use. Try: node tools/dev-server.mjs ' + (port + 1));
    process.exit(1);
  }
  throw err;
});

server.listen(port, () => {
  console.log('$ZECAT site running at http://localhost:' + port);
  console.log('  /api/tape   /api/memes   /api/posts   available');
  console.log('  Press Ctrl+C to stop');
});
