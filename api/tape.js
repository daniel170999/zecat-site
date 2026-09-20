/**
 * GET /api/tape  —  the $ZECAT market tape.
 *
 * Reads the public shld.fun indexer, derives the handful of numbers the site
 * ticker needs, and answers with HTTP 200 JSON no matter what happens upstream.
 * When the indexer is slow, down, or missing the asset, the bundled snapshot
 * below is served instead with "source":"snapshot" — the front end never has to
 * handle an error shape.
 *
 * Upstream (read-only, no auth):
 *   https://shld.fun/zsa/api/tokens    every asset + .market
 *   https://shld.fun/api/zec-usd       { data: { usd } }
 *
 * Env vars: NONE. No npm dependencies. Node 20 global fetch, ESM.
 * Caching: 30 s in module scope + CDN s-maxage=30, stale-while-revalidate=300.
 */

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** $ZECAT asset id on Zcash (ZSA). */
const ASSET_ID = 'dbc23d99cf614e1146c1c49d8e94646227f71c59cb1c2ea3731ce264c48bc32a';

export const TOKENS_URL = 'https://shld.fun/zsa/api/tokens';
export const ZEC_USD_URL = 'https://shld.fun/api/zec-usd';

/** zatoshi -> ZEC. */
const ZAT = 1e8;
/** total supply, used to turn market cap into a per-token price. */
const SUPPLY = 1e9;

/** hard ceiling on each upstream call, ms. */
const FETCH_TIMEOUT_MS = 6000;
/** how long a good read stays warm in this instance, ms. */
const CACHE_TTL_MS = 30_000;

/**
 * Last known-good read, bundled so the route always has something true-ish to
 * say. Taken 2026-09-19T23:10:00Z at indexer tip block 3489336.
 * takenAt is FIXED on purpose: it tells the caller how stale the fallback is.
 */
export const SNAPSHOT = Object.freeze({
  ok: true,
  source: 'snapshot',
  takenAt: '2026-09-20T23:37:20.015Z',
  data: Object.freeze({
    priceZecPerToken: 7.738680000000001e-7,
    mcapZec: 773.868,
    liqZec: 93.096345,
    vol24Zec: 7.9747107,
    change24Pct: -11.45,
    change7dPct: 73.31,
    positions: 2203,
    zecUsd: 1515.15,
    tipHeight: 3490507,
    graduated: true,
    rank: 1,
  }),
});

// ---------------------------------------------------------------------------
// module-scope cache (survives between invocations on a warm lambda)
// ---------------------------------------------------------------------------

/** @type {{ body: object, expiresAt: number } | null} */
let cache = null;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Fetch JSON with an AbortController timeout. Never rejects — returns null on
 * timeout, network error, non-2xx, or unparseable body. That lets both upstream
 * calls ride in one Promise.all without one failure killing the other.
 */
export async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** true only for real, usable numbers (rejects NaN, Infinity, null, ''). */
function finite(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Parse an upstream number. The indexer sends zatoshi amounts as strings, and a
 * field it has no value for arrives as null.
 *
 * Number(null) and Number('') are both 0, so a plain Number() call turns "we did
 * not get this number" into "this number is zero", and 0 walks straight past the
 * finite() gate below. That is how a dead upstream ends up published as a real
 * reading of zero. Return NaN for anything that is not an actual number.
 */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

/**
 * The tokens endpoint may answer as a bare array or wrapped in { data: [...] }.
 * Coerce to an array of token objects; anything else becomes [].
 */
function toList(tokens) {
  const list = tokens && tokens.data ? tokens.data : tokens;
  return Array.isArray(list) ? list : [];
}

/**
 * Derive the tape from the two upstream payloads.
 * Returns null if anything required is missing or non-finite, which sends the
 * caller to the bundled snapshot.
 */
export function derive(tokens, zecUsdPayload) {
  const list = toList(tokens);
  if (list.length === 0) return null;

  const t = list.find((x) => x && x.assetId === ASSET_ID);
  if (!t || !t.market) return null;
  const m = t.market;

  // core numbers, exactly per the tape contract
  const mcapZec = num(m.marketCapZat) / ZAT;
  const priceZecPerToken = mcapZec / SUPPLY;
  // a constant product pool holds equal value on both sides at spot, so the
  // whole pool is twice the ZEC reserve
  const liqZec = (num(m.pool && m.pool.reserveZat) * 2) / ZAT;
  const vol24Zec = num(m.vol24Zat) / ZAT;
  // '|| 0' here used to turn 'the indexer did not send this' into 'this is
  // zero', and zero walks straight through the finite() gate below. Route
  // every field through num() so an absent one is NaN and trips the fallback.
  const change24Pct = num(m.priceChange && m.priceChange.d1Bps) / 100;
  const change7dPct = num(m.priceChange && m.priceChange.d7Bps) / 100;
  const positions = num(m.positionsCount);
  const graduated = Boolean(m.graduated);
  // display only, so an absent tip reads as unknown rather than block zero
  const tipHeight = finite(t.tipHeight) ? t.tipHeight : null;

  // rank = 1-based place by market cap, biggest first, across every token
  const rank =
    list
      .slice()
      .sort(
        (a, b) =>
          Number((b.market && b.market.marketCapZat) || 0) -
          Number((a.market && a.market.marketCapZat) || 0),
      )
      .findIndex((x) => x && x.assetId === ASSET_ID) + 1;

  // zec price in usd: .data.usd, falling back to a flat .usd
  // Number(null) and Number('') are both 0, so a dead price endpoint used to
  // publish zecUsd: 0 under source 'live' and every usd figure read $0.00.
  const zecUsd = num(
    (zecUsdPayload && zecUsdPayload.data && zecUsdPayload.data.usd) ??
      (zecUsdPayload && zecUsdPayload.usd),
  );

  const data = {
    priceZecPerToken,
    mcapZec,
    liqZec,
    vol24Zec,
    change24Pct,
    change7dPct,
    positions,
    zecUsd,
    tipHeight,
    graduated,
    rank,
  };

  // one bad number poisons the whole tape — fall back rather than print junk
  const mustBeFinite = [
    priceZecPerToken,
    mcapZec,
    liqZec,
    vol24Zec,
    change24Pct,
    change7dPct,
    positions,
    zecUsd,
    rank,
  ];
  // tipHeight is deliberately nullable a few lines up: it is display only.
  // Requiring it here meant one missing cosmetic field threw away a whole
  // good read of the market.
  if (!mustBeFinite.every(finite)) return null;
  if (rank < 1) return null;

  return {
    ok: true,
    source: 'live',
    takenAt: new Date().toISOString(),
    data,
  };
}

/** Build the response body: cache -> live -> snapshot, in that order. */
async function buildTape() {
  // 1. warm cache wins, so a burst of visitors hits the indexer once
  if (cache && cache.expiresAt > Date.now()) return cache.body;

  // 2. both upstreams in parallel; getJson already swallows its own failures
  const [tokens, zecUsdPayload] = await Promise.all([
    getJson(TOKENS_URL),
    getJson(ZEC_USD_URL),
  ]);

  const live = derive(tokens, zecUsdPayload);
  if (live) {
    cache = { body: live, expiresAt: Date.now() + CACHE_TTL_MS };
    return live;
  }

  // 3. anything went wrong -> bundled snapshot. Cache it too, so a dead
  //    indexer is not retried on every single request.
  cache = { body: SNAPSHOT, expiresAt: Date.now() + CACHE_TTL_MS };
  return SNAPSHOT;
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

  let body;
  try {
    body = await buildTape();
  } catch {
    // belt and braces: nothing throws out of this handler, ever
    body = SNAPSHOT;
  }

  // A fallback must not be pinned at the CDN for five minutes after the
  // indexer comes back. Cache the real read hard, the stale one barely.
  response.setHeader(
    'Cache-Control',
    body.source === 'live'
      ? 'public, s-maxage=30, stale-while-revalidate=300'
      : 'public, s-maxage=5',
  );

  if (method === 'HEAD') {
    response.status(200).end();
    return;
  }

  response.status(200).end(JSON.stringify(body));
}
