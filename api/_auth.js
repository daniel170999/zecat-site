/**
 * Authentication for the admin area. This is not an endpoint: Vercel does not
 * route files whose names start with "_"; other routes import this module.
 *
 * ---------------------------------------------------------------------------
 * SECURITY INVARIANTS
 *
 * 1. Never put plaintext passwords in source, Git, logs, or responses. D1
 *    stores only a scrypt hash and salt. The password setup tool reads from
 *    the terminal without echoing or recording the password.
 *
 * 2. Verify passwords only on the server. The gesture that opens the admin
 *    panel merely hides the UI; its source is public and offers no protection.
 *
 * 3. Without ADMIN_SECRET, disable the admin area. Fail closed.
 *
 * 4. Compare hashes with timingSafeEqual, not a regular equality operator.
 *
 * 5. Increment token_version on password changes to invalidate old sessions.
 * ---------------------------------------------------------------------------
 */

import crypto from 'node:crypto';
import { d1Query, d1Configured } from './_d1.js';

/** Session cookie name; the zc_ prefix avoids collisions. */
export const COOKIE = 'zc_admin';

/** Session lifetime in seconds: eight hours. */
const SESSION_SECONDS = 8 * 60 * 60;

/** scrypt work factor. Keep the password setup tool and verifier aligned. */
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

/** Failed attempts before a temporary lockout and its duration. */
const MAX_TRIES = 6;
const LOCK_MS = 15 * 60 * 1000;

/* This counter is local to one serverless instance. Parallel instances have
   separate counters, so this is not a global brute-force barrier. Password
   strength remains necessary. */
const tries = new Map();

/**
 * Derive a caller key for the failed-attempt counter.
 *
 * Never trust the first x-forwarded-for hop: the caller can supply it. Doing
 * so would allow both of these tested attacks:
 *
 *   1. Spoof the owner's address, fail six times, and lock the owner out.
 *   2. Rotate that first hop to evade the failed-attempt counter.
 *
 * Each proxy appends the address it received, making the last hop the closest
 * trusted hop. Prefer x-real-ip when Vercel supplies it.
 */
function clientKey(request) {
  const h = request.headers || {};

  const real = String(h['x-real-ip'] || h['X-Real-IP'] || '').trim();
  if (real) return real;

  const fwd = String(h['x-forwarded-for'] || h['X-Forwarded-For'] || '');
  const hops = fwd.split(',').map((x) => x.trim()).filter(Boolean);
  if (hops.length) return hops[hops.length - 1];

  /* Without a usable address, group callers under one key rather than
     allowing unmetered guesses. */
  return 'unknown';
}

/** @returns {{locked: boolean, retryInSeconds: number}} */
export function checkRate(request) {
  const key = clientKey(request);
  const now = Date.now();
  const rec = tries.get(key);
  if (rec && rec.until > now && rec.count >= MAX_TRIES) {
    return { locked: true, retryInSeconds: Math.ceil((rec.until - now) / 1000) };
  }
  if (rec && rec.until <= now) tries.delete(key);
  return { locked: false, retryInSeconds: 0 };
}

export function noteFailure(request) {
  const key = clientKey(request);
  const now = Date.now();
  const rec = tries.get(key);
  if (!rec || rec.until <= now) tries.set(key, { count: 1, until: now + LOCK_MS });
  else rec.count += 1;
}

export function clearFailures(request) {
  tries.delete(clientKey(request));
}

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

export function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/** Return the scrypt hash as hex for both setup and verification. */
export function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT).toString('hex');
}

/** Compare two hex hashes without leaking a matching prefix through timing. */
export function sameHash(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------
// HMAC-signed session tokens
// ---------------------------------------------------------------------------

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function secret() {
  const s = process.env.ADMIN_SECRET;
  /* Reject short signing keys. */
  return typeof s === 'string' && s.length >= 32 ? s : null;
}

/** Require both D1 storage and a session-signing key for administration. */
export function adminEnabled() {
  return Boolean(secret()) && d1Configured();
}

export function issueToken(tokenVersion) {
  const key = secret();
  if (!key) return null;
  const body = b64u(JSON.stringify({
    v: tokenVersion,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  }));
  const sig = b64u(crypto.createHmac('sha256', key).update(body).digest());
  return body + '.' + sig;
}

/** @returns {{v:number, exp:number} | null} */
export function readToken(token) {
  const key = secret();
  if (!key || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const want = b64u(crypto.createHmac('sha256', key).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let claims;
  try { claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
  catch { return null; }

  if (!claims || typeof claims.exp !== 'number' || typeof claims.v !== 'number') return null;
  if (claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

export function cookieFrom(request, name) {
  const raw = request.headers && request.headers.cookie;
  if (typeof raw !== 'string') return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function setSessionCookie(response, token) {
  response.setHeader('Set-Cookie',
    COOKIE + '=' + encodeURIComponent(token) +
    '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + SESSION_SECONDS);
}

export function clearSessionCookie(response) {
  response.setHeader('Set-Cookie',
    COOKIE + '=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
}

// ---------------------------------------------------------------------------
// D1 state
// ---------------------------------------------------------------------------

/** @returns {Promise<{pass_hash:string, pass_salt:string, token_version:number} | null>} */
export async function loadAdmin() {
  const rows = await d1Query('SELECT pass_hash, pass_salt, token_version FROM admin WHERE id = 1');
  return rows && rows[0] ? rows[0] : null;
}

/**
 * Return null for invalid admin sessions without exposing the reason.
 */
export async function requireAdmin(request) {
  if (!adminEnabled()) return null;
  const claims = readToken(cookieFrom(request, COOKIE));
  if (!claims) return null;
  let row;
  try { row = await loadAdmin(); } catch { return null; }
  if (!row) return null;
  /* A password change invalidates tokens with an earlier version. */
  if (Number(row.token_version) !== Number(claims.v)) return null;
  return { version: Number(row.token_version) };
}

/**
 * CSRF defense. SameSite=Strict helps; the custom header also prevents a
 * cross-origin HTML form or image from submitting an admin action.
 */
export function sameOriginPost(request) {
  const h = request.headers || {};
  if ((request.method || '').toUpperCase() !== 'POST') return false;
  if (h['x-zecat-admin'] !== '1') return false;
  const ct = String(h['content-type'] || '');
  return ct.includes('application/json');
}

/** Prevent caches and indexers from retaining admin responses. */
export function noStore(response) {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
}
