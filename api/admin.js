/**
 * POST /api/admin  —  toan bo khu quan tri, mot route, phan nhanh bang "action".
 *
 * Gop lam mot vi moi hanh dong deu di qua dung mot cua: kiem tra ty le thu,
 * kiem tra phien, kiem tra CSRF. Tach thanh nam file la nam co hoi quen mot
 * trong ba buoc do.
 *
 *   action: "session"   con phien khong. Khong can dang nhap.
 *   action: "login"     { password }            -> dat cookie phien
 *   action: "logout"                            -> xoa cookie
 *   action: "password"  { current, next }       -> doi mat khau, huy moi phien
 *   action: "upload"    { slug,title,alt,tag,thumb,full,w,h } -> them meme
 *   action: "remove"    { slug }                -> go mot meme da upload
 *
 * Anh duoc luu THANG VAO D1 dang base64. Khong dung thu vien anh nao ca:
 * trinh duyet da thu nho va nen anh truoc khi gui, nen server chi con viec
 * kiem tra va cat vao cho. Doi lai mot dich vu luu tru nua khong phai dung.
 *
 * MOI phan hoi loi deu chung chung. Mot ke dang do khong can biet ho sai o
 * mat khau, o phien, hay o cau hinh.
 */

import { d1Query } from './_d1.js';
import {
  adminEnabled, requireAdmin, sameOriginPost, noStore,
  checkRate, noteFailure, clearFailures,
  loadAdmin, hashPassword, sameHash, newSalt,
  issueToken, setSessionCookie, clearSessionCookie,
} from './_auth.js';

/* Anh da duoc trinh duyet thu nho truoc khi gui. Hai tran nay chi de chan
   mot yeu cau co tinh lam day database. */
const MAX_THUMB_BYTES = 300 * 1024;
const MAX_FULL_BYTES = 1200 * 1024;

const SLUG = /^[a-z0-9][a-z0-9-]{1,48}$/;
const TAG = /^[a-z][a-z-]{1,15}$/;

/** Do dai mat khau toi thieu. Ngan hon thi scrypt cung khong cuu duoc. */
const MIN_PASSWORD = 12;

const fail = (response, code, error) => {
  response.status(code).end(JSON.stringify({ ok: false, error }));
};

function readBody(request) {
  const b = request.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string') { try { return JSON.parse(b); } catch { return null; } }
  return null;
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Giai ma base64 va xac nhan day dung la mot tam JPEG.
 * Kiem tra byte dau thay vi tin vao ten hay content-type: ca hai deu do
 * nguoi gui tu dat.
 */
function decodeJpeg(b64, maxBytes) {
  if (typeof b64 !== 'string' || b64.length < 64) return null;
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch { return null; }
  if (!buf.length || buf.length > maxBytes) return null;
  /* SOI cua JPEG: FF D8 FF */
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null;
  return buf;
}

// ---------------------------------------------------------------------------
// tung hanh dong
// ---------------------------------------------------------------------------

async function doLogin(request, response, body) {
  const gate = checkRate(request);
  if (gate.locked) {
    return fail(response, 429, 'Too many attempts. Try again in ' +
      Math.ceil(gate.retryInSeconds / 60) + ' minutes.');
  }

  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) { noteFailure(request); return fail(response, 401, 'Wrong password.'); }

  const row = await loadAdmin();
  if (!row) {
    /* Chua ai dat mat khau. Noi ro, vi day la loi cau hinh cua chinh chu
       trang chu khong phai mot dau vet huu ich cho nguoi la. */
    return fail(response, 503, 'No password has been set yet. Run tools/set-password.mjs.');
  }

  if (!sameHash(hashPassword(password, row.pass_salt), row.pass_hash)) {
    noteFailure(request);
    return fail(response, 401, 'Wrong password.');
  }

  clearFailures(request);
  const token = issueToken(Number(row.token_version));
  if (!token) return fail(response, 503, 'Admin is not configured.');
  setSessionCookie(response, token);
  response.status(200).end(JSON.stringify({ ok: true }));
}

async function doPassword(request, response, body) {
  const gate = checkRate(request);
  if (gate.locked) return fail(response, 429, 'Too many attempts.');

  const current = typeof body.current === 'string' ? body.current : '';
  const next = typeof body.next === 'string' ? body.next : '';

  if (next.length < MIN_PASSWORD) {
    return fail(response, 400, 'The new password needs at least ' + MIN_PASSWORD + ' characters.');
  }
  if (next === current) return fail(response, 400, 'That is the current password.');

  const row = await loadAdmin();
  if (!row) return fail(response, 503, 'Admin is not configured.');

  if (!sameHash(hashPassword(current, row.pass_salt), row.pass_hash)) {
    noteFailure(request);
    return fail(response, 401, 'The current password is wrong.');
  }

  const salt = newSalt();
  const hash = hashPassword(next, salt);
  const version = Number(row.token_version) + 1;

  await d1Query(
    'UPDATE admin SET pass_hash = ?, pass_salt = ?, token_version = ?, updated_at = ? WHERE id = 1',
    [hash, salt, version, new Date().toISOString()],
  );

  clearFailures(request);
  /* Moi phien cu vua chet theo token_version. Cap lai the cho chinh may nay
     de nguoi doi mat khau khong bi da ra ngoai. */
  const token = issueToken(version);
  if (token) setSessionCookie(response, token);
  response.status(200).end(JSON.stringify({ ok: true }));
}

async function doUpload(request, response, body) {
  const slug = str(body.slug).toLowerCase();
  const title = str(body.title);
  const alt = str(body.alt);
  const tag = str(body.tag).toLowerCase() || 'scene';

  if (!SLUG.test(slug)) {
    return fail(response, 400, 'The name may only use lowercase letters, numbers and dashes.');
  }
  if (title.length < 2 || title.length > 80) return fail(response, 400, 'Give it a title.');
  /* alt khong phai tuy chon. Mot tam anh khong co alt la mot tam anh khong
     ton tai voi nguoi dung trinh doc man hinh. */
  if (alt.length < 8 || alt.length > 300) {
    return fail(response, 400, 'Describe the image for people who cannot see it, at least a few words.');
  }
  if (!TAG.test(tag)) return fail(response, 400, 'Bad tag.');

  const thumb = decodeJpeg(body.thumb, MAX_THUMB_BYTES);
  const full = decodeJpeg(body.full, MAX_FULL_BYTES);
  if (!thumb || !full) return fail(response, 400, 'The image did not arrive as a valid JPEG.');

  const taken = await d1Query('SELECT slug FROM memes WHERE slug = ?', [slug]);
  if (taken.length) return fail(response, 409, 'That name is already used.');

  const w = Number(body.w) | 0;
  const h = Number(body.h) | 0;
  if (w < 1 || h < 1 || w > 8000 || h > 8000) return fail(response, 400, 'Bad image size.');

  /* Anh vao truoc, hang meme vao sau. Neu buoc hai hong thi tuong anh khong
     bao gio hien mot o trong: khong co hang thi khong co the. */
  for (const [variant, buf] of [['thumb', thumb], ['full', full]]) {
    await d1Query(
      'INSERT OR REPLACE INTO meme_blobs (slug, variant, mime, w, h, data) VALUES (?, ?, ?, ?, ?, ?)',
      [slug, variant, 'image/jpeg', variant === 'thumb' ? 0 : w, variant === 'thumb' ? 0 : h,
       buf.toString('base64')],
    );
  }

  const sortRows = await d1Query('SELECT COALESCE(MAX(sort), 0) AS top FROM memes');
  const sort = Number(sortRows[0] && sortRows[0].top || 0) + 10;

  await d1Query(
    'INSERT INTO memes (slug, title, alt, tag, credit, featured, sort, stored) ' +
    'VALUES (?, ?, ?, ?, ?, 0, ?, 1)',
    [slug, title, alt, tag, '', sort],
  );

  response.status(200).end(JSON.stringify({ ok: true, slug }));
}

async function doRemove(request, response, body) {
  const slug = str(body.slug).toLowerCase();
  if (!SLUG.test(slug)) return fail(response, 400, 'Bad name.');
  /* Chi go duoc thu da upload qua day. Anh nam trong repo khong dung den
     database, nen khong co duong nao xoa nham chung tu man hinh nay. */
  const rows = await d1Query('SELECT stored FROM memes WHERE slug = ?', [slug]);
  if (!rows.length) return fail(response, 404, 'No meme by that name.');
  if (Number(rows[0].stored) !== 1) {
    return fail(response, 400, 'That one ships with the site. Remove it from the repo instead.');
  }
  await d1Query('DELETE FROM meme_blobs WHERE slug = ?', [slug]);
  await d1Query('DELETE FROM memes WHERE slug = ?', [slug]);
  response.status(200).end(JSON.stringify({ ok: true }));
}

// ---------------------------------------------------------------------------
// handler
// ---------------------------------------------------------------------------

export default async function handler(request, response) {
  noStore(response);

  /* Thieu khoa ky hoac thieu D1 thi khu nay khong ton tai. Dong cua khi
     hong, khong mo cua khi hong. */
  if (!adminEnabled()) return fail(response, 503, 'Not available.');

  if (!sameOriginPost(request)) {
    response.setHeader('Allow', 'POST');
    return fail(response, 405, 'Not available.');
  }

  const body = readBody(request);
  if (!body) return fail(response, 400, 'Bad request.');
  const action = str(body.action);

  try {
    /* hai hanh dong khong doi hoi phien */
    if (action === 'login') return await doLogin(request, response, body);
    if (action === 'logout') {
      clearSessionCookie(response);
      return response.status(200).end(JSON.stringify({ ok: true }));
    }
    if (action === 'session') {
      const who = await requireAdmin(request);
      return response.status(200).end(JSON.stringify({ ok: true, signedIn: Boolean(who) }));
    }

    /* tat ca phan con lai doi hoi mot phien con hieu luc */
    const who = await requireAdmin(request);
    if (!who) return fail(response, 401, 'Sign in first.');

    if (action === 'password') return await doPassword(request, response, body);
    if (action === 'upload') return await doUpload(request, response, body);
    if (action === 'remove') return await doRemove(request, response, body);

    return fail(response, 400, 'Unknown action.');
  } catch (err) {
    /* Khong bao gio tra chi tiet loi ra ngoai: thong bao cua D1 co the mang
       ten bang, ten cot, hoac mot phan cau lenh. */
    console.error('admin route failed:', err && err.message);
    return fail(response, 500, 'Something went wrong.');
  }
}
