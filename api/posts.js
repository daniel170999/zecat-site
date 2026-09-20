/**
 * GET /api/posts  —  the timeline of $ZECAT posts on X.
 *
 * { "ok": true, "source": "d1" | "static",
 *   "data": [ { id, posted_at, body, views, url, pinned } ] }
 *
 * Two sources, one shape:
 *   d1      when CF_ACCOUNT_ID + CF_D1_DATABASE_ID + CF_API_TOKEN are set and
 *           the  posts  table answers
 *   static  otherwise, or on ANY D1 trouble: the bundled public/data/posts.json
 *
 * Query:
 *   ?limit=12     clamped to 1..200, omitted means everything
 *
 * Order is pinned first, then newest posted_at first — same on both roads.
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
 * Where public/data/posts.json may sit once deployed. Vercel can run a function
 * from the repo root or from site/, so try each spelling rather than guess.
 * import ... with { type: 'json' } is deliberately NOT used: the assertion
 * syntax is not stable across Node 20 minors.
 */
const FALLBACK_PATHS = [
  path.resolve(HERE, '..', 'public', 'data', 'posts.json'),
  path.resolve(process.cwd(), 'public', 'data', 'posts.json'),
  path.resolve(process.cwd(), 'site', 'public', 'data', 'posts.json'),
];

/** parsed fallback, kept for the life of the lambda. null = not loaded yet. */
let staticCache = null;

// ---------------------------------------------------------------------------
// small coercions — D1 hands back 0/1 integers, JSON hands back booleans
// ---------------------------------------------------------------------------

function str(v) {
  return v === null || v === undefined ? '' : String(v);
}

function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

/** force one row into the published shape, whatever the source gave us. */
function shape(row) {
  const r = row && typeof row === 'object' ? row : {};
  return {
    id: r.id === null || r.id === undefined ? '' : r.id,
    posted_at: str(r.posted_at),
    body: str(r.body),
    // TEXT in db/schema.sql on purpose: it is a display label like '2.9k',
    // not an amount. num() turned every one of those into 0.
    views: str(r.views),
    url: str(r.url),
    pinned: bool(r.pinned),
  };
}

/** posted_at as a sortable number; unparseable timestamps sink to the bottom. */
function stamp(value) {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : -Infinity;
}

/** the D1 order — pinned first, then newest — applied to the static list too. */
function byPinnedThenNewest(a, b) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  const at = stamp(a.posted_at);
  const bt = stamp(b.posted_at);
  if (at !== bt) return bt - at;
  // same instant (or both unparseable): fall back to the raw string, newest first
  return String(b.posted_at).localeCompare(String(a.posted_at));
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
      staticCache = list.map(shape).sort(byPinnedThenNewest);
      return staticCache;
    } catch {
      // try the next spelling; a miss here is expected, not an error
    }
  }

  // Nothing on disk — another agent owns that file and it may not exist yet.
  // Do NOT cache the miss, so a later deploy is picked up on a warm lambda.
  return [];
}

/** Read the posts table. Throws on any D1 trouble; the caller falls back. */
async function loadD1() {
  const rows = await d1Query(
    'SELECT id, posted_at, body, views, url, pinned FROM posts' +
      ' ORDER BY pinned DESC, posted_at DESC',
  );
  return rows.map(shape);
}

/**
 * Pick a source and return { source, data }. Never throws.
 * LIMIT is applied here, after both roads meet, so the two sources cut the
 * list at the same place.
 */
async function build(limit) {
  let source = 'static';
  let data = null;

  if (d1Configured()) {
    try {
      const rows = await loadD1();
      // An empty table means the db was never seeded — treat it like a failed
      // read and serve the bundled file instead of a blank timeline.
      if (rows.length > 0) {
        source = 'd1';
        data = rows;
      }
    } catch {
      // any D1 trouble -> static, silently. The site must stay up.
    }
  }

  if (data === null) data = await loadStatic();

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
    const { source, data } = await build(readLimit(getQuery(request)));
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
