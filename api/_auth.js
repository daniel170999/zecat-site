/**
 * Lop xac thuc cho khu quan tri.  KHONG phai mot endpoint: ten file bat dau
 * bang "_" nen Vercel khong route no, chi co cac route khac import vao.
 *
 * ---------------------------------------------------------------------------
 * NHUNG DIEU KHONG DUOC PHA
 *
 * 1. Mat khau KHONG BAO GIO nam trong ma nguon, trong repo, trong log, hay
 *    trong bat ky cau tra loi nao. Trong D1 chi co scrypt hash va salt. Dat
 *    mat khau bang `node tools/set-password.mjs`, lenh do doc tu ban phim va
 *    khong ghi mat khau ra dau ca.
 *
 * 2. Kiem tra mat khau chi xay ra o SERVER. Cu chi mo bang tren trang chi de
 *    giau cua, khong phai de bao ve. Bat ky ai doc site.js deu thay cu chi
 *    do, va dieu do khong sao: thu chan ho la mat khau, khong phai su bi mat
 *    cua cai nut.
 *
 * 3. Thieu ADMIN_SECRET thi toan bo khu quan tri TAT. Dong cua khi hong, chu
 *    khong mo cua khi hong.
 *
 * 4. So sanh hash bang timingSafeEqual. So sanh bang === de lo do dai trung
 *    khop qua thoi gian phan hoi.
 *
 * 5. Doi mat khau lam tang token_version, nen moi phien dang mo trên may
 *    khac deu chet ngay lap tuc.
 * ---------------------------------------------------------------------------
 */

import crypto from 'node:crypto';
import { d1Query, d1Configured } from './_d1.js';

/** ten cookie phien. Tien to zc_ de khong dung voi cookie cua ai khac. */
export const COOKIE = 'zc_admin';

/** phien song bao lau, giay. 8 tieng, du mot buoi lam viec. */
const SESSION_SECONDS = 8 * 60 * 60;

/** scrypt: N cang lon cang cham. 2^15 mat khoang 100ms tren lambda, du dat
 *  de do vet can mat khau ma van khong lam nguoi dung doi. */
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

/** cho phep bao nhieu lan doan sai truoc khi khoa, va khoa bao lau. */
const MAX_TRIES = 6;
const LOCK_MS = 15 * 60 * 1000;

/* Bo dem so lan doan sai. Day la bo nho cua MOT lambda, nen no khong phai
   mot hang rao hoan hao: Vercel co the chay nhieu ban song song va moi ban
   dem rieng. No lam cham mot ke do mat khau di rat nhieu, va di kem voi
   scrypt 100ms moi lan thu thi vet can tro nen vo nghia ve mat thoi gian.
   Hang rao that van la do dai mat khau. */
const tries = new Map();

/**
 * Dia chi cua nguoi goi, dung lam khoa cho bo dem so lan doan sai.
 *
 * KHONG duoc lay chang DAU cua x-forwarded-for. Chang do do CHINH NGUOI GOI
 * dat, va tin vao no mo ra hai duong tan cong da duoc chay thu:
 *
 *   1. Ke la gui x-forwarded-for bang dia chi THAT cua chu trang, doan sai
 *      sau lan, va chu trang bi khoa ra ngoai 15 phut. Sau yeu cau la du.
 *   2. Ke la doi chang dau moi lan gui, moi yeu cau trong nhu mot nguoi moi,
 *      va bo dem khong bao gio cham nguong.
 *
 * Quy uoc cua x-forwarded-for la moi proxy NOI THEM dia chi ma no nhan duoc
 * vao cuoi. Vay chang CUOI la chang gan minh nhat, va la chang duy nhat ma
 * nguoi goi khong viet duoc. x-real-ip thi do chinh Vercel dat va ghi de,
 * nen no la lua chon dau tien.
 */
function clientKey(request) {
  const h = request.headers || {};

  const real = String(h['x-real-ip'] || h['X-Real-IP'] || '').trim();
  if (real) return real;

  const fwd = String(h['x-forwarded-for'] || h['X-Forwarded-For'] || '');
  const hops = fwd.split(',').map((x) => x.trim()).filter(Boolean);
  if (hops.length) return hops[hops.length - 1];

  /* Khong xac dinh duoc ai thi gop tat ca vao mot khoa. Nghia la mot nguoi
     doan sai co the lam cham nhung nguoi khac, nhung o mot trang mot nguoi
     dung thi do la danh doi dung: tha chat con hon khong dem gi. */
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
// mat khau
// ---------------------------------------------------------------------------

export function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/** scrypt, tra ve hex. Dung cho ca luc dat mat khau va luc kiem tra. */
export function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT).toString('hex');
}

/** So sanh hai chuoi hex ma khong de lo do dai trung khop qua thoi gian. */
export function sameHash(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------
// the phien, ky bang HMAC
// ---------------------------------------------------------------------------

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function secret() {
  const s = process.env.ADMIN_SECRET;
  /* Ngan khoa qua ngan. Mot khoa 8 ky tu khong ky duoc gi ca. */
  return typeof s === 'string' && s.length >= 32 ? s : null;
}

/** Khu quan tri chi song khi CA HAI deu co: D1 de luu, va khoa de ky. */
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
// trang thai trong D1
// ---------------------------------------------------------------------------

/** @returns {Promise<{pass_hash:string, pass_salt:string, token_version:number} | null>} */
export async function loadAdmin() {
  const rows = await d1Query('SELECT pass_hash, pass_salt, token_version FROM admin WHERE id = 1');
  return rows && rows[0] ? rows[0] : null;
}

/**
 * Cua chinh. Tra ve null khi khong hop le, va KHONG noi vi sao — mot ke dang
 * do tim khong can biet cai nao trong bon ly do da chan ho.
 */
export async function requireAdmin(request) {
  if (!adminEnabled()) return null;
  const claims = readToken(cookieFrom(request, COOKIE));
  if (!claims) return null;
  let row;
  try { row = await loadAdmin(); } catch { return null; }
  if (!row) return null;
  /* Doi mat khau tang token_version, nen the cu het gia tri ngay. */
  if (Number(row.token_version) !== Number(claims.v)) return null;
  return { version: Number(row.token_version) };
}

/**
 * Chan CSRF. SameSite=Strict da chan phan lon, nhung mot header tu dat thi
 * trinh duyet chi gui duoc qua fetch cung nguon, khong gui duoc qua form
 * hay anh tu trang khac.
 */
export function sameOriginPost(request) {
  const h = request.headers || {};
  if ((request.method || '').toUpperCase() !== 'POST') return false;
  if (h['x-zecat-admin'] !== '1') return false;
  const ct = String(h['content-type'] || '');
  return ct.includes('application/json');
}

/** Moi phan hoi cua khu quan tri deu khong duoc luu lai o bat cu dau. */
export function noStore(response) {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
}
