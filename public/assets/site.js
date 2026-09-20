/* ===========================================================================
   $ZECAT site runtime
   ---------------------------------------------------------------------------
   Progressive enhancement, on purpose. Every meme, post and market number is
   already in the html when this file loads, so the page is complete with
   javascript switched off and complete before a single request returns.

   What this file adds on top:
     - the live 75 second block pulse and the bell counter
     - upgrading the baked market snapshot to live numbers from /api/tape
     - gallery filtering and the lightbox
     - appending memes and posts that exist in D1 but are not baked in yet
     - copy to clipboard

   Data flow for every list:  baked html  ->  /api/<thing>  ->  append new only.
   A failed request is not an error state here. The page was already correct.
   =========================================================================== */

(() => {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const ASSET_ID   = document.documentElement.dataset.asset || '';
  const FIRST_TRADE = Date.parse('2026-09-03T09:05:51Z');  // block 3,470,323
  const BELL_MS     = 75000;                               // one Zcash block, near enough
  const REQ_TIMEOUT = 7000;

  const nf = (n, d = 2) => Number(n).toLocaleString('en-us', {
    minimumFractionDigits: d, maximumFractionDigits: d,
  });

  const usd = (n) => {
    if (!isFinite(n)) return '';
    if (n >= 1e6) return '$' + nf(n / 1e6, 2) + 'm';
    if (n >= 1e3) return '$' + nf(n / 1e3, 1) + 'k';
    return '$' + nf(n, 2);
  };

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

  /* ------------------------------------------------- the 75 second heartbeat */
  function heartbeat() {
    const bar  = $('#pulse-bar');
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

  /* ----------------------------------------------------------------- the tape */

  /* Exactly the shape tools/sync-data.mjs bakes into the html:
     "read 20 sep 2026, 11:01 utc". Built by hand rather than with
     toUTCString, which returns "Sun, 20 Sep 2026 11:01:00 GMT" and breaks the
     lowercase rule in VOICE.md on a line every visitor reads. */
  const MON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const pad = (n) => String(n).padStart(2, '0');
  const ok  = (n) => typeof n === 'number' && isFinite(n);

  function readStamp(iso) {
    const t = Date.parse(iso);
    if (!isFinite(t)) return '';
    const d = new Date(t);
    return 'read ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear() +
      ', ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' utc';
  }

  function paintTape(d, meta) {
    const zec = Number(d.zecUsd);
    const lot = Number(d.priceZecPerToken) * 12500;

    /* A cell is only overwritten when the incoming number is real. Anything
       else keeps whatever is baked into the html, which is timestamped and
       carries a link to the source, rather than showing NaN or a bare $0.00. */
    const set = (field, value, big, sub, cls) => {
      if (!ok(value)) return;
      const cell = $(`[data-field="${field}"]`);
      if (!cell) return;
      const b = $('b', cell), e = $('em', cell);
      if (b) {
        b.textContent = big;
        /* the lot cell is baked with class="sm" because its value is long.
           assigning className wholesale used to drop that, so a live read
           re-rendered the lot at full size and pushed it out of its cell. */
        const small = b.classList.contains('sm') ? 'sm' : '';
        b.className = [small, cls || ''].filter(Boolean).join(' ');
      }
      if (e && sub != null) e.textContent = sub;
    };

    /* a usd figure is only meaningful when the zec price actually arrived */
    const inUsd = (n) => (ok(zec) && zec > 0 && ok(n) ? usd(n * zec) : null);
    const lotUsd = inUsd(lot);

    set('mcap', d.mcapZec, nf(d.mcapZec, 0) + ' zec', inUsd(d.mcapZec));
    set('lot',  lot,       nf(lot, 4) + ' zec', lotUsd === null ? null : lotUsd + ' per 12,500');
    set('liq',  d.liqZec,  nf(d.liqZec, 1) + ' zec',  inUsd(d.liqZec));
    set('vol',  d.vol24Zec, nf(d.vol24Zec, 1) + ' zec', inUsd(d.vol24Zec));
    set('chg24', d.change24Pct, (d.change24Pct >= 0 ? '+' : '') + nf(d.change24Pct, 2) + '%',
        'last 24 hours', d.change24Pct >= 0 ? 'up' : 'down');
    set('chg7d', d.change7dPct, (d.change7dPct >= 0 ? '+' : '') + nf(d.change7dPct, 2) + '%',
        'last 7 days', d.change7dPct >= 0 ? 'up' : 'down');
    set('positions', d.positions, Number(d.positions).toLocaleString('en-us'), 'open on shld.fun');
    set('rank', d.rank, '#' + d.rank, 'of every token there');

    /* Every number on this panel has to say when it was read. An undated
       market figure is a claim, not a reading, and CLAUDE.md treats that
       difference as a legal matter rather than a stylistic one. The live
       branch used to replace the timestamp with a block height and nothing
       else, which quietly turned the whole tape into bare assertion. */
    const state = $('#tape-state'), stamp = $('#tape-stamp');
    if (!state || !stamp || !meta) return;
    const live = meta.source === 'live';
    state.textContent = live ? 'live' : 'snapshot';
    state.classList.toggle('live', live);

    const when = readStamp(meta.takenAt);
    if (!when) return;
    stamp.textContent = live && ok(d.tipHeight)
      ? when + ', tip block ' + Number(d.tipHeight).toLocaleString('en-us')
      : when;
  }

  async function tape() {
    /* the html already holds the last known-good read, so this only ever upgrades it. */
    /* Relative, not rooted. On Vercel the page sits at / so these resolve to
       the same two paths as before, and on a plain static host that serves the
       site from a subdirectory they still find their neighbours. */
    for (const url of ['api/tape', 'data/tape.json']) {
      try {
        const res = await getJSON(url);
        const d = res && res.data;
        if (d && ok(Number(d.mcapZec)) && Number(d.mcapZec) > 0) {
          paintTape(d, { source: res.source, takenAt: res.takenAt });
          return;
        }
      } catch (_) { /* next */ }
    }
  }

  /* -------------------------------------------------------------- the gallery */
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

  /* -------------------------------------------------------------- the lightbox */
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
    img.src = 'meme/' + m.slug + '.jpg';
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

  /* ------------------------------------------- append whatever D1 knows and html does not */

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
    /* a slug becomes a file path, so anything that is not a plain slug is
       dropped rather than cleaned up and hoped for */
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

      const img = el('img');
      img.src = 'thumb/' + r.slug + '.jpg';
      img.alt = r.alt || title;
      img.loading = 'lazy';
      /* a row can land in D1 before its jpg lands on disk. drop the tile
         rather than leave a broken frame that still counts in the total. */
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
            { day: 'numeric', month: 'short', year: 'numeric' }).toLowerCase()
        : '';

      const meta = el('span', 'meta');
      if (p.pinned) meta.append(el('span', 'pinflag', 'pinned'));
      if (when) meta.append(el('span', null, when));
      if (p.views) meta.append(el('span', null, p.views + ' views'));

      a.append(meta, el('span', 'body', p.body || ''), el('span', 'go', 'read on x'));
      grid.appendChild(a);
    }
  }

  /* ---------------------------------------------------------------------- copy */
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
          btn.textContent = 'copied';
          btn.dataset.done = '1';
        } catch (_) {
          btn.textContent = 'select it by hand';
        }
        clearTimeout(timer);
        timer = setTimeout(() => { btn.textContent = label; delete btn.dataset.done; }, 1800);
      });
    });
  }

  /* keyboard support for the figure-as-button tiles */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target.closest && e.target.closest('.gallery .tile');
    if (!t) return;
    e.preventDefault();
    open(visible.findIndex((v) => v.el === t));
  });

  /* ------------------------------------------------------------------- start */
  heartbeat();
  gallery();
  lightbox();
  copy();
  tape();
  growGallery();
  growPosts();
})();
