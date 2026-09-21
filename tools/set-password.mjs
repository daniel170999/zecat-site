/* ===========================================================================
   set-password.mjs  ·  dat hoac doi mat khau cua khu quan tri
   ---------------------------------------------------------------------------
       node tools/set-password.mjs

   Lenh nay doc mat khau tu ban phim. No KHONG hien len man hinh, KHONG vao
   lich su shell, KHONG duoc ghi ra file nao, va KHONG bao gio roi vao repo.
   Thu duy nhat no in ra la mot cau lenh SQL chua scrypt hash.

   Vi sao khong nhan mat khau qua tham so dong lenh: tham so dong lenh nam
   trong lich su shell, trong bang tien trinh, va thuong ca trong log cua CI.

   Tham so scrypt lay THANG tu api/_auth.js, nen hash sinh o day va hash may
   chu kiem tra khong the lech nhau.
   =========================================================================== */

import { createInterface } from 'node:readline';
import crypto from 'node:crypto';
import { hashPassword, newSalt } from '../api/_auth.js';

/** Trung voi MIN_PASSWORD trong api/admin.js. */
const MIN = 12;

/**
 * Doc mot dong tu ban phim ma khong hien ky tu nao.
 * Khong dung thu vien: bat raw mode roi tu doc tung phim.
 */
function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new Error('khong phai terminal that, hay chay lenh nay truc tiep trong terminal'));
      return;
    }
    stdout.write(prompt);

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const done = (err, out) => {
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (err) reject(err); else resolve(out);
    };

    const onData = (chunk) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (code === 13 || code === 10) return done(null, value);          // enter
        if (code === 3) return done(new Error('da huy'));                  // ctrl-c
        if (code === 127 || code === 8) { value = value.slice(0, -1); continue; }  // xoa lui
        if (code < 32) continue;                                            // bo ky tu dieu khien
        value += ch;
      }
    };

    stdin.on('data', onData);
  });
}

function ask(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (a) => { rl.close(); resolve(a.trim()); }));
}

/* --------------------------------------------------------------------- */

console.log('');
console.log('  Dat mat khau cho khu quan tri cua $ZECAT.');
console.log('  Mat khau se khong hien len man hinh.');
console.log('');

let password;
try {
  password = await askHidden('  Mat khau moi:      ');
  const again = await askHidden('  Go lai lan nua:    ');
  if (password !== again) {
    console.error('\n  Hai lan go khac nhau. Khong ghi gi ca.\n');
    process.exit(1);
  }
} catch (err) {
  console.error('\n  ' + err.message + '\n');
  process.exit(1);
}

if (password.length < MIN) {
  console.error('\n  Can it nhat ' + MIN + ' ky tu. Khong ghi gi ca.\n');
  process.exit(1);
}

/* Mot canh bao, khong phai mot rao can. Day la may cua chu trang. */
const weak = /^[a-z]+[0-9]{1,6}[^a-z0-9]?$/i.test(password);
if (weak) {
  console.log('');
  console.log('  Luu y: mat khau nay theo dung khuon ma may do mat khau thu dau tien');
  console.log('  (mot tu, vai chu so, mot ky tu dac biet o cuoi). No van duoc chap');
  console.log('  nhan, nhung mot chuoi bon tu ngau nhien se manh hon nhieu lan.');
  const go = await ask('  Van dung mat khau nay? (y/N) ');
  if (go.toLowerCase() !== 'y') { console.log('\n  Da dung. Khong ghi gi ca.\n'); process.exit(1); }
}

const salt = newSalt();
const hash = hashPassword(password, salt);
password = null;                                   // khong giu lai trong bo nho lau hon can thiet

const now = new Date().toISOString();

/* token_version = so hien tai + 1 trong truong hop doi mat khau, nen moi
   phien dang mo o may khac chet ngay. Voi lan dat dau tien thi la 1. */
const sql =
  "INSERT INTO admin (id, pass_hash, pass_salt, token_version, updated_at) " +
  "VALUES (1, '" + hash + "', '" + salt + "', 1, '" + now + "') " +
  "ON CONFLICT(id) DO UPDATE SET pass_hash = excluded.pass_hash, " +
  "pass_salt = excluded.pass_salt, token_version = admin.token_version + 1, " +
  "updated_at = excluded.updated_at";

console.log('');
console.log('  Xong. Chay lenh nay tu thu muc site/ :');
console.log('');
console.log('  npx wrangler d1 execute zecat --remote --command "' + sql + '"');
console.log('');
console.log('  Trong do khong co mat khau, chi co hash. Dan lenh nay di dau cung khong sao.');
console.log('');

/* Chi goi y khoa ky khi no chua duoc dat. Lenh nay khong doc duoc bien moi
   truong tren Vercel, nen day chi la loi nhac. */
console.log('  CHI khi chua tung dat: con mot bien moi truong nua tren Vercel.');
console.log('  Day la mot khoa MOI duoc sinh ra ngay bay gio. Neu tren Vercel da co');
console.log('  ADMIN_SECRET roi thi BO QUA dong duoi, vi thay no se da moi nguoi');
console.log('  dang dang nhap ra ngoai.');
console.log('');
console.log('    ADMIN_SECRET = ' + crypto.randomBytes(32).toString('base64url'));
console.log('');
console.log('  Khoa nay dung de ky the phien. Thieu no thi ca khu quan tri tu tat.');
console.log('  Doi no la cach nhanh nhat de dong cua neu co chuyen gi xay ra.');
console.log('  No vua duoc in ra man hinh nay, nen dung dan no vao cho nao khac');
console.log('  ngoai o bien moi truong cua Vercel.');
console.log('');
