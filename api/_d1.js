/**
 * Cloudflare D1 over its REST API  —  shared by /api/memes and /api/posts.
 *
 * D1 is optional. The site ships bundled JSON in public/data/ and every route
 * that uses this helper falls back to that file when D1 is not configured or
 * answers badly. So this module has exactly one job: talk to D1 honestly and
 * THROW when anything is off, so the caller can take the static road.
 *
 * Env vars (all three or nothing):
 *   CF_ACCOUNT_ID       Cloudflare account id
 *   CF_D1_DATABASE_ID   the D1 database uuid
 *   CF_API_TOKEN        API token with D1 read access
 *
 * No npm dependencies. Node 20 global fetch, ESM.
 *
 * A file whose name starts with "_" is not routed by Vercel, so this never
 * becomes a public endpoint — it is only ever imported.
 */

/** hard ceiling on the D1 round trip, ms. A slow db must not hold the page. */
const D1_TIMEOUT_MS = 6000;

/**
 * Read the three env vars at call time, never at import time.
 * Vercel populates process.env per invocation, and reading late also means a
 * redeploy that adds the vars starts working without a code change.
 */
function d1Env() {
  return {
    accountId: process.env.CF_ACCOUNT_ID,
    databaseId: process.env.CF_D1_DATABASE_ID,
    token: process.env.CF_API_TOKEN,
  };
}

/**
 * True only when all three env vars are present and non-empty.
 * Callers use this to decide whether to try D1 at all.
 *
 * @returns {boolean}
 */
export function d1Configured() {
  const { accountId, databaseId, token } = d1Env();
  return Boolean(accountId && databaseId && token);
}

/**
 * Run one SQL statement against D1 and hand back the rows.
 *
 * Cloudflare answers  { success, result: [ { results: [...] } ] }  for a single
 * statement, so the rows live at result[0].results.
 *
 * THROWS on: missing config, timeout, network error, non-2xx, unparseable body,
 * or success:false. Every caller is expected to catch and fall back to static.
 *
 * @param {string} sql          one statement, with ? placeholders
 * @param {Array<unknown>} params  bound values, in order
 * @returns {Promise<Array<Record<string, unknown>>>} row objects, possibly empty
 */
export async function d1Query(sql, params = []) {
  const { accountId, databaseId, token } = d1Env();
  if (!accountId || !databaseId || !token) {
    throw new Error('d1: not configured');
  }

  /* CF_D1_ENDPOINT overrides the Cloudflare API host for local tests or a
     future trusted proxy. The default is Cloudflare's production API.
     Only project administrators can set this environment variable; the same
     access also permits changing CF_API_TOKEN. */
  const base = process.env.CF_D1_ENDPOINT || "https://api.cloudflare.com";
  const url =
    `${base}/client/v4/accounts/${accountId}` +
    `/d1/database/${databaseId}/query`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), D1_TIMEOUT_MS);

  let res;
  let payload;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ sql, params }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`d1: http ${res.status}`);
    payload = await res.json();
  } finally {
    // always clear, including on the abort path, so the lambda can settle
    clearTimeout(timer);
  }

  if (!payload || payload.success !== true) {
    // surface Cloudflare's own message when it sent one; it names the bad table
    const errors = payload && Array.isArray(payload.errors) ? payload.errors : [];
    const detail = errors.map((e) => (e && e.message) || String(e)).join('; ');
    throw new Error(`d1: query failed${detail ? ` (${detail})` : ''}`);
  }

  const first = Array.isArray(payload.result) ? payload.result[0] : null;
  const rows = first && Array.isArray(first.results) ? first.results : [];
  return rows;
}
