/**
 * GET /api/meme-image?slug=<name>&v=thumb|full
 *
 * Return an uploaded image. D1 stores base64; this route decodes and returns
 * the original bytes.
 *
 * Viewing images requires no sign-in because the gallery is public. Uploads
 * still require admin authentication.
 *
 * Cache by slug for one year. Use a new slug when replacing an image so CDN
 * caches never serve the wrong version.
 */

import { d1Configured, d1Query } from './_d1.js';

const SLUG = /^[a-z0-9][a-z0-9-]{1,48}$/;
const VARIANTS = new Set(['thumb', 'full']);

/** Immutable for one year; use a new slug to publish a replacement. */
const CACHE = 'public, max-age=31536000, immutable';

function query(request) {
  if (request && request.query && typeof request.query === 'object') return request.query;
  try {
    const url = new URL(request.url || '/', 'http://localhost');
    return Object.fromEntries(url.searchParams.entries());
  } catch { return {}; }
}

const one = (v) => (Array.isArray(v) ? v[0] : v);

export default async function handler(request, response) {
  const method = (request.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    response.status(405).end();
    return;
  }

  const q = query(request);
  const slug = String(one(q.slug) || '').toLowerCase();
  const variant = String(one(q.v) || 'thumb').toLowerCase();

  if (!SLUG.test(slug) || !VARIANTS.has(variant)) {
    response.status(400).end();
    return;
  }

  if (!d1Configured()) {
    /* Without D1 this image does not exist; return 404 rather than 500. */
    response.status(404).end();
    return;
  }

  let row;
  try {
    const rows = await d1Query(
      'SELECT mime, data FROM meme_blobs WHERE slug = ? AND variant = ?',
      [slug, variant],
    );
    row = rows[0];
  } catch (err) {
    console.error('meme-image lookup failed:', err && err.message);
    response.status(502).end();
    return;
  }

  if (!row || typeof row.data !== 'string') {
    response.status(404).end();
    return;
  }

  let buf;
  try { buf = Buffer.from(row.data, 'base64'); } catch { buf = null; }
  if (!buf || !buf.length) {
    response.status(404).end();
    return;
  }

  /* Use the stored MIME type, never one supplied by a caller. */
  const mime = row.mime === 'image/jpeg' ? 'image/jpeg' : 'application/octet-stream';

  response.setHeader('Content-Type', mime);
  response.setHeader('Content-Length', String(buf.length));
  response.setHeader('Cache-Control', CACHE);
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (method === 'HEAD') { response.status(200).end(); return; }
  response.status(200).end(buf);
}
