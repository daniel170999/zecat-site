/* ===========================================================================
   sync-data.mjs  ·  mot lenh, giu ca site khong lech nhau
   ---------------------------------------------------------------------------
   public/index.html la ban goc. Moi thu khac deu duoc suy ra tu no, hoac duoc
   dong nguoc len no, boi chinh file nay. Khong co buoc build nao khac.

       node tools/sync-data.mjs
           doc tung tile va tung post trong index.html, ghi public/data/*.json
           (nguon fallback cua cac route api), roi do kich thuoc that cua moi
           anh trong public/thumb/ va dong width/height len the <img>.

       node tools/sync-data.mjs --tape
           them: doc chi so thi truong that tu indexer cua shld.fun, ghi
           public/data/tape.json, cap nhat tam o tape va moc thoi gian trong
           index.html, va hang so SNAPSHOT trong api/tape.js.

       node tools/sync-data.mjs --origin https://ten-mien-cua-may
           them: doi og:image va twitter:image sang duong dan tuyet doi, dat
           canonical va og:url, sinh public/sitemap.xml va dong Sitemap vao
           public/robots.txt. Chay dung mot lan sau khi biet ten mien that.
           Bo trong gia tri thi doc tu bien moi truong cua Vercel.

   Thoat khac 0 la co gi do khong khop; doc dong bao loi roi sua truoc khi push.
   =========================================================================== */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const htmlPath = join(root, 'public', 'index.html');
const publicDir = join(root, 'public');
const dataDir = join(publicDir, 'data');

const html = await readFile(htmlPath, 'utf8');

const decode = (s) =>
  s.replace(/&amp;/g, '&')
   .replace(/&lt;/g, '<')
   .replace(/&gt;/g, '>')
   .replace(/&quot;/g, '"')
   .replace(/&#39;/g, "'")
   .replace(/&hellip;/g, '…')
   .replace(/&middot;/g, '·');

/* ------------------------------------------------------------------- memes */

const attr = (chunk, name) => {
  const m = chunk.match(new RegExp('data-' + name + '="([^"]*)"'));
  return m ? decode(m[1]) : '';
};

const tiles = [...html.matchAll(/<figure class="tile"[^>]*>/g)].map((m) => m[0]);

const memes = tiles.map((chunk, i) => ({
  id: i + 1,
  slug: attr(chunk, 'slug'),
  title: attr(chunk, 'title'),
  alt: attr(chunk, 'alt'),
  tag: attr(chunk, 'tag') || 'scene',
  credit: null,
  featured: i < 3 ? 1 : 0,
  sort: (i + 1) * 10,
}));

/* ------------------------------------------------------------------- posts */

const postBlocks = [...html.matchAll(
  /<a class="post([^"]*)" href="([^"]+)"[\s\S]*?<span class="meta">([\s\S]*?)<\/span>\s*<span class="body">([\s\S]*?)<\/span>/g,
)];

const stripTags = (s) => s.replace(/<[^>]+>/g, '\n').split(/\n+/).map((x) => x.trim()).filter(Boolean);

/* the html carries a human date like "8 sep 2026"; D1 wants something sortable */
const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
                 jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

const toISO = (human) => {
  const m = human.match(/([0-9]{1,2})\s+([a-z]{3})[a-z]*\s+([0-9]{4})/i);
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  return m[3] + '-' + mm + '-' + String(m[1]).padStart(2, '0') + 'T00:00:00Z';
};

const posts = postBlocks.map((m, i) => {
  const cls = m[1], url = m[2], meta = m[3], body = m[4];
  const bits = stripTags(meta);
  const dateBit = bits.find((b) => /[0-9]{4}/.test(b)) || '';
  const viewsBit = bits.find((b) => /view/i.test(b)) || '';
  return {
    id: i + 1,
    posted_at: toISO(dateBit) || dateBit,
    body: decode(body).trim(),
    /* TEXT on purpose, it is a display label like "2.9k" and not an amount */
    views: viewsBit.replace(/\s*views?\s*/i, '').trim() || null,
    url,
    pinned: cls.includes('pin') ? 1 : 0,
  };
});

/* ------------------------------------------------------------------- write */

if (!memes.length || !posts.length) {
  console.error(
    'sync-data: found ' + memes.length + ' memes and ' + posts.length + ' posts. ' +
    'the markup in public/index.html probably changed shape. fix this script before shipping.',
  );
  process.exit(1);
}

const missingField = memes.filter((m) => !m.slug || !m.title || !m.alt);
if (missingField.length) {
  console.error('sync-data: these tiles are missing a slug, title or alt: ' +
    missingField.map((m) => m.slug || '(no slug)').join(', '));
  process.exit(1);
}

await mkdir(dataDir, { recursive: true });
await writeFile(join(dataDir, 'memes.json'), JSON.stringify(memes, null, 2) + '\n');
await writeFile(join(dataDir, 'posts.json'), JSON.stringify(posts, null, 2) + '\n');

console.log('sync-data: wrote ' + memes.length + ' memes and ' + posts.length + ' posts to public/data/');
console.log('  tags: ' + [...new Set(memes.map((m) => m.tag))].join(', '));

/* -------------------------------------------------------------- kich thuoc anh

   Moi <img> trong tuong meme phai mang width va height that. Thieu no thi
   trinh duyet khong biet chua bao nhieu cho, anh nhay vao lam ca trang giat
   mot cai khi tai xong. Bo anh nay cao thap lech nhau nen cang de thay.

   Doc thang tu file jpg, khong dung thu vien: tim marker SOF trong header.
   Chay moi lan sync nen so tren html khong the lech voi file tren dia.        */

function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;          // khong phai jpeg
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    // SOF0..SOF15, tru DHT (c4), JPG (c8) va DAC (cc)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

{
  let page = await readFile(htmlPath, 'utf8');
  const stamped = [];
  const missed = [];

  for (const m of memes) {
    // slug thanh duong dan file, nen chi chap nhan slug sach
    if (!/^[a-zA-Z0-9_-]+$/.test(m.slug)) { missed.push(m.slug); continue; }

    let size = null;
    try {
      size = jpegSize(await readFile(join(publicDir, 'thumb', m.slug + '.jpg')));
    } catch { /* file chua co */ }
    if (!size) { missed.push(m.slug); continue; }

    const re = new RegExp('<img src="thumb/' + m.slug + '[.]jpg"([^>]*?)>');
    if (!re.test(page)) { missed.push(m.slug); continue; }

    page = page.replace(re, (_full, rest) => {
      const clean = rest.replace(/\s+(?:width|height)="[0-9]+"/g, '');
      return '<img src="thumb/' + m.slug + '.jpg" width="' + size.w +
             '" height="' + size.h + '"' + clean + '>';
    });
    stamped.push(m.slug);
  }

  if (stamped.length) await writeFile(htmlPath, page);
  console.log('sync-data: dong kich thuoc that len ' + stamped.length + ' anh');
  if (missed.length) {
    console.error('sync-data: KHONG do duoc ' + missed.length + ' anh: ' + missed.join(', '));
    console.error('  thieu file trong public/thumb/, hoac the <img> doi hinh dang.');
    process.exit(1);
  }
}

/* ==========================================================================
   --tape  ·  lam moi so lieu thi truong da nuong san
   --------------------------------------------------------------------------
   Khach tat javascript, va con bot cua Google hay X, chi thay nhung con so
   nam san trong index.html. Chung KHONG duoc phep la so bia: moi o deu di kem
   moc thoi gian va link ve coin page, dung luat claim trong CLAUDE.md.

   Lenh nay doc thang indexer bang chinh ham derive() cua api/tape.js, khong
   chep lai cong thuc, roi ghi ba cho trong cung mot lan.
   ========================================================================== */

if (process.argv.includes('--tape')) {
  const { derive, getJson, TOKENS_URL, ZEC_USD_URL } = await import('../api/tape.js');

  const [tokens, zecUsd] = await Promise.all([getJson(TOKENS_URL), getJson(ZEC_USD_URL)]);
  const live = derive(tokens, zecUsd);

  if (!live) {
    console.error('sync-data --tape: indexer khong tra ve so dung, khong ghi gi ca.');
    process.exit(1);
  }

  const d = live.data;

  /* Hai ham nay phai khop TUNG CHU voi nf() va usd() trong
     public/assets/site.js. Do la ban goc. Sua ben do thi sua ca ben nay, neu
     khong thi con so nuong san se nhay mot nhip khi javascript chay len. */
  const nf = (n, k = 2) =>
    Number(n).toLocaleString('en-us', { minimumFractionDigits: k, maximumFractionDigits: k });
  const usd = (n) => {
    if (!isFinite(n)) return '';
    if (n >= 1e6) return '$' + nf(n / 1e6, 2) + 'm';
    if (n >= 1e3) return '$' + nf(n / 1e3, 1) + 'k';
    return '$' + nf(n, 2);
  };

  const z = d.zecUsd;
  const lot = d.priceZecPerToken * 12500;
  const sign = (n) => (n >= 0 ? '+' : '');

  const cells = {
    mcap:      [nf(d.mcapZec, 0) + ' zec',   usd(d.mcapZec * z)],
    lot:       [nf(lot, 4) + ' zec',         usd(lot * z) + ' per 12,500'],
    liq:       [nf(d.liqZec, 1) + ' zec',    usd(d.liqZec * z)],
    vol:       [nf(d.vol24Zec, 1) + ' zec',  usd(d.vol24Zec * z)],
    chg24:     [sign(d.change24Pct) + nf(d.change24Pct, 2) + '%', 'last 24 hours'],
    chg7d:     [sign(d.change7dPct) + nf(d.change7dPct, 2) + '%', 'last 7 days'],
    positions: [Number(d.positions).toLocaleString('en-us'), 'open on shld.fun'],
    rank:      ['#' + d.rank,                'of every token there'],
  };

  const cellClass = {
    lot: 'sm',
    chg24: d.change24Pct >= 0 ? 'up' : 'down',
    chg7d: d.change7dPct >= 0 ? 'up' : 'down',
  };

  const at = new Date(live.takenAt);
  const MON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    'read ' + at.getUTCDate() + ' ' + MON[at.getUTCMonth()] + ' ' + at.getUTCFullYear() +
    ', ' + pad(at.getUTCHours()) + ':' + pad(at.getUTCMinutes()) + ' utc';

  /* ---- 1. ban du phong tinh ---- */
  await writeFile(
    join(dataDir, 'tape.json'),
    JSON.stringify({ ok: true, source: 'snapshot', takenAt: live.takenAt, data: d }, null, 2) + '\n',
  );

  /* ---- 2. tam o trong index.html ----
     Thay bang HAM chu khong bang chuoi: gia tri usd co dau $, va '$1.01m'
     trong mot chuoi thay the se bi doc thanh nhom bat so 1. */
  let page = await readFile(htmlPath, 'utf8');
  let patched = 0;
  for (const [field, pair] of Object.entries(cells)) {
    const re = new RegExp(
      '(<div class="cell" data-field="' + field + '"><span>[^<]*</span>)<b[^>]*>[^<]*</b><em>[^<]*</em>',
    );
    if (!re.test(page)) {
      console.error('sync-data --tape: khong tim thay o "' + field + '" trong index.html');
      process.exit(1);
    }
    const c = cellClass[field] ? ' class="' + cellClass[field] + '"' : '';
    page = page.replace(re, (_m, head) => head + '<b' + c + '>' + pair[0] + '</b><em>' + pair[1] + '</em>');
    patched++;
  }

  const stampRe = /(<span id="tape-stamp">)[^<]*(<\/span>)/;
  if (!stampRe.test(page)) {
    console.error('sync-data --tape: khong tim thay #tape-stamp trong index.html');
    process.exit(1);
  }
  page = page.replace(stampRe, (_m, a, b) => a + stamp + b);
  await writeFile(htmlPath, page);

  /* ---- 3. hang so SNAPSHOT trong api/tape.js ---- */
  const tapePath = join(root, 'api', 'tape.js');
  const tapeSrc = await readFile(tapePath, 'utf8');
  const open = 'export const SNAPSHOT = Object.freeze({';
  const start = tapeSrc.indexOf(open);
  const end = start === -1 ? -1 : tapeSrc.indexOf('\n});', start);
  if (start === -1 || end === -1) {
    console.error('sync-data --tape: khong tim thay khoi SNAPSHOT trong api/tape.js');
    process.exit(1);
  }
  const keys = ['priceZecPerToken','mcapZec','liqZec','vol24Zec','change24Pct','change7dPct',
                'positions','zecUsd','tipHeight','graduated','rank'];
  const literal =
    open + '\n' +
    '  ok: true,\n' +
    "  source: 'snapshot',\n" +
    "  takenAt: '" + live.takenAt + "',\n" +
    '  data: Object.freeze({\n' +
    keys.map((k) => '    ' + k + ': ' + JSON.stringify(d[k]) + ',').join('\n') + '\n' +
    '  }),\n});';
  await writeFile(tapePath, tapeSrc.slice(0, start) + literal + tapeSrc.slice(end + 4));

  console.log('sync-data --tape: ' + patched + ' o tape + moc thoi gian trong index.html');
  console.log('  tape.json va hang so SNAPSHOT trong api/tape.js deu theo ban doc nay');
  console.log('  ' + stamp + ' | mcap ' + cells.mcap[0] + ' | block ' + d.tipHeight);
}

/* ==========================================================================
   --origin  ·  dat ten mien that vao mot cho duy nhat
   --------------------------------------------------------------------------
   Khi chua biet ten mien, trang van chay: moi duong dan deu tuong doi. Nhung
   X va Telegram KHONG doc duoc og:image tuong doi, nen link chia se se khong
   co anh cho toi khi lenh nay chay.

       node tools/sync-data.mjs --origin https://zecat.vercel.app

   Bo trong gia tri thi doc VERCEL_PROJECT_PRODUCTION_URL roi VERCEL_URL, nen
   dong nay cung dat vao Build Command tren Vercel neu sau nay muon tu dong.
   Chay lai voi ten mien khac la ghi de, khong nhan doi.
   ========================================================================== */

{
  const i = process.argv.indexOf('--origin');
  if (i !== -1) {
    const given = process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
      ? process.argv[i + 1]
      : process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '';

    if (!given) {
      console.error('sync-data --origin: chua co ten mien, va khong thay bien moi truong cua Vercel.');
      console.error('  vi du: node tools/sync-data.mjs --origin https://zecat.vercel.app');
      process.exit(1);
    }

    let origin;
    try {
      origin = new URL(/^https?:\/\//.test(given) ? given : 'https://' + given).origin;
    } catch {
      console.error('sync-data --origin: "' + given + '" khong phai mot dia chi hop le.');
      process.exit(1);
    }

    let page = await readFile(htmlPath, 'utf8');

    /* anh social phai tuyet doi, khong thi X bo qua */
    page = page.replace(
      /(<meta property="og:image" content=")[^"]*(">)/,
      (_m, a, b) => a + origin + '/brand/og.png' + b,
    );
    page = page.replace(
      /(<meta name="twitter:image" content=")[^"]*(">)/,
      (_m, a, b) => a + origin + '/brand/og.png' + b,
    );

    /* canonical + og:url. Them moi neu chua co, ghi de neu da co. */
    const canonical = '<link rel="canonical" href="' + origin + '/">';
    const ogUrl = '<meta property="og:url" content="' + origin + '/">';

    page = /<link rel="canonical"/.test(page)
      ? page.replace(/<link rel="canonical"[^>]*>/, () => canonical)
      : page.replace('<link rel="icon"', () => canonical + '\n<link rel="icon"');

    page = /<meta property="og:url"/.test(page)
      ? page.replace(/<meta property="og:url"[^>]*>/, () => ogUrl)
      : page.replace('<meta property="og:title"', () => ogUrl + '\n<meta property="og:title"');

    await writeFile(htmlPath, page);

    /* sitemap: mot trang, moi muc con lai la neo trong cung trang do nen khong
       liet ke rieng. Ngay lay tu moc doc tape gan nhat, khong bia. */
    let lastmod = '';
    try {
      const t = JSON.parse(await readFile(join(dataDir, 'tape.json'), 'utf8'));
      lastmod = String(t.takenAt || '').slice(0, 10);
    } catch { /* chua co tape.json */ }

    await writeFile(join(publicDir, 'sitemap.xml'),
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      '  <url>\n' +
      '    <loc>' + origin + '/</loc>\n' +
      (lastmod ? '    <lastmod>' + lastmod + '</lastmod>\n' : '') +
      '    <changefreq>daily</changefreq>\n' +
      '  </url>\n' +
      '</urlset>\n');

    const robots = await readFile(join(publicDir, 'robots.txt'), 'utf8').catch(() => '');
    const base = robots.split('\n').filter((l) => !/^sitemap:/i.test(l)).join('\n').trimEnd();
    await writeFile(join(publicDir, 'robots.txt'), base + '\nSitemap: ' + origin + '/sitemap.xml\n');

    console.log('sync-data --origin: ' + origin);
    console.log('  og:image, twitter:image, canonical va og:url doi sang tuyet doi');
    console.log('  sinh public/sitemap.xml, dong Sitemap vao public/robots.txt');
  }
}
