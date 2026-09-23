/* ===========================================================================
   $ZECAT admin console
   ---------------------------------------------------------------------------
   site.js loads this file only after the hidden opening gesture. This is not
   a security boundary: the public site.js reveals the gesture. The server
   verifies the password and controls every decision; no secret lives here.

   The browser resizes images to 1400px and 600px variants before upload so
   the server needs no image-processing library and transfers stay small.
   Batch uploads derive slugs from filenames and resolve duplicates on the
   server. Descriptions are optional; never invent one for an empty field.
   =========================================================================== */

(() => {
  'use strict';

  if (window.__zecatAdmin) { window.__zecatAdmin.open(); return; }

  const $ = (s, r = document) => r.querySelector(s);

  const FULL_EDGE = 1400;
  const THUMB_EDGE = 600;
  const QUALITY = 0.82;

  /* ------------------------------------------------------------- style */
  const style = document.createElement('style');
  style.textContent = `
.adm{position:fixed;inset:0;z-index:200;background:rgba(7,6,5,.97);
  display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow:auto}
.adm[hidden]{display:none}
.adm-box{width:100%;max-width:560px;background:#0F0C07;border:1px solid #2A2010;
  font-family:"IBM Plex Mono",ui-monospace,monospace;color:#F0D9A0}
.adm-top{display:flex;align-items:center;gap:10px;padding:12px 16px;
  border-bottom:1px solid #2A2010;background:#16120B;font-size:12px;letter-spacing:.06em}
.adm-top b{color:#F0C558;font-weight:600}
.adm-top button{margin-left:auto;background:none;border:1px solid #2A2010;color:#9C7A3A;
  font:inherit;font-size:11px;padding:4px 10px;cursor:pointer}
.adm-top button:hover{border-color:#F0C558;color:#F0C558}
.adm-body{padding:20px 16px;display:grid;gap:14px}
.adm label{display:block;font-size:11px;letter-spacing:.07em;color:#9C7A3A;margin-bottom:5px}
.adm input[type=text],.adm input[type=password],.adm textarea,.adm select{
  width:100%;background:#0A0705;border:1px solid #2A2010;color:#FFE9BE;
  font:inherit;font-size:13px;padding:9px 11px}
.adm input:focus,.adm textarea:focus,.adm select:focus{outline:2px solid #F0C558;outline-offset:1px}
.adm textarea{resize:vertical;min-height:62px;line-height:1.5}
.adm-btn{font-family:"Archivo",system-ui,sans-serif;font-weight:700;font-size:14px;
  background:#F0C558;border:2px solid #F0C558;color:#0A0705;padding:10px 18px;cursor:pointer}
.adm-btn:hover{background:#FFF6DE;border-color:#FFF6DE}
.adm-btn[disabled]{opacity:.5;cursor:default}
.adm-ghost{background:none;color:#F0C558}
.adm-ghost:hover{background:#F0C558;color:#0A0705}
.adm-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.adm-msg{font-size:12.5px;line-height:1.6;padding:9px 12px;border-left:2px solid #2A2010;color:#9C7A3A}
.adm-msg.bad{border-left-color:#C4614A;color:#FFE9BE}
.adm-msg.good{border-left-color:#F0C558;color:#FFE9BE}
.adm-drop{border:1px dashed #2A2010;padding:20px;text-align:center;font-size:13px;color:#9C7A3A;cursor:pointer}
.adm-drop:hover,.adm-drop.over{border-color:#F0C558;color:#F0C558}
.adm-queue{list-style:none;margin:0;padding:0;display:grid;gap:8px;max-height:46vh;overflow:auto}
.adm-queue li{display:grid;grid-template-columns:52px 1fr auto;gap:10px;align-items:center;
  border:1px solid #2A2010;padding:8px;background:#0A0705}
.adm-queue img{width:52px;height:52px;object-fit:cover;background:#16120B}
.adm-queue .q-mid{min-width:0}
.adm-queue .q-name{font-size:11px;color:#9C7A3A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.adm-queue input{width:100%;margin-top:4px;background:#0F0C07;border:1px solid #2A2010;
  color:#FFE9BE;font:inherit;font-size:12px;padding:5px 8px}
.adm-queue .q-state{font-size:11px;color:#9C7A3A;white-space:nowrap;text-align:right}
.adm-queue .q-state.ok{color:#F0C558}
.adm-queue .q-state.bad{color:#C4614A}
.adm-tabs{display:flex;border-bottom:1px solid #2A2010}
.adm-tabs button{flex:1;background:none;border:none;border-bottom:2px solid transparent;
  color:#9C7A3A;font:inherit;font-size:12px;padding:11px 8px;cursor:pointer}
.adm-tabs button[aria-selected=true]{color:#F0C558;border-bottom-color:#F0C558}
`;

  /* -------------------------------------------------------------- dom */
  const root = document.createElement('div');
  root.className = 'adm';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Admin console');
  root.innerHTML = `
<div class="adm-box">
  <div class="adm-top"><b>$ZECAT</b><span>admin console</span><button type="button" data-x>close</button></div>
  <div data-gate>
    <div class="adm-body">
      <div>
        <label for="adm-pw">Password</label>
        <input id="adm-pw" type="password" autocomplete="current-password" spellcheck="false">
      </div>
      <div class="adm-row"><button class="adm-btn" type="button" data-in>Sign in</button></div>
      <p class="adm-msg" data-gate-msg>This console is not linked from anywhere. Closing it is enough to hide it again.</p>
    </div>
  </div>
  <div data-panel hidden>
    <div class="adm-tabs">
      <button type="button" data-tab="up" aria-selected="true">Add a meme</button>
      <button type="button" data-tab="pw" aria-selected="false">Change password</button>
    </div>
    <div class="adm-body" data-pane="up">
      <div class="adm-drop" data-drop>Drop images here, or click to pick. Several at once is fine.</div>
      <input type="file" accept="image/*" multiple hidden data-file>
      <ul class="adm-queue" data-queue></ul>
      <div class="adm-row">
        <button class="adm-btn" type="button" data-send disabled>Upload</button>
        <button class="adm-btn adm-ghost" type="button" data-clear hidden>Clear</button>
        <button class="adm-btn adm-ghost" type="button" data-out>Sign out</button>
      </div>
      <p class="adm-msg" data-msg hidden></p>
    </div>
    <div class="adm-body" data-pane="pw" hidden>
      <div><label for="adm-cur">Current password</label><input id="adm-cur" type="password" autocomplete="current-password"></div>
      <div><label for="adm-new">New password, at least 12 characters</label><input id="adm-new" type="password" autocomplete="new-password"></div>
      <div class="adm-row"><button class="adm-btn" type="button" data-chpw>Change it</button></div>
      <p class="adm-msg" data-pwmsg>Changing this signs out every other device straight away.</p>
    </div>
  </div>
</div>`;

  document.head.appendChild(style);
  document.body.appendChild(root);

  const gate = $('[data-gate]', root);
  const panel = $('[data-panel]', root);
  const msg = $('[data-msg]', root);
  let lastFocus = null;
  /* Pending image queue. Each item contains:
     { file, slug, full, thumb, row, desc, state } */
  let queue = [];

  /* ------------------------------------------------------------- helpers */
  const say = (el, text, kind) => {
    el.textContent = text;
    el.className = 'adm-msg' + (kind ? ' ' + kind : '');
    el.hidden = false;
  };

  async function call(action, data) {
    const res = await fetch('api/admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zecat-admin': '1' },
      /* The browser sends the HttpOnly session cookie automatically. */
      credentials: 'same-origin',
      body: JSON.stringify(Object.assign({ action }, data || {})),
    });
    let out = null;
    try { out = await res.json(); } catch (_) { /* Invalid server response. */ }
    if (!res.ok || !out || out.ok !== true) {
      throw new Error((out && out.error) || 'That did not work.');
    }
    return out;
  }

  /** Draw a decoded image at the target size and return bare base64. */
  async function render(bmp, maxEdge) {
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('This browser could not convert the image.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return { b64: btoa(bin), w, h, bytes: bytes.length };
  }

  /**
   * Decode each image once, then draw both sizes from that bitmap. Decoding
   * twice made large batches slow enough to race the Upload button.
   */
  async function shrinkBoth(file) {
    const bmp = await createImageBitmap(file);
    try {
      return { full: await render(bmp, FULL_EDGE), thumb: await render(bmp, THUMB_EDGE) };
    } finally {
      bmp.close && bmp.close();
    }
  }

  const slugify = (s) => s.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

  /**
   * Upload button state.
   *
   * Keep the button disabled until every queued image finishes resizing.
   * Otherwise its count can understate a large batch and send only the files
   * prepared so far.
   */
  function refreshButtons() {
    const sizing = queue.filter((q) => q.state === 'sizing').length;
    const ready = queue.filter((q) => q.state === 'ready').length;
    const send = $('[data-send]', root);

    if (sizing) {
      send.disabled = true;
      send.textContent = 'Preparing ' + (queue.length - sizing) + ' of ' + queue.length;
    } else {
      send.disabled = ready === 0;
      send.textContent = ready === 0 ? 'Upload' : 'Upload ' + ready + (ready === 1 ? ' image' : ' images');
    }
    $('[data-clear]', root).hidden = queue.length === 0;
  }

  /**
   * Queue a batch and resize every image to two variants in the browser.
   *
   * Process images sequentially to avoid many simultaneous canvases.
   */
  async function enqueue(files) {
    const list = [...files].filter((f) => f && /^image\//.test(f.type));
    if (!list.length) { say(msg, 'Those were not images.', 'bad'); return; }
    msg.hidden = true;

    /* Queue the entire batch before resizing so progress uses the true total. */
    const fresh = [];
    for (const file of list) {
      const item = {
        file,
        slug: slugify(file.name.replace(/\.[a-z0-9]+$/i, '')) || 'meme',
        state: 'sizing',
      };
      const li = document.createElement('li');
      li.innerHTML =
        '<img alt="">' +
        '<span class="q-mid"><span class="q-name"></span>' +
        '<input type="text" maxlength="300" placeholder="Describe it for people who cannot see it (optional)"></span>' +
        '<span class="q-state">waiting</span>';
      $('.q-name', li).textContent = file.name;
      item.row = li;
      item.desc = $('input', li);
      item.stateEl = $('.q-state', li);
      $('[data-queue]', root).appendChild(li);
      queue.push(item);
      fresh.push(item);
    }
    refreshButtons();

    for (const item of fresh) {
      const file = item.file;
      item.stateEl.textContent = 'resizing';
      try {
        const both = await shrinkBoth(file);
        item.full = both.full;
        item.thumb = both.thumb;
        $('img', item.row).src = 'data:image/jpeg;base64,' + item.thumb.b64;
        item.state = 'ready';
        item.stateEl.textContent = Math.round(item.full.bytes / 1024) + ' KB';
        item.stateEl.className = 'q-state';
      } catch (err) {
        item.state = 'failed';
        /* Show the actual conversion error. HEIC from an iPhone is one common
           format that a browser may fail to decode. */
        const why = (err && err.message) ? String(err.message) : String(err);
        item.stateEl.textContent = why.slice(0, 44);
        item.stateEl.title = why;
        console.error('zecat upload: ' + file.name, err);
        item.stateEl.className = 'q-state bad';
      }
      refreshButtons();
    }
  }

  /* ---------------------------------------------------------- open, close */
  function open() {
    lastFocus = document.activeElement;
    root.hidden = false;
    document.body.style.overflow = 'hidden';
    call('session').then((s) => {
      if (s.signedIn) { gate.hidden = true; panel.hidden = false; $('[data-drop]', root).focus(); }
      else { gate.hidden = false; panel.hidden = true; $('#adm-pw', root).focus(); }
    }).catch(() => {
      say($('[data-gate-msg]', root),
        'The admin routes are switched off. They need D1 and ADMIN_SECRET set on the host.', 'bad');
      $('#adm-pw', root).focus();
    });
  }

  function close() {
    root.hidden = true;
    document.body.style.overflow = '';
    $('#adm-pw', root).value = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ------------------------------------------------------------- wiring */
  $('[data-x]', root).addEventListener('click', close);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  document.addEventListener('keydown', (e) => {
    if (!root.hidden && e.key === 'Escape') close();
  });

  const signIn = async () => {
    const field = $('#adm-pw', root);
    const gm = $('[data-gate-msg]', root);
    try {
      await call('login', { password: field.value });
      field.value = '';
      gate.hidden = true; panel.hidden = false;
      $('[data-drop]', root).focus();
    } catch (err) {
      say(gm, err.message, 'bad');
      field.select();
    }
  };
  $('[data-in]', root).addEventListener('click', signIn);
  $('#adm-pw', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn(); });

  $('[data-out]', root).addEventListener('click', async () => {
    try { await call('logout'); } catch (_) { /* Clear local UI regardless. */ }
    panel.hidden = true; gate.hidden = false;
    $('#adm-pw', root).focus();
  });

  for (const b of root.querySelectorAll('[data-tab]')) {
    b.addEventListener('click', () => {
      for (const x of root.querySelectorAll('[data-tab]')) {
        x.setAttribute('aria-selected', String(x === b));
        $('[data-pane="' + x.dataset.tab + '"]', root).hidden = x !== b;
      }
    });
  }

  const drop = $('[data-drop]', root);
  const fileInput = $('[data-file]', root);
  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { enqueue(fileInput.files || []); fileInput.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    enqueue((e.dataTransfer && e.dataTransfer.files) || []);
  });

  $('[data-clear]', root).addEventListener('click', () => {
    queue = [];
    $('[data-queue]', root).replaceChildren();
    msg.hidden = true;
    refreshButtons();
  });

  /* Send sequentially for predictable duplicate-slug naming in D1. A failed
     image does not stop the rest of the batch. */
  $('[data-send]', root).addEventListener('click', async () => {
    const btn = $('[data-send]', root);
    const todo = queue.filter((q) => q.state === 'ready');
    if (!todo.length) return;
    btn.disabled = true;
    msg.hidden = true;

    let done = 0, failed = 0, last = null;
    let at = 0;
    for (const item of todo) {
      at++;
      btn.textContent = 'Sending ' + at + ' of ' + todo.length;
      item.stateEl.textContent = 'sending';
      item.stateEl.className = 'q-state';
      try {
        const out = await call('upload', {
          slug: item.slug,
          alt: item.desc.value.trim(),
          thumb: item.thumb.b64,
          full: item.full.b64,
          w: item.full.w,
          h: item.full.h,
        });
        item.state = 'done';
        item.stateEl.textContent = 'on the wall';
        item.stateEl.className = 'q-state ok';
        item.desc.disabled = true;
        done++; last = out.slug;
      } catch (err) {
        item.state = 'failed';
        item.stateEl.textContent = err.message.slice(0, 40);
        item.stateEl.className = 'q-state bad';
        failed++;
      }
    }

    /* Report files that finished preparing during the send loop. */
    const leftover = queue.filter((q) => q.state === 'ready').length;
    say(msg,
      done + (done === 1 ? ' image added' : ' images added') +
      (failed ? ', ' + failed + ' failed' : '') + '.' +
      (leftover ? ' ' + leftover + ' more finished preparing, press upload again.' : ''),
      failed ? 'bad' : 'good');

    if (last) {
      /* site.js retries until the last uploaded slug appears in the gallery. */
      document.dispatchEvent(new CustomEvent('zecat:memes-changed', { detail: { slug: last } }));
    }
    refreshButtons();
  });

  $('[data-chpw]', root).addEventListener('click', async () => {
    const cur = $('#adm-cur', root), next = $('#adm-new', root);
    const out = $('[data-pwmsg]', root);
    try {
      await call('password', { current: cur.value, next: next.value });
      cur.value = ''; next.value = '';
      say(out, 'Changed. Every other device is signed out.', 'good');
    } catch (err) {
      say(out, err.message, 'bad');
    }
  });

  window.__zecatAdmin = { open, close };
  open();
})();
