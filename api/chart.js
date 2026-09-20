/**
 * GET /api/chart  —  lich su gia cua $ZECAT, du de ve bieu do nen.
 *
 * SHLD.fun khong tra ve nen (OHLC). No tra ve MOT dong gia cho MOI BLOCK co
 * giao dich. Route nay gom ca lich su do lai, chuan hoa don vi, va giao viec
 * gop thanh nen cho phia trinh duyet — nho vay doi khung thoi gian khong phai
 * goi mang lai.
 *
 * Upstream (cong khai, khong can khoa):
 *   /zsa/api/price-history?asset=..&limit=2000&offset=..   gia theo block
 *   /zsa/api/health                                        tip height + gio
 *   /zsa/api/fills?asset=..&limit=500                      nguon von tung lenh
 *   /api/zec-usd                                           gia ZEC
 *
 * VE THOI GIAN: chuoi du lieu khong mang moc thoi gian, chi mang so block.
 * Gio duoc suy ra tu tip: t(h) = tipTime - (tipHeight - h) * 75 giay. Zcash
 * nham 75 giay mot block nhung khong dung tuyet doi, nen truc thoi gian la
 * XAP XI. Giao dien phai noi ro dieu do thay vi lam nhu no chinh xac.
 *
 * Env vars: KHONG. Khong dependency. Node 20, fetch toan cuc, ESM.
 */

const ASSET_ID = 'dbc23d99cf614e1146c1c49d8e94646227f71c59cb1c2ea3731ce264c48bc32a';

const BASE = 'https://shld.fun';
const HISTORY_URL = BASE + '/zsa/api/price-history';
const HEALTH_URL = BASE + '/zsa/api/health';
const FILLS_URL = BASE + '/zsa/api/fills';
const ZEC_USD_URL = BASE + '/api/zec-usd';

const ZAT = 1e8;
/** mot lenh khop theo lo; day la so token trong mot lo. */
const LOT = 12500;
/** nhip danh nghia cua Zcash, giay. Chi dung khi khong neo duoc hai dau. */
const BLOCK_SECONDS = 75;

/**
 * Neo thu hai: giao dich dau tien cua $ZECAT.
 * Block 3.470.323, 2026-09-03 09:05:51 UTC — doc tren chain, ghi trong
 * research/zecat-token-dossier.md muc 2.2.
 *
 * Vi sao can den no: neu chi neo o tip roi lui lai 75 giay mot block thi sau
 * 20.000 block sai so don len gan hai tieng, va ca truc thoi gian lech. Noi
 * suy tuyen tinh giua hai diem da biet thi hai dau deu dung, va nhip block
 * that duoc tinh ra chu khong phai doan.
 */
const FIRST_HEIGHT = 3470323;
const FIRST_TIME = '2026-09-03T09:05:51Z';

const PAGE = 2000;
/** tran so trang, de mot upstream hong khong keo route chay mai. */
const MAX_PAGES = 6;
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;

/** @type {{ body: object, expiresAt: number } | null} */
let cache = null;

/** Doc JSON, khong bao gio nem loi: het gio / loi mang / 4xx / rac deu ra null. */
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
 * Number(null) va Number('') deu bang 0, nen mot truong vang mat se bien
 * thanh mot con so that. Tra NaN de cong kiem tra o duoi chan lai.
 */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** Chuoi tra ve co the la mang tran hoac boc trong { data: [...] }. */
function toList(payload) {
  const list = payload && payload.data ? payload.data : payload;
  return Array.isArray(list) ? list : [];
}

/**
 * Keo het lich su, tung trang 2000 dong, cho toi khi upstream tra ve it hon
 * mot trang day. Tra null neu trang dau tien da hong — khong doan.
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
 * Doi tung dong thanh [block, gia, mua, ban].
 *   gia  ZEC cho mot lo 12.500 token
 *   mua  ZEC do vao block do
 *   ban  ZEC rut ra o block do
 * Dong nao thieu block hoac thieu gia thi bo, con hon la ve mot diem sai.
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
  /* upstream tra ve moi nhat truoc; bieu do can cu nhat truoc */
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

/**
 * Dem nguon von cua cac lenh gan nhat.
 * Day la con so trung tam cua ca du an: bao nhieu phan tram nguoi mua tra
 * bang so du shielded. No doc duoc tu chain, khong phai tu loi quang cao.
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

  /* Khong co neo thoi gian thi khong the dung truc thoi gian that. Va khong
     co diem nao thi khong co gi de ve. Ca hai truong hop deu tra ve ro rang
     thay vi tra ve mot bieu do sai. */
  const usable = points.length > 1 && finite(tipHeight) && tipTime !== null;

  const zecUsd = num(
    (zecPayload && zecPayload.data && zecPayload.data.usd) ?? (zecPayload && zecPayload.usd),
  );

  /* Nhip block that, tinh tu hai neo. Chi dung khi tip nam sau neo dau va
     khoang cach du lon de con so co nghia. */
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
    /** giay mot block, do tu hai neo. null thi phia trinh duyet dung 75. */
    measuredBlockSeconds: measured ? Number(measured.toFixed(3)) : null,
    takenAt: new Date().toISOString(),
    tipHeight: finite(tipHeight) ? tipHeight : null,
    tipTime,
    blockSeconds: BLOCK_SECONDS,
    lot: LOT,
    zecUsd: finite(zecUsd) && zecUsd > 0 ? zecUsd : null,
    funding: fundingMix(fills),
    /** [block, ZEC mot lo, ZEC mua, ZEC ban], cu nhat truoc */
    points: usable ? points : [],
  };

  /* Ban hong chi giu 10 giay, de indexer song lai la lay duoc ngay. */
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
    /* khong bao gio nem ra khoi handler */
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
