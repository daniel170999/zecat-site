/**
 * GET /api/chart: $ZECAT price history for a candlestick chart.
 *
 * SHLD.fun returns one price row per traded block, not OHLC candles. This
 * route normalizes the history; the browser builds candles so changing the
 * time interval does not require another network request.
 *
 * Public upstream APIs (no credentials):
 *   /zsa/api/price-history?asset=..&limit=2000&offset=..   block prices
 *   /zsa/api/health                                        chain tip and time
 *   /zsa/api/fills?asset=..&limit=500                      funding source
 *   /api/zec-usd                                           ZEC/USD rate
 *
 * The price rows have block heights, not timestamps. The chart estimates
 * times from known anchors. Zcash targets 75 seconds per block, but real
 * intervals vary, so the time axis is approximate and the UI says so.
 *
 * No environment variables or npm dependencies. Node 20, global fetch, ESM.
 */

const ASSET_ID = 'dbc23d99cf614e1146c1c49d8e94646227f71c59cb1c2ea3731ce264c48bc32a';

const BASE = 'https://shld.fun';
const HISTORY_URL = BASE + '/zsa/api/price-history';
const HEALTH_URL = BASE + '/zsa/api/health';
const FILLS_URL = BASE + '/zsa/api/fills';
const ZEC_USD_URL = BASE + '/api/zec-usd';

const ZAT = 1e8;
/** Tokens per trading lot. */
const LOT = 12500;
/** Nominal Zcash block interval, used when both anchors are unavailable. */
const BLOCK_SECONDS = 75;

/**
 * Second time anchor: the first $ZECAT trade, at block 3,470,323 on
 * 2026-09-03 09:05:51 UTC. See research/zecat-token-dossier.md section 2.2.
 *
 * Extrapolating backward from the tip at 75 seconds per block accumulates
 * error. Interpolating between known endpoints preserves both anchors and
 * measures the average block interval over this span.
 */
const FIRST_HEIGHT = 3470323;
const FIRST_TIME = '2026-09-03T09:05:51Z';

const PAGE = 2000;
/** Bound pagination so an upstream fault cannot keep the route running. */
const MAX_PAGES = 6;
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;

/** @type {{ body: object, expiresAt: number } | null} */
let cache = null;

/** Return null on timeout, network error, non-2xx, or malformed JSON. */
async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Number(null) and Number('') both equal zero. Return NaN for absent values
 * so downstream validation cannot mistake missing data for a real zero.
 */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** Accept either a bare array or a { data: [...] } response. */
function toList(payload) {
  const list = payload && payload.data ? payload.data : payload;
  return Array.isArray(list) ? list : [];
}

/**
 * Fetch up to MAX_PAGES of history, stopping on a short page. Return null
 * when the first page fails rather than inventing a history.
 */
async function loadHistory() {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const payload = await getJson(
      HISTORY_URL + '?asset=' + ASSET_ID + '&limit=' + PAGE + '&offset=' + page * PAGE,
    );
    if (!payload) return page === 0 ? null : rows;
    const list = toList(payload);
    rows.push(...list);
    if (list.length < PAGE) break;
  }
  return rows;
}

/**
 * Shape each row as [block, price, buy, sell]. Price is ZEC per 12,500-token
 * lot; buy and sell are ZEC flows in that block. Discard incomplete rows.
 */
function shape(rows) {
  const out = [];
  for (const r of rows) {
    const h = num(r && r.height);
    const p = num(r && r.priceZat) / ZAT;
    if (!finite(h) || !finite(p) || p <= 0) continue;
    const buy = num(r.buyZat) / ZAT;
    const sell = num(r.sellZat) / ZAT;
    out.push([
      h,
      Number(p.toFixed(8)),
      finite(buy) ? Number(buy.toFixed(6)) : 0,
      finite(sell) ? Number(sell.toFixed(6)) : 0,
    ]);
  }
  /* Upstream is newest first; chart data must be oldest first. */
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

/**
 * Count funding sources in recent fills. These chain-derived counts show
 * shielded versus transparent funding rather than a marketing estimate.
 */
function fundingMix(payload) {
  const list = toList(payload);
  if (!list.length) return null;
  let shielded = 0;
  let transparent = 0;
  for (const f of list) {
    if (f && f.funding === 'shielded') shielded++;
    else if (f && f.funding === 'transparent') transparent++;
  }
  if (shielded + transparent === 0) return null;
  return { shielded, transparent, sampled: shielded + transparent };
}

async function build() {
  if (cache && cache.expiresAt > Date.now()) return cache.body;

  const [history, health, fills, zecPayload] = await Promise.all([
    loadHistory(),
    getJson(HEALTH_URL),
    getJson(FILLS_URL + '?asset=' + ASSET_ID + '&limit=500&offset=0'),
    getJson(ZEC_USD_URL),
  ]);

  const points = history ? shape(history) : [];

  const h = health && health.data ? health.data : health;
  const tipHeight = num(h && h.tipHeight);
  const tipTime = h && typeof h.lastSyncAt === 'string' ? h.lastSyncAt : null;

  /* Without a time anchor or enough points, report unavailable rather than
     returning a misleading chart. */
  const usable = points.length > 1 && finite(tipHeight) && tipTime !== null;

  const zecUsd = num(
    (zecPayload && zecPayload.data && zecPayload.data.usd) ?? (zecPayload && zecPayload.usd),
  );

  /* Measure seconds per block between the two anchors only when the tip is
     sufficiently far beyond the first anchor. */
  const spanBlocks = finite(tipHeight) ? tipHeight - FIRST_HEIGHT : 0;
  const spanMs = tipTime ? Date.parse(tipTime) - Date.parse(FIRST_TIME) : NaN;
  const measured = spanBlocks > 1000 && finite(spanMs) && spanMs > 0
    ? spanMs / 1000 / spanBlocks
    : null;

  const body = {
    ok: true,
    source: usable ? 'live' : 'unavailable',
    anchorHeight: FIRST_HEIGHT,
    anchorTime: FIRST_TIME,
    /** Measured seconds per block; null tells the browser to use 75. */
    measuredBlockSeconds: measured ? Number(measured.toFixed(3)) : null,
    takenAt: new Date().toISOString(),
    tipHeight: finite(tipHeight) ? tipHeight : null,
    tipTime,
    blockSeconds: BLOCK_SECONDS,
    lot: LOT,
    zecUsd: finite(zecUsd) && zecUsd > 0 ? zecUsd : null,
    funding: fundingMix(fills),
    /** [block, ZEC per lot, ZEC bought, ZEC sold], oldest first. */
    points: usable ? points : [],
  };

  /* Cache failures for only ten seconds so recovery is picked up quickly. */
  cache = { body, expiresAt: Date.now() + (usable ? CACHE_TTL_MS : 10_000) };
  return body;
}

export default async function handler(request, response) {
  const method = (request.method || 'GET').toUpperCase();

  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (method !== 'GET' && method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    response.status(405).end(JSON.stringify({ ok: false, error: 'method not allowed' }));
    return;
  }

  let body;
  try {
    body = await build();
  } catch {
    /* Never throw out of the handler. */
    body = {
      ok: true, source: 'unavailable', takenAt: new Date().toISOString(),
      tipHeight: null, tipTime: null, blockSeconds: BLOCK_SECONDS, lot: LOT,
      anchorHeight: FIRST_HEIGHT, anchorTime: FIRST_TIME, measuredBlockSeconds: null,
      zecUsd: null, funding: null, points: [],
    };
  }

  response.setHeader(
    'Cache-Control',
    body.source === 'live'
      ? 'public, s-maxage=60, stale-while-revalidate=600'
      : 'public, s-maxage=10',
  );

  if (method === 'HEAD') {
    response.status(200).end();
    return;
  }

  response.status(200).end(JSON.stringify(body));
}
