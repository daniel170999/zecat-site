/* ===========================================================================
   sync-data.mjs  -  keep generated site data consistent
   ---------------------------------------------------------------------------
   public/index.html is the source of truth for bundled memes and posts.
   This is a maintenance tool, not a deployment build step.

       node tools/sync-data.mjs
           Extract tiles and posts to public/data/*.json API fallbacks, then
           stamp measured thumbnail width/height on each HTML image.

       node tools/sync-data.mjs --tape
           Also refresh market data from shld.fun in public/data/tape.json,
           the HTML snapshot and timestamp, and api/tape.js SNAPSHOT.

       node tools/sync-data.mjs --origin https://zecat.st
           Also update absolute social image URLs, canonical, og:url, the
           sitemap, and robots.txt. Use when the production domain changes.
           Without an argument, reads the Vercel production URL variable.

   A nonzero exit code indicates a mismatch that must be fixed before pushing.
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

const memes = await Promise.all(tiles.map(async (chunk, i) => {
  const slug = attr(chunk, 'slug');
  let size = null;
  if (/^[a-zA-Z0-9_-]+$/.test(slug)) {
    try {
      size = jpegSize(await readFile(join(publicDir, 'thumb', slug + '.jpg')));
    } catch { /* The dimension-stamping step reports missing files. */ }
  }
  return {
    id: i + 1,
    slug,
    title: attr(chunk, 'title'),
    alt: attr(chunk, 'alt'),
    tag: attr(chunk, 'tag') || 'scene',
    credit: null,
    featured: i < 3 ? 1 : 0,
    sort: (i + 1) * 10,
    w: size?.w || 0,
    h: size?.h || 0,
  };
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

/* ------------------------------------------------------------- db/seed.sql

   Generate seed.sql from the just-written JSON files, not a manual copy.

   A former manual seed diverged from the pinned X post. Generate from the
   published HTML so the D1 archive matches the linked original text.

   Never seed the admin table here. This file contains no password, hash,
   or salt. Use tools/set-password.mjs for admin credentials. */

{
  const q = (v) => (v === null || v === undefined ? 'NULL' : "'" + String(v).split("'").join("''") + "'");
  const n = (v) => (v === null || v === undefined || v === '' ? 'NULL' : Number(v));

  const lines = [
    '-- GENERATED by tools/sync-data.mjs. Do not edit by hand.',
    '-- Source: public/index.html via public/data/*.json.',
    '--',
    '-- Apply from the site/ directory:',
    '--   npx wrangler d1 execute zecat --remote --file=./db/schema.sql',
    '--   npx wrangler d1 execute zecat --remote --file=./db/seed.sql',
    '--',
    '-- Post bodies archive published X posts. Preserve their exact text,',
    '-- including lowercase, to avoid misquoting the originals.',
    '--',
    '-- No password is stored here. Set the admin verifier separately.',
    '',
    'INSERT OR IGNORE INTO memes (id, slug, title, alt, tag, credit, featured, sort, stored) VALUES',
    memes.map((m) => '  (' + [
      m.id, q(m.slug), q(m.title), q(m.alt), q(m.tag), q(m.credit),
      m.featured ? 1 : 0, m.sort, 0,
    ].join(', ') + ')').join(',\n') + ';',
    '',
    'INSERT OR IGNORE INTO posts (id, posted_at, body, views, url, pinned) VALUES',
    posts.map((p) => '  (' + [
      p.id, q(p.posted_at), q(p.body), q(p.views), q(p.url), p.pinned ? 1 : 0,
    ].join(', ') + ')').join(',\n') + ';',
    '',
  ];

  await writeFile(join(root, 'db', 'seed.sql'), lines.join('\n'));
  console.log('sync-data: regenerated db/seed.sql from the same source');
}

console.log('sync-data: wrote ' + memes.length + ' memes and ' + posts.length + ' posts to public/data/');
console.log('  tags: ' + [...new Set(memes.map((m) => m.tag))].join(', '));

/* ----------------------------------------------------------- image dimensions

   Each gallery image needs real width/height attributes to reserve space
   before loading and prevent layout shift.

   Read JPEG SOF markers directly so HTML dimensions match the files.       */

function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;          // Not JPEG.
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    // SOF0..SOF15, excluding DHT (c4), JPG (c8), and DAC (cc).
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
    // The slug becomes a file path, so accept only safe characters.
    if (!/^[a-zA-Z0-9_-]+$/.test(m.slug)) { missed.push(m.slug); continue; }

    const size = m.w > 0 && m.h > 0 ? { w: m.w, h: m.h } : null;
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
  console.log('sync-data: stamped real dimensions on ' + stamped.length + ' images');
  if (missed.length) {
    console.error('sync-data: could not measure ' + missed.length + ' images: ' + missed.join(', '));
    console.error('  missing public/thumb/ file or unexpected <img> markup.');
    process.exit(1);
  }
}

/* ==========================================================================
   --tape  -  refresh the embedded market snapshot and chart fallback
   --------------------------------------------------------------------------
   Visitors without JavaScript and search/social bots see the embedded HTML
   figures. They must carry a timestamp and source link, not invented values.

   Invoke the API logic directly rather than duplicating its formulas, then
   update all four outputs together:
     public/data/tape.json    market fallback
     public/data/chart.json   chart fallback
     public/index.html        visible figures and timestamp
     api/tape.js              SNAPSHOT constant
   ========================================================================== */

if (process.argv.includes('--tape')) {
  const { derive, getJson, TOKENS_URL, ZEC_USD_URL } = await import('../api/tape.js');
  const { default: chartHandler } = await import('../api/chart.js');

  /* Invoke the chart route as Vercel does, with a response shim that captures
     its body, so the fallback uses exactly the live handler's logic. */
  const chartBody = await new Promise((resolve, reject) => {
    let payload = '';
    const res = {
      setHeader() {},
      status() { return res; },
      end(b) { payload = b; resolve(JSON.parse(payload || '{}')); },
    };
    chartHandler({ method: 'GET', url: '/api/chart', query: {} }, res).catch(reject);
  });

  const [tokens, zecUsd] = await Promise.all([getJson(TOKENS_URL), getJson(ZEC_USD_URL)]);
  const live = derive(tokens, zecUsd);

  if (!live) {
    console.error('sync-data --tape: indexer returned invalid data; nothing written.');
    process.exit(1);
  }

  const d = live.data;

  /* Keep these formatters identical to nf() and usd() in site.js. Otherwise
     the embedded figures change visibly when JavaScript starts. */
  const nf = (n, k = 2) =>
    Number(n).toLocaleString('en-us', { minimumFractionDigits: k, maximumFractionDigits: k });
  const usd = (n) => {
    if (!isFinite(n)) return '';
    if (n >= 1e6) return '$' + nf(n / 1e6, 2) + 'm';
    if (n >= 1e3) return '$' + nf(n / 1e3, 1) + 'k';
    return '$' + nf(n, 2);
  };

  const z = d.zecUsd;
  /* Per TOKEN. The lot of 12,500 is a fill rule, not a price. */
  const perToken = d.priceZecPerToken;
  const money = (v, k) => nf(v, k) + ' zec <span class="muted">' + usd(v * z) + '</span>';

  const at = new Date(live.takenAt);
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    'Read ' + at.getUTCDate() + ' ' + MON[at.getUTCMonth()] + ' ' + at.getUTCFullYear() +
    ', ' + pad(at.getUTCHours()) + ':' + pad(at.getUTCMinutes()) + ' UTC';

  /* ---- 1. Static fallbacks ---- */
  await writeFile(
    join(dataDir, 'tape.json'),
    JSON.stringify({ ok: true, source: 'snapshot', takenAt: live.takenAt, data: d }, null, 2) + '\n',
  );

  const chartPoints = Array.isArray(chartBody.points) ? chartBody.points.length : 0;
  if (chartPoints > 1) {
    await writeFile(
      join(dataDir, 'chart.json'),
      JSON.stringify({ ...chartBody, source: 'snapshot' }) + '\n',
    );
  } else {
    console.error('sync-data --tape: /api/chart returned no history; chart.json skipped.');
  }

  /* ---- 2. Embedded HTML figures ----
     Use a replacement function: dollar signs in values such as '$1.01m'
     would be interpreted as capture references in a replacement string. */
  let page = await readFile(htmlPath, 'utf8');
  let patched = 0;

  const put = (re, value, what) => {
    if (!re.test(page)) {
      console.error('sync-data --tape: could not find ' + what + ' in index.html');
      process.exit(1);
    }
    page = page.replace(re, (_m, a, b) => a + value + b);
    patched++;
  };

  put(/(<b id="px-main">)[\s\S]*?(<\/b>)/, nf(perToken, 8) + ' <i>zec</i>', 'hero price');
  put(/(<span id="px-usd">)[^<]*(<\/span>)/, '$' + nf(perToken * z, 6), 'USD price');

  /* Match the sign and up/down class that site.js will render. */
  const chg = d.change24Pct;
  page = page.replace(
    /<span id="px-chg" class="delta[^"]*">[^<]*<\/span>/,
    () => '<span id="px-chg" class="delta ' + (chg >= 0 ? 'up' : 'down') + '">' +
          (chg >= 0 ? '+' : '') + nf(chg, 2) + '%</span>',
  );
  patched++;

  const tiles = {
    mcap: money(d.mcapZec, 0),
    liq: money(d.liqZec, 1),
    vol: money(d.vol24Zec, 1),
    positions: Number(d.positions).toLocaleString('en-us'),
    rank: '#' + d.rank,
  };

  /* Funding mix. Gray denotes publicly exposed transparent funding, per
     brand/CHARACTER.md section 3. */
  const f = chartBody.funding;
  if (f && f.sampled > 0) {
    const pct = (f.shielded / f.sampled) * 100;
    tiles.shielded = nf(pct, 1) + '%' +
      (f.transparent > 0
        ? ' <span class="exposed">' + f.transparent + ' not</span>'
        : '');
  }

  for (const [field, value] of Object.entries(tiles)) {
    put(
      new RegExp('(<div class="stat[^"]*" data-field="' + field + '"><span>[^<]*</span><b>)[\\s\\S]*?(</b>)'),
      value,
      'stat "' + field + '"',
    );
  }

  put(/(<span id="tape-stamp">)[^<]*(<\/span>)/, stamp, 'timestamp');
  await writeFile(htmlPath, page);

  /* ---- 3. SNAPSHOT constant in api/tape.js ---- */
  const tapePath = join(root, 'api', 'tape.js');
  const tapeSrc = await readFile(tapePath, 'utf8');
  const open = 'export const SNAPSHOT = Object.freeze({';
  const start = tapeSrc.indexOf(open);
  const end = start === -1 ? -1 : tapeSrc.indexOf('\n});', start);
  if (start === -1 || end === -1) {
    console.error('sync-data --tape: SNAPSHOT block missing from api/tape.js');
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

  console.log('sync-data --tape: updated ' + patched + ' places in index.html');
  console.log('  chart.json: ' + chartPoints + ' price points from block ' + chartBody.anchorHeight);
  console.log('  ' + stamp + ' | ' + nf(perToken, 8) + ' zec per token | block ' + d.tipHeight);
}

/* ==========================================================================
   --origin  -  set the production domain consistently
   --------------------------------------------------------------------------
   Relative site paths work before a domain is known, but social previews
   require an absolute og:image URL.

       node tools/sync-data.mjs --origin https://zecat.st

   Without an argument, read VERCEL_PROJECT_PRODUCTION_URL or VERCEL_URL.
   Re-running with a different domain replaces the old origin.
   ========================================================================== */

{
  const i = process.argv.indexOf('--origin');
  if (i !== -1) {
    const given = process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
      ? process.argv[i + 1]
      : process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '';

    if (!given) {
      console.error('sync-data --origin: no domain or Vercel URL variable found.');
      console.error('  example: node tools/sync-data.mjs --origin https://zecat.st');
      process.exit(1);
    }

    let origin;
    try {
      origin = new URL(/^https?:\/\//.test(given) ? given : 'https://' + given).origin;
    } catch {
      console.error('sync-data --origin: "' + given + '" is not a valid URL.');
      process.exit(1);
    }

    let page = await readFile(htmlPath, 'utf8');

    /* Social image URLs must be absolute for X to display previews. */
    page = page.replace(
      /(<meta property="og:image" content=")[^"]*(">)/,
      (_m, a, b) => a + origin + '/brand/og.png' + b,
    );
    page = page.replace(
      /(<meta name="twitter:image" content=")[^"]*(">)/,
      (_m, a, b) => a + origin + '/brand/og.png' + b,
    );

    /* Add or replace canonical and og:url. */
    const canonical = '<link rel="canonical" href="' + origin + '/">';
    const ogUrl = '<meta property="og:url" content="' + origin + '/">';

    page = /<link rel="canonical"/.test(page)
      ? page.replace(/<link rel="canonical"[^>]*>/, () => canonical)
      : page.replace('<link rel="icon"', () => canonical + '\n<link rel="icon"');

    page = /<meta property="og:url"/.test(page)
      ? page.replace(/<meta property="og:url"[^>]*>/, () => ogUrl)
      : page.replace('<meta property="og:title"', () => ogUrl + '\n<meta property="og:title"');

    await writeFile(htmlPath, page);

    /* The sitemap lists one page; other sections are anchors. Use the latest
       tape timestamp for lastmod instead of inventing an update date. */
    let lastmod = '';
    try {
      const t = JSON.parse(await readFile(join(dataDir, 'tape.json'), 'utf8'));
      lastmod = String(t.takenAt || '').slice(0, 10);
    } catch { /* No tape.json yet. */ }

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
    console.log('  updated absolute og:image, twitter:image, canonical, and og:url');
    console.log('  generated public/sitemap.xml and robots.txt Sitemap entry');
  }
}
