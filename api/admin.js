/**
 * POST /api/admin: all admin actions share one route and dispatch by "action".
 *
 * One route makes rate checks, session checks, and CSRF checks consistent.
 *
 *   action: "session"   Check session state; no sign-in required.
 *   action: "login"     { password }             Set the session cookie.
 *   action: "logout"                             Clear the cookie.
 *   action: "password"  { current, next }        Change password and revoke sessions.
 *   action: "upload"    { slug,alt?,tag?,thumb,full,w,h }  Add a meme.
 *                       Title and alt are optional; duplicate slugs are renamed.
 *   action: "remove"    { slug }                 Remove an uploaded meme.
 *
 * Images are stored as base64 in D1. The browser resizes and compresses them;
 * the server validates and stores the bytes without an image library.
 *
 * Error responses do not expose authentication or configuration details.
 */

import { d1Query } from './_d1.js';
import {
  adminEnabled, requireAdmin, sameOriginPost, noStore,
  checkRate, noteFailure, clearFailures,
  loadAdmin, hashPassword, sameHash, newSalt,
  issueToken, setSessionCookie, clearSessionCookie,
} from './_auth.js';

/* The browser compresses images first. These limits prevent oversized writes. */
const MAX_THUMB_BYTES = 300 * 1024;
const MAX_FULL_BYTES = 1200 * 1024;

const SLUG = /^[a-z0-9][a-z0-9-]{1,48}$/;
const TAG = /^[a-z][a-z-]{1,15}$/;

/** Minimum new password length; scrypt cannot compensate for weak passwords. */
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
 * Decode base64 and verify the JPEG signature. A caller controls both the
 * filename and Content-Type header, so neither proves the image format.
 */
function decodeJpeg(b64, maxBytes) {
  if (typeof b64 !== 'string' || b64.length < 64) return null;
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch { return null; }
  if (!buf.length || buf.length > maxBytes) return null;
  /* JPEG start-of-image marker: FF D8 FF. */
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null;
  return buf;
}

// ---------------------------------------------------------------------------
// Actions
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
    /* No verifier exists yet. Report the setup error to the operator. */
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
  /* token_version revokes old sessions; issue a new token for this device. */
  const token = issueToken(version);
  if (token) setSessionCookie(response, token);
  response.status(200).end(JSON.stringify({ ok: true }));
}

/**
 * Resolve duplicate slugs with -2, -3, and so on. Batch uploads often
 * contain duplicate filenames. Return null after 50 unsuccessful candidates.
 */
async function freeSlug(base) {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : base + '-' + (i + 1);
    if (candidate.length > 49) return null;
    const taken = await d1Query('SELECT slug FROM memes WHERE slug = ?', [candidate]);
    if (!taken.length) return candidate;
  }
  return null;
}

/** "wanted-on-zcash" -> "Wanted on zcash" for a D1 display title. */
function titleFromSlug(slug) {
  const words = slug.split('-').filter(Boolean).join(' ');
  return words ? words[0].toUpperCase() + words.slice(1) : slug;
}

async function doUpload(request, response, body) {
  const wanted = str(body.slug).toLowerCase();
  const alt = str(body.alt);
  const tag = str(body.tag).toLowerCase() || 'scene';

  if (!SLUG.test(wanted)) {
    return fail(response, 400, 'The file name has no usable letters or numbers in it.');
  }
  /* Description is optional for batch uploads. Preserve an empty description
     rather than inventing misleading alt text. */
  if (alt.length > 300) return fail(response, 400, 'That description is too long.');
  if (!TAG.test(tag)) return fail(response, 400, 'Bad tag.');

  const thumb = decodeJpeg(body.thumb, MAX_THUMB_BYTES);
  const full = decodeJpeg(body.full, MAX_FULL_BYTES);
  if (!thumb || !full) return fail(response, 400, 'The image did not arrive as a valid JPEG.');

  const slug = await freeSlug(wanted);
  if (!slug) return fail(response, 409, 'Could not find a free name for that file.');

  /* D1 requires a title. Derive one from the filename when it was omitted. */
  const title = str(body.title) || titleFromSlug(slug);

  const w = Number(body.w) | 0;
  const h = Number(body.h) | 0;
  if (w < 1 || h < 1 || w > 8000 || h > 8000) return fail(response, 400, 'Bad image size.');

  /* Store image bytes before the meme row so a failed insert cannot leave a
     visible gallery tile without an image. */
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
  /* Only D1 uploads can be removed here. Repository images stay untouched. */
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

  /* Disable admin when the signing key or D1 is unavailable. */
  if (!adminEnabled()) return fail(response, 503, 'Not available.');

  if (!sameOriginPost(request)) {
    response.setHeader('Allow', 'POST');
    return fail(response, 405, 'Not available.');
  }

  const body = readBody(request);
  if (!body) return fail(response, 400, 'Bad request.');
  const action = str(body.action);

  try {
    /* These actions do not require an existing session. */
    if (action === 'login') return await doLogin(request, response, body);
    if (action === 'logout') {
      clearSessionCookie(response);
      return response.status(200).end(JSON.stringify({ ok: true }));
    }
    if (action === 'session') {
      const who = await requireAdmin(request);
      return response.status(200).end(JSON.stringify({ ok: true, signedIn: Boolean(who) }));
    }

    /* All remaining actions require a valid session. */
    const who = await requireAdmin(request);
    if (!who) return fail(response, 401, 'Sign in first.');

    if (action === 'password') return await doPassword(request, response, body);
    if (action === 'upload') return await doUpload(request, response, body);
    if (action === 'remove') return await doRemove(request, response, body);

    return fail(response, 400, 'Unknown action.');
  } catch (err) {
    /* D1 errors may include table names or SQL fragments; never expose them. */
    console.error('admin route failed:', err && err.message);
    return fail(response, 500, 'Something went wrong.');
  }
}
