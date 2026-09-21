/* ===========================================================================
   $ZECAT site runtime
   ---------------------------------------------------------------------------
   Progressive enhancement, on purpose. Every meme, post and disclaimer is
   already in the html when this file loads, so the page reads correctly with
   javascript switched off and correctly before a single request returns.

   What this file adds on top:
     - the live 75 second block pulse and the block counter
     - the price header and the six stat tiles
     - the candlestick chart, built from one pull of the whole chain history
     - the cursor driven tilt on the hero coin
     - gallery filtering and the lightbox
     - real X embeds, with the static cards left in place when they fail
     - appending memes and posts that exist in D1 but are not baked in yet

   Data flow everywhere:  baked html  ->  /api/<thing>  ->  upgrade in place.
   A failed request is not an error state here. The page was already correct.
   =========================================================================== */

(() => {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const ASSET_ID    = document.documentElement.dataset.asset || '';
  const FIRST_TRADE = Date.parse('2026-09-03T09:05:51Z');  // block 3,470,323
  const BELL_MS     = 75000;                               // one Zcash block, near enough
  const REQ_TIMEOUT = 12000;
  const LOT         = 12500;

  const ok = (n) => typeof n === 'number' && isFinite(n);

  const nf = (n, d = 2) => Number(n).toLocaleString('en-us', {
    minimumFractionDigits: d, maximumFractionDigits: d,
  });

  const usd = (n) => {
    if (!isFinite(n)) return '';
    if (n >= 1e6) return '$' + nf(n / 1e6, 2) + 'm';
    if (n >= 1e3) return '$' + nf(n / 1e3, 1) + 'k';
    return '$' + nf(n, 2);
  };

  const signed = (n, d = 2) => (n >= 0 ? '+' : '') + nf(n, d) + '%';

  async function getJSON(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), REQ_TIMEOUT);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(String(r.status));
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  /* Exactly the shape tools/sync-data.mjs bakes into the html:
     "Read 20 Sep 2026, 22:49 UTC". Built by hand rather than with
     toUTCString, which returns "Sun, 20 Sep 2026 22:49:00 GMT", a format
     nobody asked for and which does not match the baked line. */
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pad = (n) => String(n).padStart(2, '0');

  function readStamp(iso) {
    const t = Date.parse(iso);
    if (!isFinite(t)) return '';
    const d = new Date(t);
    return 'Read ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear() +
      ', ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
  }

  /* ------------------------------------------------- the 75 second heartbeat */
  function heartbeat() {
    const bar = $('#pulse-bar');
    const count = $('#bells');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const bells = () => {
      if (!count) return;
      const n = Math.floor((Date.now() - FIRST_TRADE) / BELL_MS);
      if (n > 0) count.textContent = n.toLocaleString('en-us');
    };

    bells();
    if (!bar || reduce) { setInterval(bells, BELL_MS); return; }

    let last = -1;
    const frame = () => {
      const now = Date.now() - FIRST_TRADE;
      bar.style.transform = 'scaleX(' + ((now % BELL_MS) / BELL_MS).toFixed(4) + ')';
      const n = Math.floor(now / BELL_MS);
      if (n !== last) { last = n; bells(); }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------ price header and stats */

  function setStat(field, html) {
    const cell = $('.stat[data-field="' + field + '"] b');
    if (cell) cell.innerHTML = html;
  }

  function paintMarket(d, meta) {
    const zec = Number(d.zecUsd);
    /* Per TOKEN, not per lot. The lot of 12,500 is a fill rule and belongs in
       the buying guide; a price a reader compares against anything else has
       to be the price of one token. */
    const perToken = Number(d.priceZecPerToken);
    const chg = Number(d.change24Pct);

    if (ok(perToken) && perToken > 0) {
      const main = $('#px-main');
      if (main) main.innerHTML = nf(perToken, 8) + ' <i>zec</i>';
      const u = $('#px-usd');
      if (u) u.textContent = ok(zec) && zec > 0 ? '$' + nf(perToken * zec, 6) : '';
    }

    if (ok(chg)) {
      const el = $('#px-chg');
      if (el) {
        el.textContent = signed(chg);
        el.className = 'delta ' + (chg >= 0 ? 'up' : 'down');
      }
    }

    /* the six tiles. A tile is only written when its number is real, so a
       half-answer never produces a row of zeros. */
    const money = (v, digits) =>
      ok(v) ? nf(v, digits) + ' zec' + (ok(zec) && zec > 0 ? ' <span class="muted">' + usd(v * zec) + '</span>' : '') : null;

    const tiles = {
      mcap: money(d.mcapZec, 0),
      liq: money(d.liqZec, 1),
      vol: money(d.vol24Zec, 1),
      positions: ok(Number(d.positions)) ? Number(d.positions).toLocaleString('en-us') : null,
      rank: ok(Number(d.rank)) ? '#' + d.rank : null,
    };
    for (const [k, v] of Object.entries(tiles)) if (v) setStat(k, v);

    /* Timestamp and source. An undated market number is a claim, not a
       reading, and CLAUDE.md treats that difference as a legal matter. */
    const state = $('#tape-state'), stamp = $('#tape-stamp');
    if (!state || !stamp || !meta) return;
    const live = meta.source === 'live';
    state.textContent = live ? 'Live' : 'Snapshot';
    state.classList.toggle('live', live);
    const when = readStamp(meta.takenAt);
    if (when) {
      stamp.textContent = live && ok(Number(d.tipHeight))
        ? when + ', tip block ' + Number(d.tipHeight).toLocaleString('en-us')
        : when;
    }
  }

  async function market() {
    for (const url of ['api/tape', 'data/tape.json']) {
      try {
        const res = await getJSON(url);
        const d = res && res.data;
        if (d && ok(Number(d.mcapZec)) && Number(d.mcapZec) > 0) {
          paintMarket(d, { source: res.source, takenAt: res.takenAt });
          return;
        }
      } catch (_) { /* next */ }
    }
  }

  /* ------------------------------------------------------------- the chart */

  const TF = { '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };

  const C = {
    gold: '#F0C558', gold3: '#D9A24A', stripe: '#C4761C',
    ink: '#0A0705', panel: '#12100A', line: '#1C160D', line2: '#2A2010',
    muted: '#9C7A3A', textHi: '#FFE9BE',
  };

  let chartState = null;   // { raw, chart, candles, volume, tf, unit }

  /**
   * shld.fun gives one price per block, not candles. Fold those into OHLC
   * buckets of the requested width. Volume is ZEC moved, buy plus sell.
   */
  function toCandles(points, secondsPerBucket, anchorMs, anchorHeight, blockSec, rate) {
    const out = [];
    const vol = [];
    let cur = null;

    for (const [h, p, bv, sv] of points) {
      const t = Math.floor((anchorMs + (h - anchorHeight) * blockSec * 1000) / 1000);
      const bucket = Math.floor(t / secondsPerBucket) * secondsPerBucket;
      /* points arrive as ZEC per lot, which is how the indexer quotes them */
      const price = (p / LOT) * rate;

      if (!cur || cur.time !== bucket) {
        if (cur) { out.push(cur.c); vol.push(cur.v); }
        cur = {
          time: bucket,
          c: { time: bucket, open: price, high: price, low: price, close: price },
          v: { time: bucket, value: 0, color: C.gold3 },
        };
      }
      cur.c.high = Math.max(cur.c.high, price);
      cur.c.low = Math.min(cur.c.low, price);
      cur.c.close = price;
      cur.v.value += (bv + sv) * rate;
      cur.v.color = cur.c.close >= cur.c.open ? C.gold3 : C.stripe;
    }
    if (cur) { out.push(cur.c); vol.push(cur.v); }
    return { candles: out, volume: vol };
  }

  function redraw() {
    const s = chartState;
    if (!s) return;
    const rate = s.unit === 'usd' && ok(s.raw.zecUsd) ? s.raw.zecUsd : 1;
    const blockSec = ok(s.raw.measuredBlockSeconds) ? s.raw.measuredBlockSeconds : s.raw.blockSeconds || 75;
    const anchorMs = Date.parse(s.raw.anchorTime);
    const { candles, volume } = toCandles(
      s.raw.points, TF[s.tf], anchorMs, s.raw.anchorHeight, blockSec, rate,
    );
    /* A token costs a fraction of a cent, so the axis needs real decimals.
        Too few and every candle collapses onto the same printed value. */
    s.candles.applyOptions({
      priceFormat: s.unit === 'usd'
        ? { type: 'price', precision: 6, minMove: 0.000001 }
        : { type: 'price', precision: 9, minMove: 0.000000001 },
    });
    s.candles.setData(candles);
    s.volume.setData(volume);
    s.chart.timeScale().fitContent();
  }

  function buildChart(raw) {
    const host = $('#chart-canvas');
    const msg = $('#chart-msg');
    if (!host) return;

    if (!window.LightweightCharts || !raw.points || raw.points.length < 2) {
      if (msg) {
        msg.hidden = false;
        msg.textContent = !window.LightweightCharts
          ? 'The chart library did not load. The numbers below still come straight off the chain.'
          : 'No price history came back from the indexer. The coin page has the live chart.';
      }
      return;
    }

    const chart = window.LightweightCharts.createChart(host, {
      layout: {
        background: { color: C.panel },
        textColor: C.muted,
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        fontSize: 11,
      },
      grid: { vertLines: { color: C.line }, horzLines: { color: C.line } },
      rightPriceScale: { borderColor: C.line2 },
      timeScale: { borderColor: C.line2, timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: 0,
        vertLine: { color: C.gold3, width: 1, style: 2, labelBackgroundColor: C.gold },
        horzLine: { color: C.gold3, width: 1, style: 2, labelBackgroundColor: C.gold },
      },
      localization: { locale: 'en-us' },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
      autoSize: true,
    });

    const candles = chart.addCandlestickSeries({
      upColor: C.gold, downColor: C.stripe,
      borderUpColor: C.gold, borderDownColor: C.stripe,
      wickUpColor: C.gold, wickDownColor: C.stripe,
    });

    const volume = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chartState = { raw, chart, candles, volume, tf: '1h', unit: 'zec' };
    redraw();
    if (msg) msg.hidden = true;

    /* the two segmented controls */
    const wire = (sel, key, after) => {
      const box = $(sel);
      if (!box) return;
      box.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        $$('button', box).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        chartState[key] = b.dataset[key];
        if (after) after();
        redraw();
      });
    };
    wire('#tf', 'tf');
    wire('#unit', 'unit');
  }

  /* Same move as every other number on this page: draw what is already on
     disk, then quietly replace it with a fresh read.

     It matters more here than elsewhere. /api/chart pulls two pages of block
     history plus three other endpoints from shld.fun, which is six seconds or
     worse on a cold cache, and a reader should not sit in front of an empty
     rectangle for six seconds. data/chart.json is the same shape, baked by
     tools/sync-data.mjs --tape, and it loads from our own origin in one hop. */
  async function chart() {
    const msg = $('#chart-msg');
    const usable = (raw) => raw && Array.isArray(raw.points) && raw.points.length > 1;

    let drawn = false;
    try {
      const baked = await getJSON('data/chart.json');
      if (usable(baked)) { buildChart(baked); drawn = true; }
    } catch (_) { /* the live read below is the real answer anyway */ }

    try {
      const live = await getJSON('api/chart');
      if (usable(live)) {
        if (!drawn) { buildChart(live); drawn = true; }
        else if (chartState) { chartState.raw = live; redraw(); }
      }
    } catch (_) { /* keep whatever is on screen */ }

    if (!drawn && msg) {
      msg.hidden = false;
      msg.textContent = 'The chain history is not reachable right now. The coin page on shld.fun has the live chart.';
    }
  }

  /* ------------------------------------------------------- the coin tilt */
  /* The one piece of depth on the page. The coin leans towards the cursor and
     its shadow slides the other way, so the card reads as a solid object
     sitting above the page rather than a picture printed on it.

     The shadow stays hard edged with no blur, which is the same rule the
     artwork follows, so this adds dimension without softening anything. */
  function coinTilt() {
    const art = $('#coin');
    if (!art || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const MAX = 7;      // degrees
    const BASE = 6;     // resting shadow offset, px

    const move = (e) => {
      const r = art.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = (e.clientX - r.left) / r.width - 0.5;   // -0.5 .. 0.5
      const y = (e.clientY - r.top) / r.height - 0.5;
      art.style.setProperty('--ry', (x * MAX * 2).toFixed(2) + 'deg');
      art.style.setProperty('--rx', (-y * MAX * 2).toFixed(2) + 'deg');
      art.style.setProperty('--sx', (BASE - x * 10).toFixed(1) + 'px');
      art.style.setProperty('--sy', (BASE - y * 10).toFixed(1) + 'px');
    };

    const rest = () => {
      for (const p of ['--rx', '--ry', '--sx', '--sy']) art.style.removeProperty(p);
    };

    art.addEventListener('pointermove', move);
    art.addEventListener('pointerleave', rest);
    art.addEventListener('blur', rest, true);
  }

  /* -------------------------------------------------------- the gallery */
  let visible = [];

  function collect() {
    visible = $$('.gallery .tile').map((el) => ({
      el,
      slug: el.dataset.slug,
      title: el.dataset.title || '',
      tag: el.dataset.tag || 'scene',
    }));
  }

  function applyFilter(tag) {
    const vid = $('.gallery .vidcard');
    if (vid) vid.hidden = !(tag === 'all' || tag === 'video');
    $$('.gallery .tile').forEach((el) => {
      el.hidden = !(tag === 'all' || el.dataset.tag === tag);
    });
    collect();
    visible = visible.filter((v) => !v.el.hidden);
    const foot = $('#gallery-count');
    if (foot) {
      const n = visible.length;
      foot.textContent = n + (n === 1 ? ' image' : ' images') +
        (tag === 'all' ? ' on the wall' : ' tagged ' + tag);
      /* starts with a digit, so there is no first letter to capitalise */
    }
  }

  function gallery() {
    const wall = $('.gallery');
    if (!wall) return;
    collect();
    applyFilter('all');

    const filters = $('#filters');
    if (filters) {
      filters.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        $$('button', filters).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        applyFilter(b.dataset.tag);
      });
    }

    wall.addEventListener('click', (e) => {
      const t = e.target.closest('.tile');
      if (t) open(visible.findIndex((v) => v.el === t));
    });
  }

  /* ------------------------------------------------------- the lightbox */
  let idx = 0, lastFocus = null;

  function open(i) {
    if (i < 0 || !visible[i]) return;
    const box = $('#lightbox');
    /* Capture the opener ONCE, on the way in. Capturing it on every open()
       meant prev/next overwrote it with the close button, and closing then
       dropped focus onto <body> instead of back into the page. */
    if (box.hidden) lastFocus = document.activeElement;
    idx = i;
    const m = visible[i];
    const img = $('#lb-img');
    img.src = m.el.dataset.full || ('meme/' + m.slug + '.jpg');
    img.alt = m.el.dataset.alt || m.title;
    $('#lb-cap').textContent = m.title;
    box.hidden = false;
    document.body.style.overflow = 'hidden';
    $('#lb-close').focus();
  }

  function close() {
    $('#lightbox').hidden = true;
    document.body.style.overflow = '';
    /* Come back to the tile actually being looked at, not the one that opened
       the dialog five presses of "next" ago. */
    const here = visible[idx] && visible[idx].el;
    const back = (here && document.contains(here)) ? here : lastFocus;
    if (back && back.focus) back.focus();
  }

  const step = (d) => open((idx + d + visible.length) % visible.length);

  function lightbox() {
    const box = $('#lightbox');
    if (!box) return;
    /* a slug can reach D1 before its jpg reaches disk. do not leave the
       reader staring at a broken frame in a modal they have to escape. */
    $('#lb-img').addEventListener('error', () => { if (!box.hidden) close(); });
    $('#lb-close').addEventListener('click', close);
    $('#lb-prev').addEventListener('click', () => step(-1));
    $('#lb-next').addEventListener('click', () => step(1));
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    document.addEventListener('keydown', (e) => {
      if (box.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'Tab') {
        /* keep focus inside the dialog while it is open */
        const f = $$('button', box);
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  /* ---------------------------------------------------------- X embeds */
  /* The real card from X, with the hand written one underneath as the floor.
     platform.twitter.com is third party and does fail: it is blocked on some
     networks, it is slow, and it does not run at all inside a strict CSP.
     Whenever it does not finish, the static card is simply left alone, so
     this section can never end up as a row of empty boxes. */
  function xEmbeds() {
    const cards = $$('#postgrid .post[data-tweet]');
    if (!cards.length) return;

    const s = document.createElement('script');
    s.src = 'https://platform.twitter.com/widgets.js';
    s.async = true;
    s.charset = 'utf-8';

    s.addEventListener('load', () => {
      if (!window.twttr || !window.twttr.widgets) return;
      for (const card of cards) {
        const id = card.dataset.tweet;
        if (!id) continue;
        /* The host goes in EMPTY and stays in the flow. Two reasons.
           One: widgets.js refuses to render into a container that is display
           none, and its promise then never settles at all, so hiding the host
           first meant nothing ever appeared. Two: '.xcard:empty' in the css
           keeps an empty host invisible, so there is no timing to get right —
           the moment X injects its iframe the card stops being empty and
           shows itself. If X never answers, the host stays empty and unseen
           and the hand written card below it is what the reader gets. */
        const host = document.createElement('div');
        host.className = 'xcard';
        card.parentNode.insertBefore(host, card);

        window.twttr.widgets
          .createTweet(id, host, { theme: 'dark', dnt: true, conversation: 'none', align: 'center' })
          .then((el) => {
            /* createTweet resolves with undefined when the post is gone,
               protected or simply would not render. Keep the floor.
               Note there is no card.hidden here: widgets.js injects its
               iframe well before this promise settles, and hiding the hand
               written card from javascript left both versions on screen for
               that whole gap. The css rule '.xcard:not(:empty) + .post' does
               it on the same frame the iframe lands instead. */
            if (!el) host.remove();
          })
          .catch(() => { host.remove(); });
      }
    });

    document.head.appendChild(s);
  }

  /* ------------------------------------------- append whatever D1 knows */

  /* Rows here were typed by a human into a database, so a single apostrophe in
     a title used to be enough to break out of an attribute when these were
     built by gluing strings into innerHTML. Everything below goes through
     createElement and textContent, which cannot be escaped out of. */
  const SLUG_OK = /^[a-z0-9][a-z0-9_-]*$/i;

  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };

  async function growGallery() {
    const wall = $('.gallery');
    if (!wall) return;
    let res;
    try { res = await getJSON('api/memes'); } catch (_) { return; }
    const rows = (res && res.data) || [];
    const have = new Set($$('.gallery .tile').map((t) => t.dataset.slug));
    const fresh = rows.filter((r) => r.slug && SLUG_OK.test(r.slug) && !have.has(r.slug));
    if (!fresh.length) return;

    for (const r of fresh) {
      const title = r.title || r.slug;
      const fig = el('figure', 'tile');
      fig.setAttribute('role', 'button');
      fig.tabIndex = 0;
      fig.dataset.slug = r.slug;
      fig.dataset.title = title;
      fig.dataset.tag = r.tag || 'scene';
      fig.dataset.alt = r.alt || title;

      /* Hai duong nguon anh. Anh cu nam trong repo; anh upload qua khu
         quan tri nam trong D1 va di qua /api/meme-image. Lightbox doc
         data-full, nen no khong can biet anh den tu dau. */
      const inDb = Boolean(r.stored);
      const q = 'slug=' + encodeURIComponent(r.slug);
      fig.dataset.full = inDb ? 'api/meme-image?' + q + '&v=full' : 'meme/' + r.slug + '.jpg';

      const img = el('img');
      img.src = inDb ? 'api/meme-image?' + q + '&v=thumb' : 'thumb/' + r.slug + '.jpg';
      img.alt = r.alt || title;
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        fig.remove();
        const on = $('#filters button[aria-pressed="true"]');
        applyFilter(on ? on.dataset.tag : 'all');
      });

      const cap = el('figcaption');
      cap.append(el('span', null, title), el('i', null, r.tag || ''));
      fig.append(img, cap);
      wall.appendChild(fig);
    }
    const on = $('#filters button[aria-pressed="true"]');
    applyFilter(on ? on.dataset.tag : 'all');
  }

  async function growPosts() {
    const grid = $('#postgrid');
    if (!grid) return;
    let res;
    try { res = await getJSON('api/posts'); } catch (_) { return; }
    const rows = (res && res.data) || [];
    const have = new Set($$('a.post', grid).map((a) => a.getAttribute('href')));

    for (const p of rows.filter((x) => x.url && !have.has(x.url))) {
      /* only ever link out to x.com. a url from the database is not a reason
         to send a reader somewhere else. */
      let host = '';
      try { host = new URL(p.url, location.href).hostname.replace(/^www\./, ''); } catch (_) { continue; }
      if (host !== 'x.com' && host !== 'twitter.com') continue;

      const a = el('a', 'post' + (p.pinned ? ' pin' : ''));
      a.href = p.url;
      a.target = '_blank';
      a.rel = 'noopener';

      const when = p.posted_at
        ? new Date(p.posted_at).toLocaleDateString('en-us',
            { day: 'numeric', month: 'short', year: 'numeric' })
        : '';

      const meta = el('span', 'meta');
      if (p.pinned) meta.append(el('span', 'pinflag', 'Pinned'));
      if (when) meta.append(el('span', null, when));
      if (p.views) meta.append(el('span', null, p.views + ' views'));

      a.append(meta, el('span', 'body', p.body || ''), el('span', 'go', 'Read on X'));
      grid.appendChild(a);
    }
  }

  /* ------------------------------------------------------------- copy */
  function copy() {
    $$('[data-copy]').forEach((btn) => {
      /* Captured once, before any click can change it. Reading the label
         inside the handler meant a second click captured "copied" and then
         restored that, leaving the button stuck on its own confirmation. */
      const label = btn.textContent;
      let timer = 0;
      btn.addEventListener('click', async () => {
        const text = btn.dataset.copy === 'asset' ? ASSET_ID : btn.dataset.copy;
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = 'Copied';
        } catch (_) {
          btn.textContent = 'Select it by hand';
        }
        clearTimeout(timer);
        timer = setTimeout(() => { btn.textContent = label; }, 1800);
      });
    });
  }

  /* ---------------------------------------------------------- admin door */
  /* Mot cu nhan dup vao dong ky ten o chan trang. Khong co link, khong co
     nut, khong co duong dan rieng de ai do do ra.

     Cho ro rang: day KHONG phai bao mat. Doan ma nay cong khai nhu moi thu
     khac trong file, nen ai chiu doc se thay. Thu that su chan nguoi la la
     mat khau kiem tra o server cung voi gioi han so lan thu. Giau cua chi de
     bot va nguoi to mo khong bao gio go den. */
  function adminDoor() {
    const mark = $('footer .sign');
    if (!mark) return;
    mark.addEventListener('dblclick', () => {
      if (window.__zecatAdmin) { window.__zecatAdmin.open(); return; }
      const s = document.createElement('script');
      s.src = 'assets/admin.js';
      s.defer = true;
      document.head.appendChild(s);
    });
  }

  /* Them anh xong thi keo lai tuong, khong phai tai lai trang.

     Co thu lai vai lan chu khong goi dung mot lan. Hang vua ghi vao D1 khong
     phai luc nao cung doc lai duoc ngay o lan hoi ke tiep, va khi do tuong
     van dung yen trong khi khu quan tri da bao "xong". Vong lap nay dung
     ngay khi thay slug moi xuat hien. */
  document.addEventListener('zecat:memes-changed', async (e) => {
    const want = e.detail && e.detail.slug;
    const here = () => !want || $$('.gallery .tile').some((t) => t.dataset.slug === want);
    for (let i = 0; i < 5; i++) {
      await growGallery();
      if (here()) return;
      await new Promise((r) => setTimeout(r, 600));
    }
  });

  /* keyboard support for the figure-as-button tiles */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target.closest && e.target.closest('.gallery .tile');
    if (!t) return;
    e.preventDefault();
    open(visible.findIndex((v) => v.el === t));
  });

  /* ----------------------------------------------------------- start */
  heartbeat();
  gallery();
  lightbox();
  copy();
  coinTilt();
  market();
  chart();
  xEmbeds();
  growGallery();
  growPosts();
  adminDoor();
})();
