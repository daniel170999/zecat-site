/* ===========================================================================
   $ZECAT admin console
   ---------------------------------------------------------------------------
   File nay KHONG duoc tai cung trang. site.js chi keo no ve sau mot cu chi
   an, nen khach binh thuong khong bao gio tai no.

   Dieu do KHONG phai la lop bao ve. Cu chi kia nam trong site.js ma ai cung
   doc duoc. Cai chan nguoi la la mat khau duoc kiem tra o server, scrypt,
   va gioi han so lan thu. Giau cua chi de bot va nguoi to mo khong go cua.

   O day KHONG co mat khau, khong co khoa, khong co gi bi mat. Moi quyet dinh
   deu do /api/admin dua ra.

   Anh duoc thu nho NGAY TRONG TRINH DUYET truoc khi gui: mot ban 1400px va
   mot ban 600px. Nho vay may chu khong can thu vien xu ly anh nao, va thu di
   qua mang chi con vai chuc KB thay vi vai MB.
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
.adm-prev{display:flex;gap:12px;align-items:center}
.adm-prev img{width:76px;height:76px;object-fit:cover;border:1px solid #2A2010}
.adm-prev span{font-size:12px;color:#9C7A3A;line-height:1.6}
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
      <div class="adm-drop" data-drop>Drop an image here, or click to pick one</div>
      <input type="file" accept="image/*" hidden data-file>
      <div class="adm-prev" hidden data-prev><img alt=""><span data-prev-txt></span></div>
      <div><label for="adm-title">Title</label><input id="adm-title" type="text" maxlength="80"></div>
      <div><label for="adm-slug">File name, lowercase and dashes</label><input id="adm-slug" type="text" maxlength="48" spellcheck="false"></div>
      <div><label for="adm-alt">Describe it for people who cannot see it</label><textarea id="adm-alt" maxlength="300"></textarea></div>
      <div><label for="adm-tag">Kind</label><select id="adm-tag"><option value="scene">Scene</option><option value="poster">Poster</option></select></div>
      <div class="adm-row"><button class="adm-btn" type="button" data-send disabled>Add to the wall</button>
        <button class="adm-btn adm-ghost" type="button" data-out>Sign out</button></div>
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
  let shots = null;   // { full, thumb, w, h }

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
      /* cookie phien la httpOnly, trinh duyet tu gui kem */
      credentials: 'same-origin',
      body: JSON.stringify(Object.assign({ action }, data || {})),
    });
    let out = null;
    try { out = await res.json(); } catch (_) { /* server tra ve rac */ }
    if (!res.ok || !out || out.ok !== true) {
      throw new Error((out && out.error) || 'That did not work.');
    }
    return out;
  }

  /** Thu nho trong trinh duyet. Tra ve base64 khong co tien to data:. */
  async function shrink(file, maxEdge) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('This browser could not convert the image.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return { b64: btoa(bin), w, h, bytes: bytes.length };
  }

  const slugify = (s) => s.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

  async function take(file) {
    if (!file || !/^image\//.test(file.type)) {
      say(msg, 'That is not an image.', 'bad'); return;
    }
    say(msg, 'Resizing.', '');
    try {
      const full = await shrink(file, FULL_EDGE);
      const thumb = await shrink(file, THUMB_EDGE);
      shots = { full, thumb };
      const prev = $('[data-prev]', root);
      $('img', prev).src = 'data:image/jpeg;base64,' + thumb.b64;
      $('[data-prev-txt]', root).textContent =
        full.w + ' by ' + full.h + ', ' + Math.round(full.bytes / 1024) + ' KB. ' +
        'Thumbnail ' + Math.round(thumb.bytes / 1024) + ' KB.';
      prev.hidden = false;
      $('[data-send]', root).disabled = false;
      const slugField = $('#adm-slug', root);
      if (!slugField.value) slugField.value = slugify(file.name.replace(/\.[a-z0-9]+$/i, ''));
      say(msg, 'Ready.', 'good');
    } catch (err) {
      shots = null;
      say(msg, err.message || 'Could not read that image.', 'bad');
    }
  }

  /* ---------------------------------------------------------- open, close */
  function open() {
    lastFocus = document.activeElement;
    root.hidden = false;
    document.body.style.overflow = 'hidden';
    call('session').then((s) => {
      if (s.signedIn) { gate.hidden = true; panel.hidden = false; $('#adm-title', root).focus(); }
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
      $('#adm-title', root).focus();
    } catch (err) {
      say(gm, err.message, 'bad');
      field.select();
    }
  };
  $('[data-in]', root).addEventListener('click', signIn);
  $('#adm-pw', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn(); });

  $('[data-out]', root).addEventListener('click', async () => {
    try { await call('logout'); } catch (_) { /* dang xuat thi khong the that bai */ }
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
  fileInput.addEventListener('change', () => take(fileInput.files && fileInput.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    take(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  $('[data-send]', root).addEventListener('click', async () => {
    if (!shots) return;
    const btn = $('[data-send]', root);
    btn.disabled = true;
    say(msg, 'Sending.', '');
    try {
      const out = await call('upload', {
        slug: slugify($('#adm-slug', root).value),
        title: $('#adm-title', root).value.trim(),
        alt: $('#adm-alt', root).value.trim(),
        tag: $('#adm-tag', root).value,
        thumb: shots.thumb.b64,
        full: shots.full.b64,
        w: shots.full.w,
        h: shots.full.h,
      });
      say(msg, 'Added as ' + out.slug + '. It is on the wall now.', 'good');
      shots = null;
      $('[data-prev]', root).hidden = true;
      for (const id of ['#adm-title', '#adm-slug', '#adm-alt']) $(id, root).value = '';
      /* site.js dang nghe. Gui kem slug de no biet cho den khi thay dung
         tam anh vua them, thay vi hoi mot lan roi thoi. */
      document.dispatchEvent(new CustomEvent('zecat:memes-changed', { detail: { slug: out.slug } }));
    } catch (err) {
      say(msg, err.message, 'bad');
      btn.disabled = false;
    }
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
