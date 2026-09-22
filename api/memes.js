/**
 * GET /api/memes  —  the meme wall.
 *
 * { "ok": true, "source": "d1" | "static",
 *   "data": [ { id, slug, title, alt, tag, credit, featured, sort, stored, w, h } ] }
 *
 * w and h describe the image's real aspect ratio before the bytes arrive:
 * the full variant for uploads and the thumbnail for bundled images.
 * They are 0 when unknown; the front end then measures after load.
 *
 * Two sources, one shape:
 *   d1      when CF_ACCOUNT_ID + CF_D1_DATABASE_ID + CF_API_TOKEN are set and
 *           the  memes  table answers
 *   static  otherwise, or on ANY D1 trouble: the bundled public/data/memes.json
 *
 * Query:
 *   ?tag=lore     case-insensitive exact match on tag
 *   ?limit=24     clamped to 1..200, omitted means everything
 *
 * The front end never sees an error shape: this route answers 200 even when
 * both sources are gone (empty data, source "static"). No npm dependencies.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { d1Configured, d1Query } from './_d1.js';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const LIMIT_MIN = 1;
const LIMIT_MAX = 200;

/** this file's directory, the anchor for every fallback path below. */
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where public/data/memes.json may sit once deployed. Vercel can run a function
 * from the repo root or from site/, so try each spelling rather than guess.
 * import ... with { type: 'json' } is deliberately NOT used: the assertion
 * syntax is not stable across Node 20 minors.
 */
const FALLBACK_PATHS = [
  path.resolve(HERE, '..', 'public', 'data', 'memes.json'),
  path.resolve(process.cwd(), 'public', 'data', 'memes.json'),
  path.resolve(process.cwd(), 'site', 'public', 'data', 'memes.json'),
];

/** parsed fallback, kept for the life of the lambda. null = not loaded yet. */
let staticCache = null;

// ---------------------------------------------------------------------------
// small coercions — D1 hands back 0/1 integers, JSON hands back booleans
// ---------------------------------------------------------------------------

function str(v) {
  return v === null || v === undefined ? '' : String(v);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

/** force one row into the published shape, whatever the source gave us. */
function shape(row) {
  const r = row && typeof row === 'object' ? row : {};
  const title = str(r.title);
  return {
    id: r.id === null || r.id === undefined ? str(r.slug) : r.id,
    slug: str(r.slug),
    title,
    // alt is what a screen reader says; never let it be empty
    alt: str(r.alt) || title,
    tag: str(r.tag),
    credit: str(r.credit),
    featured: bool(r.featured),
    sort: num(r.sort),
    /* 1 = anh nam trong D1, phuc vu boi /api/meme-image.
       0 = anh nam trong repo tai public/meme/<slug>.jpg */
    stored: bool(r.stored),
    /* Co so cua ban thumb thi buc tuong xep hang dung ngay lan dau. Khong co
       thi bang khong, va trinh duyet do lay sau khi anh tai xong. */
    w: num(r.w),
    h: num(r.h),
  };
}

/** the D1 order — sort, then id — applied to the static list as well. */
function bySortThenId(a, b) {
  if (a.sort !== b.sort) return a.sort - b.sort;
  const an = Number(a.id);
  const bn = Number(b.id);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a.id).localeCompare(String(b.id));
}

// ---------------------------------------------------------------------------
// request parsing
// ---------------------------------------------------------------------------

/** Vercel fills request.query; fall back to parsing the raw url ourselves. */
function getQuery(request) {
  if (request && request.query && typeof request.query === 'object') {
    return request.query;
  }
  try {
    const url = new URL(request.url || '/', 'http://localhost');
    return Object.fromEntries(url.searchParams.entries());
  } catch {
    return {};
  }
}

/** first value of a query key — Vercel may hand back an array for ?k=a&k=b. */
function one(value) {
  return Array.isArray(value) ? value[0] : value;
}

/** ?limit= clamped to 1..200. Missing or junk means null = no limit. */
function readLimit(query) {
  const raw = one(query.limit);
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return null;
  return Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, n));
}

/** ?tag= trimmed. Empty means no filter. */
function readTag(query) {
  const raw = one(query.tag);
  const tag = str(raw).trim();
  return tag ? tag : null;
}

// ---------------------------------------------------------------------------
// sources
// ---------------------------------------------------------------------------

/**
 * Read the bundled JSON once, then serve it from module scope.
 * Missing file, bad JSON, wrong root type -> empty list. Never throws.
 */
async function loadStatic() {
  if (staticCache) return staticCache;

  for (const file of FALLBACK_PATHS) {
    try {
      const text = await readFile(file, 'utf8');
      const parsed = JSON.parse(text);
      // accept a bare array or { data: [...] }
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && Array.isArray(parsed.data)
          ? parsed.data
          : null;
      if (!list) continue;
      staticCache = list.map(shape).sort(bySortThenId);
      return staticCache;
    } catch {
      // try the next spelling; a miss here is expected, not an error
    }
  }

  // Nothing on disk — another agent owns that file and it may not exist yet.
  // Do NOT cache the miss, so a later deploy is picked up on a warm lambda.
  return [];
}

/** Read the memes table. Throws on any D1 trouble; the caller falls back. */
async function loadD1(tag) {
  const where = tag ? ' WHERE lower(m.tag) = lower(?)' : '';
  const params = tag ? [tag] : [];
  /* LEFT JOIN, khong phai JOIN: mot hang meme co the tro den mot anh nam
     trong repo, khong co dong nao trong meme_blobs. JOIN thuong se lam mat
     sach muoi lam tam anh goc khoi buc tuong. */
  const sql =
    'SELECT m.id, m.slug, m.title, m.alt, m.tag, m.credit, m.featured, m.sort,' +
    " m.stored, b.w AS w, b.h AS h" +
    ' FROM memes m' +
    /* variant='full', khong phai 'thumb': api/admin.js:198 co y ghi 0 vao
       w/h cua hang thumb va chi ghi so that vao hang full. Hai ban deu ve tu
       cung mot bitmap voi cung phep thu nho theo ti le, nen TI LE cua chung
       bang nhau, ma buc tuong chi can ti le. Doc tu 'full' con co cai loi la
       nhung tam da upload truoc day deu dung duoc ngay, khong phai va lai
       du lieu cu. */
    " LEFT JOIN meme_blobs b ON b.slug = m.slug AND b.variant = 'full'" +
    where +
    ' ORDER BY m.sort ASC, m.id ASC';
  const rows = await d1Query(sql, params);
  /* Bundled memes have no meme_blobs row. Their measured thumbnail sizes live
     in the generated fallback JSON, so merge those sizes into D1's rows. */
  const bundled = new Map((await loadStatic()).map((m) => [m.slug, m]));
  return rows.map((row) => {
    const size = bundled.get(str(row.slug));
    return shape({
      ...row,
      w: num(row.w) > 0 ? row.w : size?.w,
      h: num(row.h) > 0 ? row.h : size?.h,
    });
  });
}

/**
 * Pick a source and return { source, data }. Never throws.
 * LIMIT is applied here, after both roads meet, so the two sources cut the
 * list at the same place.
 */
async function build(tag, limit) {
  let source = 'static';
  let data = null;

  if (d1Configured()) {
    try {
      const rows = await loadD1(tag);
      // An empty UNFILTERED table means the db was never seeded — treat it like
      // a failed read and serve the bundled file instead of a blank wall.
      // An empty FILTERED result is a real answer: that tag has no memes.
      if (rows.length > 0 || tag) {
        source = 'd1';
        data = rows;
      }
    } catch {
      // any D1 trouble -> static, silently. The site must stay up.
    }
  }

  if (data === null) {
    const all = await loadStatic();
    data = tag ? all.filter((m) => m.tag.toLowerCase() === tag.toLowerCase()) : all;
  }

  if (limit !== null) data = data.slice(0, limit);

  return { source, data };
}

// ---------------------------------------------------------------------------
// handler
// ---------------------------------------------------------------------------

export default async function handler(request, response) {
  const method = (request.method || 'GET').toUpperCase();

  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (method !== 'GET' && method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    response.status(405).end(JSON.stringify({ ok: false, error: 'method not allowed' }));
    return;
  }

  response.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');

  // belt and braces: nothing throws out of this handler, and it never 5xx's
  let body;
  try {
    const query = getQuery(request);
    const { source, data } = await build(readTag(query), readLimit(query));
    body = { ok: true, source, data };
  } catch {
    body = { ok: true, source: 'static', data: [] };
  }

  if (method === 'HEAD') {
    response.status(200).end();
    return;
  }

  response.status(200).end(JSON.stringify(body));
}
