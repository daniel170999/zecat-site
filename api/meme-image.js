/**
 * GET /api/meme-image?slug=<ten>&v=thumb|full
 *
 * Tra ve mot tam anh da duoc upload qua khu quan tri. Anh nam trong D1 dang
 * base64; route nay giai ma va tra ve nguyen byte.
 *
 * KHONG can dang nhap: tuong meme la noi dung cong khai, y het cac file trong
 * public/meme. Cai duy nhat rieng tu la duong upload, khong phai duong xem.
 *
 * Cache manh tay, vi mot slug luon tra ve dung mot tam anh: muon doi anh thi
 * doi ten. Nho vay CDN chan gan het luot doc va D1 chi bi goi mot lan moi
 * bien vung.
 */

import { d1Configured, d1Query } from './_d1.js';

const SLUG = /^[a-z0-9][a-z0-9-]{1,48}$/;
const VARIANTS = new Set(['thumb', 'full']);

/** anh khong doi trong mot nam; slug moi la duong duy nhat de thay anh moi */
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
    /* Khong co D1 thi khong co anh nao kieu nay ton tai. 404 chu khong phai
       500: ve phia nguoi goi, tam anh nay that su khong co. */
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

  /* Chi tra ve dung loai anh minh tu ghi luc upload. Khong bao gio lay
     mime tu tham so cua nguoi goi. */
  const mime = row.mime === 'image/jpeg' ? 'image/jpeg' : 'application/octet-stream';

  response.setHeader('Content-Type', mime);
  response.setHeader('Content-Length', String(buf.length));
  response.setHeader('Cache-Control', CACHE);
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (method === 'HEAD') { response.status(200).end(); return; }
  response.status(200).end(buf);
}
