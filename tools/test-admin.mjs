/* ===========================================================================
   test-admin.mjs  -  exercise the admin authentication flow
   ---------------------------------------------------------------------------
       npm i -g better-sqlite3      (once)
       node tools/test-admin.mjs

   No Cloudflare account or network is needed. An in-memory SQLite database
   emulates Cloudflare's /query response and invokes the real API handlers.

   Run after every change to api/_auth.js or api/admin.js. Authentication
   mistakes can silently expose the admin area.

   Test passwords are generated each run. Never put the real password here.
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

/* ---- Fake D1: accept {sql, params}, return Cloudflare's response shape ---- */
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

/* ---- Set a test password, never the operator's real password ---- */
const TEST_PASSWORD = 'correct-horse-battery-staple-' + Math.random().toString(36).slice(2);
const salt = newSalt();
db.prepare('INSERT INTO admin (id, pass_hash, pass_salt, token_version, updated_at) VALUES (1,?,?,1,?)')
  .run(hashPassword(TEST_PASSWORD, salt), salt, new Date().toISOString());

/* ---- Invoke handlers as Vercel does ---- */
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
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
};

console.log('\n=== ENTRY GATE ===');
{
  const r = await call(adminHandler, { method: 'GET', headers: { 'x-zecat-admin': '1' } });
  check('GET is rejected', r.status === 405, 'status ' + r.status);
}
{
  const r = await post({ action: 'session' }, { headers: {} });
  check('missing x-zecat-admin header is rejected (CSRF)', r.status === 405, 'status ' + r.status);
}
{
  const r = await call(adminHandler, {
    body: { action: 'session' },
    headers: { 'x-zecat-admin': '1', 'content-type': 'text/plain' },
  });
  check('non-JSON Content-Type is rejected', r.status === 405, 'status ' + r.status);
}

console.log('\n=== SIGN-IN ===');
{
  const r = await post({ action: 'session' });
  check('signedIn is false before sign-in', r.json && r.json.signedIn === false);
}
{
  const r = await post({ action: 'upload', slug: 'x', title: 'x', alt: 'x'.repeat(20) });
  check('upload without sign-in returns 401', r.status === 401, 'status ' + r.status);
}
{
  const r = await post({ action: 'login', password: 'definitely-wrong' });
  check('wrong password is rejected', r.status === 401);
  check('error does not expose internal details', r.json && r.json.error === 'Wrong password.', JSON.stringify(r.json));
}
{
  const r = await post({ action: 'login', password: TEST_PASSWORD });
  check('correct password signs in', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
  const c = String(r.headers['set-cookie'] || '');
  check('cookie has HttpOnly', /HttpOnly/i.test(c), c);
  check('cookie has Secure', /Secure/i.test(c), c);
  check('cookie has SameSite=Strict', /SameSite=Strict/i.test(c), c);
}
{
  const r = await post({ action: 'session' });
  check('signedIn is true after sign-in', r.json && r.json.signedIn === true);
}

console.log('\n=== FAILED-ATTEMPT LOCKOUT ===');
{
  const saved = cookieJar; cookieJar = '';
  let locked = false;
  for (let i = 0; i < 9; i++) {
    const r = await post({ action: 'login', password: 'wrong-again' }, { ip: '10.0.0.99' });
    if (r.status === 429) { locked = true; break; }
  }
  check('repeated wrong guesses trigger 429', locked);
  const r = await post({ action: 'login', password: TEST_PASSWORD }, { ip: '10.0.0.99' });
  check('lockout also blocks the correct password', r.status === 429, 'status ' + r.status);
  cookieJar = saved;
}

console.log('\n=== SPOOFED X-FORWARDED-FOR ===');
const cookieBeforeXff = cookieJar;
/* Trusting the caller-controlled first XFF hop enabled both attacks below.
   See clientKey in api/_auth.js. */
{
  /* 1. Spoof the owner's address to lock the owner out. */
  const saved = cookieJar; cookieJar = '';
  const VICTIM = '198.51.100.9';
  for (let i = 0; i < 8; i++) {
    await post({ action: 'login', password: 'wrong-' + i },
      { headers: { 'x-zecat-admin': '1', 'x-forwarded-for': VICTIM, 'x-real-ip': '203.0.113.200' } });
  }
  /* The owner connects from that address with the correct password. */
  const r = await post({ action: 'login', password: TEST_PASSWORD },
    { headers: { 'x-zecat-admin': '1', 'x-real-ip': VICTIM } });
  check('spoofed XFF cannot lock out the owner', r.status === 200,
    'status ' + r.status + ' ' + JSON.stringify(r.json));
  cookieJar = saved;
}
{
  /* 2. Rotate the first XFF hop; the trusted address must still hit lockout. */
  cookieJar = '';
  let locked = false;
  for (let i = 0; i < 12; i++) {
    const r = await post({ action: 'login', password: 'guess-' + i }, {
      headers: {
        'x-zecat-admin': '1',
        'x-forwarded-for': '1.2.3.' + i + ', 203.0.113.44',
        'x-real-ip': '203.0.113.44',
      },
    });
    if (r.status === 429) { locked = true; break; }
  }
  check('rotating XFF still triggers lockout', locked);
}
{
  /* 3. Without x-real-ip, use the last XFF hop rather than the first. */
  cookieJar = '';
  let locked = false;
  for (let i = 0; i < 12; i++) {
    const r = await post({ action: 'login', password: 'guess-' + i },
      { headers: { 'x-zecat-admin': '1', 'x-forwarded-for': '9.9.9.' + i + ', 203.0.113.77' } });
    if (r.status === 429) { locked = true; break; }
  }
  check('last XFF hop is used without x-real-ip', locked);
}

/* The spoofing cases cleared cookies; restore the owner session before
   testing authenticated actions below. */
cookieJar = cookieBeforeXff;

console.log('\n=== FORGED SESSION ===');
{
  const saved = cookieJar;
  cookieJar = 'zc_admin=' + Buffer.from(JSON.stringify({ v: 1, exp: 9e9 })).toString('base64url') + '.forged';
  const r = await post({ action: 'session' });
  check('incorrectly signed token is rejected', r.json && r.json.signedIn === false);
  cookieJar = saved;
}

console.log('\n=== UPLOAD ===');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(9000, 7)]).toString('base64');
const NOT_JPEG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(9000, 7)]).toString('base64');
{
  const r = await post({ action: 'upload', slug: 'Bad Slug!', title: 'x', alt: 'a'.repeat(20), thumb: JPEG, full: JPEG, w: 10, h: 10 });
  check('invalid slug is rejected', r.status === 400);
}
{
  /* Blank descriptions remain blank; batch uploads must not invent alt text. */
  const r = await post({ action: 'upload', slug: 'no-alt', alt: '', thumb: JPEG, full: JPEG, w: 10, h: 10 });
  check('blank alt can still upload', r.status === 200, JSON.stringify(r.json));
  const row = db.prepare('SELECT alt, title FROM memes WHERE slug=?').get('no-alt');
  check('blank alt is stored as an empty string', row && row.alt === '', JSON.stringify(row));
  check('title is derived from filename', row && row.title === 'No alt', JSON.stringify(row));
}
{
  const r = await post({ action: 'upload', slug: 'long-alt', alt: 'a'.repeat(400), thumb: JPEG, full: JPEG, w: 10, h: 10 });
  check('oversized alt is rejected', r.status === 400);
}
{
  const r = await post({ action: 'upload', slug: 'fake-png', title: 'Title', alt: 'a'.repeat(20), thumb: NOT_JPEG, full: NOT_JPEG, w: 10, h: 10 });
  check('non-JPEG content is rejected despite filename', r.status === 400, JSON.stringify(r.json));
}
{
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024, 1)]).toString('base64');
  const r = await post({ action: 'upload', slug: 'too-big', title: 'Title', alt: 'a'.repeat(20), thumb: JPEG, full: big, w: 10, h: 10 });
  check('oversized image is rejected', r.status === 400);
}
{
  const r = await post({ action: 'upload', slug: 'test-meme', title: 'Test meme', alt: 'A description long enough', tag: 'scene', thumb: JPEG, full: JPEG, w: 800, h: 600 });
  check('valid upload succeeds', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
  const row = db.prepare('SELECT slug, stored, alt FROM memes WHERE slug=?').get('test-meme');
  check('meme row has stored=1', row && row.stored === 1, JSON.stringify(row));
  const blobs = db.prepare('SELECT variant FROM meme_blobs WHERE slug=?').all('test-meme');
  check('both image variants are stored', blobs.length === 2, JSON.stringify(blobs));
}
{
  /* Batch uploads can share filenames; the server resolves duplicate slugs. */
  const r = await post({ action: 'upload', slug: 'test-meme', alt: '', thumb: JPEG, full: JPEG, w: 10, h: 10 });
  check('duplicate slug is renamed', r.status === 200 && r.json.slug === 'test-meme-2',
    JSON.stringify(r.json));
  const r2 = await post({ action: 'upload', slug: 'test-meme', alt: '', thumb: JPEG, full: JPEG, w: 10, h: 10 });
  check('third duplicate receives -3', r2.status === 200 && r2.json.slug === 'test-meme-3',
    JSON.stringify(r2.json));
  const all = db.prepare("SELECT COUNT(*) n FROM memes WHERE slug LIKE 'test-meme%'").get();
  check('three separate D1 rows exist', all.n === 3, JSON.stringify(all));
}

console.log('\n=== IMAGE DELIVERY ===');
{
  const r = await call(imageHandler, { method: 'GET', query: { slug: 'test-meme', v: 'thumb' } });
  check('image returns 200', r.status === 200, 'status ' + r.status);
  check('image has correct Content-Type', r.headers['content-type'] === 'image/jpeg');
  check('image has immutable caching', String(r.headers['cache-control']).includes('immutable'));
  check('image returns JPEG bytes', Buffer.isBuffer(r.body) && r.body[0] === 0xff && r.body[1] === 0xd8);
}
{
  const r = await call(imageHandler, { method: 'GET', query: { slug: '../../etc/passwd', v: 'thumb' } });
  check('path-traversal slug is rejected', r.status === 400);
}
{
  const r = await call(imageHandler, { method: 'GET', query: { slug: 'missing-image', v: 'full' } });
  check('missing image returns 404', r.status === 404);
}

console.log('\n=== PASSWORD CHANGE ===');
const NEW_PASSWORD = 'another-long-passphrase-' + Math.random().toString(36).slice(2);
{
  const r = await post({ action: 'password', current: 'wrong', next: NEW_PASSWORD });
  check('wrong current password cannot change it', r.status === 401);
}
{
  const r = await post({ action: 'password', current: TEST_PASSWORD, next: 'short' });
  check('short new password is rejected', r.status === 400);
}
const oldCookie = cookieJar;
{
  const r = await post({ action: 'password', current: TEST_PASSWORD, next: NEW_PASSWORD });
  check('password change succeeds', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
  const row = db.prepare('SELECT token_version FROM admin WHERE id=1').get();
  check('token_version increments', row.token_version === 2, JSON.stringify(row));
}
{
  const saved = cookieJar;
  cookieJar = oldCookie;
  const r = await post({ action: 'session' });
  check('old session on another device is invalid', r.json && r.json.signedIn === false);
  cookieJar = saved;
}
{
  const r = await post({ action: 'session' });
  check('device changing the password stays signed in', r.json && r.json.signedIn === true);
}
{
  cookieJar = '';
  const a = await post({ action: 'login', password: TEST_PASSWORD }, { ip: '10.0.0.5' });
  check('old password no longer works', a.status === 401);
  const b = await post({ action: 'login', password: NEW_PASSWORD }, { ip: '10.0.0.5' });
  check('new password works', b.status === 200, JSON.stringify(b.json));
}

console.log('\n=== FAIL CLOSED WITHOUT SIGNING KEY ===');
{
  const secret = process.env.ADMIN_SECRET;
  delete process.env.ADMIN_SECRET;
  const r = await post({ action: 'login', password: NEW_PASSWORD });
  check('missing ADMIN_SECRET disables admin', r.status === 503, 'status ' + r.status);
  process.env.ADMIN_SECRET = secret;
}

console.log('\n=== REMOVE MEME ===');
{
  await post({ action: 'login', password: NEW_PASSWORD }, { ip: '10.0.0.7' });
  db.prepare("INSERT INTO memes (slug,title,alt,tag,sort,stored) VALUES ('in-repo','R','desc long enough','scene',5,0)").run();
  const r = await post({ action: 'remove', slug: 'in-repo' });
  check('repository image cannot be removed here', r.status === 400, JSON.stringify(r.json));
  const r2 = await post({ action: 'remove', slug: 'test-meme' });
  check('uploaded image can be removed', r2.status === 200, JSON.stringify(r2.json));
  const other = db.prepare("SELECT COUNT(*) n FROM memes WHERE slug IN ('test-meme-2','test-meme-3')").get();
  check('removing one image preserves renamed siblings', other.n === 2, JSON.stringify(other));
  const left = db.prepare('SELECT COUNT(*) n FROM meme_blobs WHERE slug=?').get('test-meme');
  check('removed image bytes are deleted', left.n === 0);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' TESTS PASSED' : pass + ' passed, ' + fail + ' failed'));
d1.close();
process.exit(fail === 0 ? 0 : 1);
