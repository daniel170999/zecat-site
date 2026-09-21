/* ===========================================================================
   test-admin.mjs  ·  chay thu toan bo luong xac thuc cua khu quan tri
   ---------------------------------------------------------------------------
       npm i -g better-sqlite3      (mot lan)
       node tools/test-admin.mjs

   Khong can Cloudflare, khong can mang. Bai thu dung mot D1 GIA chay tren
   sqlite trong bo nho, noi dung giao thuc /query that cua Cloudflare, roi goi
   thang cac handler trong api/ y het cach Vercel goi chung.

   Chay lai bai nay sau MOI lan sua api/_auth.js hay api/admin.js. Doan ma xac
   thuc la cho duy nhat trong du an ma mot loi im lang co the mo cua cho nguoi
   la, va mat khong nhin ra duoc dieu do.

   Mat khau dung trong bai thu duoc sinh ngau nhien moi lan chay. Mat khau that
   cua chu trang khong nam o day, va khong duoc phep nam o day.
   =========================================================================== */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const mod = (p) => pathToFileURL(p).href;

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
const globalRoot = execSync('npm root -g').toString().trim();
const Database = req(path.join(globalRoot, 'better-sqlite3'));

const db = new Database(':memory:');
db.exec(readFileSync(path.join(SITE, 'db/schema.sql'), 'utf8'));

/* ---- D1 gia: nhan {sql, params}, tra ve hinh dang y het Cloudflare ---- */
const d1 = createServer((r, res) => {
  let body = '';
  r.on('data', (c) => (body += c));
  r.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (r.headers.authorization !== 'Bearer test-token') {
      res.statusCode = 401;
      return res.end(JSON.stringify({ success: false, errors: [{ message: 'bad token' }] }));
    }
    try {
      const { sql, params } = JSON.parse(body);
      const stmt = db.prepare(sql);
      const results = stmt.reader ? stmt.all(...(params || [])) : (stmt.run(...(params || [])), []);
      res.end(JSON.stringify({ success: true, result: [{ results }] }));
    } catch (err) {
      res.statusCode = 200;
      res.end(JSON.stringify({ success: false, errors: [{ message: err.message }] }));
    }
  });
});
await new Promise((r) => d1.listen(0, r));
const d1Port = d1.address().port;

process.env.CF_ACCOUNT_ID = 'acct';
process.env.CF_D1_DATABASE_ID = 'dbid';
process.env.CF_API_TOKEN = 'test-token';
process.env.CF_D1_ENDPOINT = 'http://127.0.0.1:' + d1Port;
process.env.ADMIN_SECRET = 'x'.repeat(48);

const { default: adminHandler } = await import(mod(path.join(SITE, 'api/admin.js')));
const { default: imageHandler } = await import(mod(path.join(SITE, 'api/meme-image.js')));
const { hashPassword, newSalt } = await import(mod(path.join(SITE, 'api/_auth.js')));

/* ---- dat mat khau thu, KHONG phai mat khau that cua chu trang ---- */
const TEST_PASSWORD = 'correct-horse-battery-staple-' + Math.random().toString(36).slice(2);
const salt = newSalt();
db.prepare('INSERT INTO admin (id, pass_hash, pass_salt, token_version, updated_at) VALUES (1,?,?,1,?)')
  .run(hashPassword(TEST_PASSWORD, salt), salt, new Date().toISOString());

/* ---- goi handler y het Vercel ---- */
let cookieJar = '';
function call(handler, { method = 'POST', body = null, headers = {}, query = {}, ip = '10.0.0.1' } = {}) {
  return new Promise((resolve) => {
    const out = { status: 200, headers: {}, body: '' };
    const request = {
      method, url: '/api/x', query,
      headers: Object.assign(
        { 'x-forwarded-for': ip, 'content-type': 'application/json', cookie: cookieJar },
        headers,
      ),
      body,
    };
    const response = {
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      status(c) { out.status = c; return response; },
      end(b) {
        out.body = b == null ? '' : (Buffer.isBuffer(b) ? b : String(b));
        const sc = out.headers['set-cookie'];
        if (sc) cookieJar = String(sc).split(';')[0];
        try { out.json = JSON.parse(out.body); } catch { out.json = null; }
        resolve(out);
      },
    };
    handler(request, response);
  });
}

const post = (data, opts) => call(adminHandler, {
  body: data, headers: { 'x-zecat-admin': '1' }, ...opts,
});

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  LOI   ' + name + (detail ? '  -> ' + detail : '')); }
};

console.log('\n=== CUA VAO ===');
{
  const r = await call(adminHandler, { method: 'GET', headers: { 'x-zecat-admin': '1' } });
  check('GET bi tu choi', r.status === 405, 'status ' + r.status);
}
{
  const r = await post({ action: 'session' }, { headers: {} });
  check('thieu header x-zecat-admin thi bi chan (CSRF)', r.status === 405, 'status ' + r.status);
}
{
  const r = await call(adminHandler, {
    body: { action: 'session' },
    headers: { 'x-zecat-admin': '1', 'content-type': 'text/plain' },
  });
  check('content-type khong phai json thi bi chan', r.status === 405, 'status ' + r.status);
}

console.log('\n=== DANG NHAP ===');
{
  const r = await post({ action: 'session' });
  check('chua dang nhap thi signedIn=false', r.json && r.json.signedIn === false);
}
{
  const r = await post({ action: 'upload', slug: 'x', title: 'x', alt: 'x'.repeat(20) });
  check('upload khi chua dang nhap bi tu choi 401', r.status === 401, 'status ' + r.status);
}
{
  const r = await post({ action: 'login', password: 'sai-be-bet' });
  check('mat khau sai bi tu choi', r.status === 401);
  check('loi khong noi ro sai o dau', r.json && r.json.error === 'Wrong password.', JSON.stringify(r.json));
}
{
  const r = await post({ action: 'login', password: TEST_PASSWORD });
  check('mat khau dung thi vao duoc', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
  const c = String(r.headers['set-cookie'] || '');
  check('cookie co HttpOnly', /HttpOnly/i.test(c), c);
  check('cookie co Secure', /Secure/i.test(c), c);
  check('cookie co SameSite=Strict', /SameSite=Strict/i.test(c), c);
}
{
  const r = await post({ action: 'session' });
  check('sau khi dang nhap thi signedIn=true', r.json && r.json.signedIn === true);
}

console.log('\n=== KHOA SAU NHIEU LAN DOAN ===');
{
  const saved = cookieJar; cookieJar = '';
  let locked = false;
  for (let i = 0; i < 9; i++) {
    const r = await post({ action: 'login', password: 'lai-sai' }, { ip: '10.0.0.99' });
    if (r.status === 429) { locked = true; break; }
  }
  check('doan sai nhieu lan thi bi khoa 429', locked);
  const r = await post({ action: 'login', password: TEST_PASSWORD }, { ip: '10.0.0.99' });
  check('dang bi khoa thi mat khau DUNG cung khong vao duoc', r.status === 429, 'status ' + r.status);
  cookieJar = saved;
}

console.log('\n=== GIA MAO X-FORWARDED-FOR ===');
const cookieBeforeXff = cookieJar;
/* Hai duong nay tung mo that. Bo dem lay chang DAU cua x-forwarded-for, ma
   chang do do nguoi goi tu dat. Xem ghi chu o clientKey trong api/_auth.js. */
{
  /* 1. Ke la gui dia chi THAT cua chu trang de khoa chu trang ra ngoai. */
  const saved = cookieJar; cookieJar = '';
  const VICTIM = '198.51.100.9';
  for (let i = 0; i < 8; i++) {
    await post({ action: 'login', password: 'sai-' + i },
      { headers: { 'x-zecat-admin': '1', 'x-forwarded-for': VICTIM, 'x-real-ip': '203.0.113.200' } });
  }
  /* Chu trang den tu chinh dia chi do, voi mat khau DUNG. */
  const r = await post({ action: 'login', password: TEST_PASSWORD },
    { headers: { 'x-zecat-admin': '1', 'x-real-ip': VICTIM } });
  check('ke la khong khoa duoc chu trang bang XFF gia', r.status === 200,
    'status ' + r.status + ' ' + JSON.stringify(r.json));
  cookieJar = saved;
}
{
  /* 2. Doi chang dau moi lan de tron bo dem. Chang cuoi va x-real-ip van la
        cua ke do, nen den lan thu bay phai bi khoa. */
  cookieJar = '';
  let locked = false;
  for (let i = 0; i < 12; i++) {
    const r = await post({ action: 'login', password: 'doan-' + i }, {
      headers: {
        'x-zecat-admin': '1',
        'x-forwarded-for': '1.2.3.' + i + ', 203.0.113.44',
        'x-real-ip': '203.0.113.44',
      },
    });
    if (r.status === 429) { locked = true; break; }
  }
  check('doi XFF lien tuc van bi khoa', locked);
}
{
  /* 3. Khong co x-real-ip thi phai lay chang CUOI cua XFF, khong phai chang dau. */
  cookieJar = '';
  let locked = false;
  for (let i = 0; i < 12; i++) {
    const r = await post({ action: 'login', password: 'doan-' + i },
      { headers: { 'x-zecat-admin': '1', 'x-forwarded-for': '9.9.9.' + i + ', 203.0.113.77' } });
    if (r.status === 429) { locked = true; break; }
  }
  check('thieu x-real-ip thi chang cuoi cua XFF duoc dung', locked);
}

/* Ba bai tren co xoa cookie de thu tung dia chi rieng. Tra lai phien cua
   chu trang truoc khi di tiep, neu khong moi bai sau deu truot vi mat phien
   va ta se tuong nham la code hong. */
cookieJar = cookieBeforeXff;

console.log('\n=== THE PHIEN GIA ===');
{
  const saved = cookieJar;
  cookieJar = 'zc_admin=' + Buffer.from(JSON.stringify({ v: 1, exp: 9e9 })).toString('base64url') + '.giaMao';
  const r = await post({ action: 'session' });
  check('the tu che khong ky dung thi khong duoc chap nhan', r.json && r.json.signedIn === false);
  cookieJar = saved;
}

console.log('\n=== UPLOAD ===');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(9000, 7)]).toString('base64');
const NOT_JPEG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(9000, 7)]).toString('base64');
{
  const r = await post({ action: 'upload', slug: 'Bad Slug!', title: 'x', alt: 'a'.repeat(20), thumb: JPEG, full: JPEG, w: 10, h: 10 });
  check('slug ban bi tu choi', r.status === 400);
}
{
  /* Mo ta la tuy chon tu khi khu quan tri cho tha nhieu anh mot luc. De
     trong thi de trong that, khong bia ra mot cau mo ta gia. */
  const r = await post({ action: 'upload', slug: 'no-alt', alt: '', thumb: JPEG, full: JPEG, w: 10, h: 10 });
  check('alt de trong van upload duoc', r.status === 200, JSON.stringify(r.json));
  const row = db.prepare('SELECT alt, title FROM memes WHERE slug=?').get('no-alt');
  check('alt luu thanh chuoi rong chu khong phai chu bia', row && row.alt === '', JSON.stringify(row));
  check('title tu suy ra tu ten file', row && row.title === 'No alt', JSON.stringify(row));
}
{
  const r = await post({ action: 'upload', slug: 'long-alt', alt: 'a'.repeat(400), thumb: JPEG, full: JPEG, w: 10, h: 10 });
  check('alt qua dai bi tu choi', r.status === 400);
}
{
  const r = await post({ action: 'upload', slug: 'fake-png', title: 'Title', alt: 'a'.repeat(20), thumb: NOT_JPEG, full: NOT_JPEG, w: 10, h: 10 });
  check('file khong phai JPEG bi tu choi du doi duoi', r.status === 400, JSON.stringify(r.json));
}
{
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024, 1)]).toString('base64');
  const r = await post({ action: 'upload', slug: 'too-big', title: 'Title', alt: 'a'.repeat(20), thumb: JPEG, full: big, w: 10, h: 10 });
  check('anh qua lon bi tu choi', r.status === 400);
}
{
  const r = await post({ action: 'upload', slug: 'test-meme', title: 'Test meme', alt: 'A description long enough', tag: 'scene', thumb: JPEG, full: JPEG, w: 800, h: 600 });
  check('upload hop le thi thanh cong', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
  const row = db.prepare('SELECT slug, stored, alt FROM memes WHERE slug=?').get('test-meme');
  check('hang meme duoc ghi voi stored=1', row && row.stored === 1, JSON.stringify(row));
  const blobs = db.prepare('SELECT variant FROM meme_blobs WHERE slug=?').all('test-meme');
  check('hai ban anh duoc ghi', blobs.length === 2, JSON.stringify(blobs));
}
{
  /* Tha mot loat anh thi ten file trung nhau la chuyen binh thuong, nen may
     chu tu them so thay vi bat nguoi dung doi ten tung tam. */
  const r = await post({ action: 'upload', slug: 'test-meme', alt: '', thumb: JPEG, full: JPEG, w: 10, h: 10 });
  check('slug trung thi tu doi ten', r.status === 200 && r.json.slug === 'test-meme-2',
    JSON.stringify(r.json));
  const r2 = await post({ action: 'upload', slug: 'test-meme', alt: '', thumb: JPEG, full: JPEG, w: 10, h: 10 });
  check('lan thu ba thanh -3', r2.status === 200 && r2.json.slug === 'test-meme-3',
    JSON.stringify(r2.json));
  const all = db.prepare("SELECT COUNT(*) n FROM memes WHERE slug LIKE 'test-meme%'").get();
  check('ba hang rieng biet trong D1', all.n === 3, JSON.stringify(all));
}

console.log('\n=== PHUC VU ANH ===');
{
  const r = await call(imageHandler, { method: 'GET', query: { slug: 'test-meme', v: 'thumb' } });
  check('anh tra ve 200', r.status === 200, 'status ' + r.status);
  check('dung content-type', r.headers['content-type'] === 'image/jpeg');
  check('co cache immutable', String(r.headers['cache-control']).includes('immutable'));
  check('dung byte JPEG', Buffer.isBuffer(r.body) && r.body[0] === 0xff && r.body[1] === 0xd8);
}
{
  const r = await call(imageHandler, { method: 'GET', query: { slug: '../../etc/passwd', v: 'thumb' } });
  check('slug di nguoc duong dan bi tu choi', r.status === 400);
}
{
  const r = await call(imageHandler, { method: 'GET', query: { slug: 'khong-co', v: 'full' } });
  check('anh khong ton tai tra 404', r.status === 404);
}

console.log('\n=== DOI MAT KHAU ===');
const NEW_PASSWORD = 'another-long-passphrase-' + Math.random().toString(36).slice(2);
{
  const r = await post({ action: 'password', current: 'sai', next: NEW_PASSWORD });
  check('mat khau hien tai sai thi khong doi duoc', r.status === 401);
}
{
  const r = await post({ action: 'password', current: TEST_PASSWORD, next: 'ngan' });
  check('mat khau moi qua ngan bi tu choi', r.status === 400);
}
const oldCookie = cookieJar;
{
  const r = await post({ action: 'password', current: TEST_PASSWORD, next: NEW_PASSWORD });
  check('doi mat khau thanh cong', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
  const row = db.prepare('SELECT token_version FROM admin WHERE id=1').get();
  check('token_version tang len', row.token_version === 2, JSON.stringify(row));
}
{
  const saved = cookieJar;
  cookieJar = oldCookie;
  const r = await post({ action: 'session' });
  check('phien cu tren may khac bi da ra ngoai', r.json && r.json.signedIn === false);
  cookieJar = saved;
}
{
  const r = await post({ action: 'session' });
  check('may vua doi mat khau van con dang nhap', r.json && r.json.signedIn === true);
}
{
  cookieJar = '';
  const a = await post({ action: 'login', password: TEST_PASSWORD }, { ip: '10.0.0.5' });
  check('mat khau CU khong con dung duoc', a.status === 401);
  const b = await post({ action: 'login', password: NEW_PASSWORD }, { ip: '10.0.0.5' });
  check('mat khau MOI dung duoc', b.status === 200, JSON.stringify(b.json));
}

console.log('\n=== KHONG CO KHOA KY THI TAT HAN ===');
{
  const secret = process.env.ADMIN_SECRET;
  delete process.env.ADMIN_SECRET;
  const r = await post({ action: 'login', password: NEW_PASSWORD });
  check('thieu ADMIN_SECRET thi dong cua, khong mo cua', r.status === 503, 'status ' + r.status);
  process.env.ADMIN_SECRET = secret;
}

console.log('\n=== GO MEME ===');
{
  await post({ action: 'login', password: NEW_PASSWORD }, { ip: '10.0.0.7' });
  db.prepare("INSERT INTO memes (slug,title,alt,tag,sort,stored) VALUES ('in-repo','R','desc long enough','scene',5,0)").run();
  const r = await post({ action: 'remove', slug: 'in-repo' });
  check('khong go duoc anh nam trong repo', r.status === 400, JSON.stringify(r.json));
  const r2 = await post({ action: 'remove', slug: 'test-meme' });
  check('go duoc anh da upload', r2.status === 200, JSON.stringify(r2.json));
  const other = db.prepare("SELECT COUNT(*) n FROM memes WHERE slug IN ('test-meme-2','test-meme-3')").get();
  check('go mot tam khong dung den nhung tam da doi ten', other.n === 2, JSON.stringify(other));
  const left = db.prepare('SELECT COUNT(*) n FROM meme_blobs WHERE slug=?').get('test-meme');
  check('byte anh cung bi xoa theo', left.n === 0);
}

console.log('\n' + (fail === 0 ? 'TAT CA ' + pass + ' PHEP THU DEU QUA' : pass + ' qua, ' + fail + ' LOI'));
d1.close();
process.exit(fail === 0 ? 0 : 1);
