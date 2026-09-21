# site/ — website chinh thuc cua $ZECAT

Website cong khai cua $ZECAT, meme token tren Zcash giao dich qua SHLD.fun.
Static HTML cong vai serverless function doc du lieu. **Khong co buoc build**, deploy thang len Vercel.

Toan bo noi dung nam san trong `public/index.html`. Trang dung duoc khi tat javascript, va dung duoc truoc khi bat ky request nao tra ve. Javascript chi lam mot viec: nang cap nhung gi da dung san thanh ban moi hon.

---

## Ba lenh can nho

```bash
node tools/dev-server.mjs                                # xem tai cho, ca /api/*
node tools/sync-data.mjs                                 # sau khi them/sua mot meme
node tools/sync-data.mjs --tape                          # lam moi toan bo so lieu thi truong
```

Sua chu tren trang xong thi chay them, tu thu muc cha:

```bash
node tools/check.js
```

Lenh `check.js` nam o thu muc cha, ngoai repo nay, vi no la cong cu noi bo. No doi chieu chu tren website voi `brand/VOICE.md` va `CLAUDE.md`: cau claim bi cam, cau noi rieng tu nhu tuyet doi, em-dash, dau cham than, anh thieu alt, anh thieu kich thuoc, va so lieu thi truong dang ma khong kem moc thoi gian. Phai ra `KHONG CO LOI` moi duoc push.

---

## Ban do thu muc

```
site/
  package.json      "type":"module", node >=20, khong dependency, khong build script
  vercel.json       header bao mat + CSP + cache, cleanUrls, va includeFiles cho function
  .env.example      mau ba bien Cloudflare D1, copy thanh .env.local khi chay may
  .gitignore        node_modules, .vercel, .env, .env*.local, rac cua OS
  README.md         file nay
  public/           static root, Vercel phuc vu nguyen xi thu muc nay
    index.html      TOAN BO trang. Noi dung nam o day, khong o cho khac.
    robots.txt      sitemap duoc them vao boi --origin
    assets/         site.css, site.js
    meme/           anh meme ban day du, canh dai 1400px
    thumb/          anh thumbnail, canh dai 600px, CUNG TEN FILE voi meme/
    brand/          logo, icon, og.png, character sheet, video cover
    data/           JSON bundle, nguon fallback cho moi route api
    *.mp4           clip
  api/              serverless function, moi route mot file
  db/               schema.sql va seed.sql cho Cloudflare D1
  tools/
    dev-server.mjs  may chu de thu tai cho, co ca route api
    sync-data.mjs   sinh JSON, dong kich thuoc anh, lam moi tape, dat ten mien
```

---

## Chay tren may

```bash
node tools/dev-server.mjs
```

Mo `http://localhost:8099`. Ca `/api/tape`, `/api/memes`, `/api/posts` deu song. Khong can `npm install` vi du an khong co dependency nao.

Muon chay dung moi truong that cua Vercel thi `npx vercel dev`, nhung lenh do bat dang nhap va link project truoc.

---

## Deploy

**Git repo la chinh thu muc `site/` nay, khong phai thu muc cha.** Co y nhu vay: thu muc cha chua `Credentials.txt`, `brand/`, `research/`, `work/` va toan bo lich dang bai. Khong thu nao trong so do duoc phep len GitHub cong khai. Repo tach o day thi khong co duong nao ro ri.

```bash
git remote add origin git@github.com:<tai-khoan>/zecat-site.git
```

```bash
git push -u origin main
```

Roi tren Vercel:

1. **Add New > Project**, import repo vua push.
2. **Root Directory**: de mac dinh, dung sua. Repo nay da la goc roi.
3. **Framework Preset**: `Other`.
4. **Build Command**: de trong. **Output Directory**: `public`. **Install Command**: de trong.
5. Deploy. Nhung lan sau chi can push len `main`.

Ten mien production da dat san la `https://zecatzcash.vercel.app`. Neu Vercel cap dia chi khac, xem muc duoi.

### Doi ten mien

Ten mien hien tai da duoc dat san trong ma nguon: `https://zecatzcash.vercel.app`. Chi chay lenh duoi khi dia chi that KHAC cai do, hoac khi mua duoc ten mien rieng:

```bash
node tools/sync-data.mjs --origin https://ten-mien-moi
```

Roi commit va push. Lenh nay lam bon viec:

- doi `og:image` va `twitter:image` sang duong dan tuyet doi
- dat `canonical` va `og:url`
- sinh `public/sitemap.xml`
- them dong `Sitemap:` vao `public/robots.txt`

Chay lai voi ten mien khac la ghi de, khong nhan doi. Neu `og:image` quay ve duong dan tuong doi thi link chia se len X se mat anh preview: X khong doc duoc duong dan tuong doi.

Neu muon Vercel tu lam viec nay moi lan deploy: dat **Build Command** thanh `node tools/sync-data.mjs --origin`. Bo trong gia tri thi lenh tu doc `VERCEL_PROJECT_PRODUCTION_URL`.

---

## Tao database D1 va nap sql

D1 **khong bat buoc**. Khong set bien nao thi moi route tu dong doc `public/data/*.json`. D1 chi la duong de them noi dung ma khong phai push code.

```bash
npx wrangler d1 create zecat
npx wrangler d1 execute zecat --remote --file=./db/schema.sql
npx wrangler d1 execute zecat --remote --file=./db/seed.sql
```

Lenh `create` in ra `database_id`. **Vercel project > Settings > Environment Variables**, them ba bien, tick ca ba moi truong Production / Preview / Development:

| Bien | Lay o dau |
|---|---|
| `CF_ACCOUNT_ID` | Cloudflare dashboard, cuoi URL `dash.cloudflare.com/<ACCOUNT_ID>` |
| `CF_D1_DATABASE_ID` | Output cua `wrangler d1 create zecat`, hoac Storage & Databases > D1 > zecat |
| `CF_API_TOKEN` | My Profile > API Tokens > Create Token, quyen Account > D1 > Edit |

Them bien xong phai **redeploy** thi function moi doc duoc.

---

## Route api

Moi file trong `api/` la mot route. Ten file bat dau bang `_` thi Vercel khong route, nen `_d1.js` chi duoc import chu khong thanh endpoint.

| Path | Tra ve | Khi upstream loi hoac thieu env |
|---|---|---|
| `/api/tape` | So lieu thi truong cua $ZECAT: doc `https://shld.fun/zsa/api/tokens`, loc theo `assetId`, quy doi USD bang `https://shld.fun/api/zec-usd` | Hang so `SNAPSHOT` trong chinh `api/tape.js`, danh dau `source:"snapshot"` kem `takenAt` |
| `/api/memes` | Danh sach meme tu bang `memes` trong D1. Nhan `?tag=` va `?limit=` | `public/data/memes.json`, danh dau `source:"static"` |
| `/api/posts` | Bai dang tren X tu bang `posts` trong D1. Nhan `?limit=` | `public/data/posts.json`, danh dau `source:"static"` |

**Hai nguyen tac, khong duoc pha:**

1. **Khong route nao duoc lam vo trang.** Upstream cham hay 500 thi bat loi, tra ban du phong, va ghi ro `source`. Khong bao gio tra 5xx.
2. **Thieu mot con so KHONG PHAI la so khong.** `Number(null)` bang 0, va 0 di lot moi cong kiem tra. Moi gia tri tu upstream phai qua `num()`, tra ve `NaN` khi vang mat, de ca ban doc rot ve snapshot thay vi dang mot con so bia. `tipHeight` la ngoai le duy nhat: no chi de hien thi, vang mat cung khong sao.

Coin page: `https://shld.fun/coin?a=dbc23d99cf614e1146c1c49d8e94646227f71c59cb1c2ea3731ce264c48bc32a`

---

## Lam moi so lieu thi truong

```bash
node tools/sync-data.mjs --tape
```

Doc thang indexer bang chinh ham `derive()` cua `api/tape.js`, roi ghi ba cho cung mot lan:

- `public/data/tape.json` — ban du phong khi host khong co route api
- `public/index.html` — tam o tape va dong `read ... utc`
- `api/tape.js` — hang so `SNAPSHOT`

Chay lai bao nhieu lan cung duoc, ket qua khong nhan doi. Indexer tra ve so khong dung thi lenh dung lai va khong ghi gi ca.

Con so nuong san trong html la thu ma con bot va khach tat javascript nhin thay. Chung **phai** di kem moc thoi gian va link ve coin page. Cu de cu vai ngay thi khong sao, miễn la moc thoi gian noi that. `node tools/check.js` chan truong hop mat moc thoi gian.

---

## Khu quan tri: them meme thang tu trinh duyet

Co mot khu quan tri an trong chinh trang chu. Khong co link, khong co duong
dan rieng, khong co gi trong menu.

**Cach vao:** nhan dup vao dong chu ky o chan trang, dong `The visor stays on.`

### Noi thang mot dieu truoc khi dung

Cu chi nhan dup **khong phai** la lop bao mat. No nam trong `assets/site.js`,
ma file do ai cung tai duoc. Nguoi chiu doc ma nguon se tim ra trong mot phut.

Cai thuc su giu cua la ba thu, va ca ba deu o phia may chu:

| | |
|---|---|
| Mat khau | scrypt, N=32768. Mot lan thu mat khoang 100ms. Trong D1 chi co hash va salt, khong bao gio co mat khau. |
| Gioi han | Sai 6 lan tu cung mot dia chi thi khoa 15 phut. |
| The phien | Ky bang HMAC voi `ADMIN_SECRET`. Cookie HttpOnly, Secure, SameSite=Strict. |

Thieu `ADMIN_SECRET` hoac thieu D1 thi toan bo khu quan tri **tu tat** va tra
ve 503. Dong cua khi hong, khong mo cua khi hong.

### Dat mat khau

```bash
node tools/set-password.mjs
```

Lenh nay doc mat khau tu ban phim, **khong hien len man hinh**, khong vao lich
su shell, va khong ghi ra file nao. No in ra mot cau lenh `wrangler` chua
scrypt hash. Trong cau lenh do khong co mat khau, nen dan no di dau cung khong sao.

Chay cau lenh no in ra, roi dat bien moi truong tren Vercel:

| Bien | La gi |
|---|---|
| `ADMIN_SECRET` | Khoa ky the phien. Lenh tren co sinh san mot cai. **Doi khoa nay la da tat ca moi nguoi ra ngoai ngay lap tuc** — do la cach nhanh nhat de dong cua neu co chuyen. |
| `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `CF_API_TOKEN` | Nhu muc D1 o tren. Token phai co quyen **ghi**, vi upload ghi vao database. |

Them bien xong phai **redeploy** thi function moi doc duoc.

### Doi mat khau sau nay

Vao khu quan tri, tab **Change password**. Doi xong thi moi phien dang mo tren
may khac chet ngay lap tuc, vi `token_version` tang len va the cu het gia tri.

Quen mat khau thi khong co duong khoi phuc nao qua trinh duyet: chay lai
`node tools/set-password.mjs` tren may va nap lai SQL.

### Them mot meme qua khu quan tri

Keo mot tam anh vao. **Trinh duyet tu thu nho** thanh hai ban, 1400px va
600px, roi nen lai JPEG. Nho vay may chu khong can thu vien xu ly anh nao, va
thu di qua mang chi con vai chuc KB.

Phai dien mo ta cho nguoi khong nhin thay anh. Do khong phai o tuy chon: thieu
no thi upload bi tu choi.

Anh upload duoc luu **trong D1** dang base64 va phuc vu qua `/api/meme-image`.
Anh nam trong repo van chay duong cu. Tuong anh doc duoc ca hai, va `stored`
trong bang `memes` la thu phan biet.

Khong can deploy lai. Tuong anh tu keo ve ngay sau khi them.

### Chay lai bai kiem tra sau moi lan sua

```bash
node tools/test-admin.mjs
```

41 phep thu, khong can mang, khong can Cloudflare: no dung mot D1 gia chay tren
sqlite trong bo nho va goi thang cac handler. Can `npm i -g better-sqlite3`
mot lan.

Doan ma xac thuc la cho duy nhat trong du an ma mot loi im lang co the mo cua
cho nguoi la, va mat thuong khong nhin ra duoc. Sua `api/_auth.js` hay
`api/admin.js` xong ma chua chay lai bai nay thi dung push.

---

## Them mot meme moi

1. Bo hai file jpg **cung ten**:
   - ban day du vao `public/meme/<ten-meme>.jpg`, canh dai 1400px
   - ban thumbnail vao `public/thumb/<ten-meme>.jpg`, canh dai 600px
2. Them mot the `<figure class="tile">` vao `public/index.html`, chep theo the ngay tren no. Bat buoc co `data-slug`, `data-title`, `data-tag`, `data-alt`, va `alt` tren the `<img>`. **`alt` khong duoc trung y het caption**, doc len se bi lap.
3. Chay:

```bash
node tools/sync-data.mjs
```

No sinh lai `public/data/memes.json` va dong `width`/`height` that len the `<img>` bang cach doc header cua chinh file jpg. Khong co hai so do thi trang giat mot cai khi anh tai xong.

4. Chay `node tools/check.js` o thu muc goc.

Ten file la khoa noi hai ban anh voi nhau. Chi dung chu thuong, so, gach ngang. Khong dau, khong khoang trang.

Duong qua D1 (khong can push code):

```bash
npx wrangler d1 execute zecat --remote --command "INSERT INTO memes (slug, title, alt, tag) VALUES ('ten-meme', 'tieu de', 'mo ta cho nguoi khong nhin thay', 'scene');"
```

`site.js` se them tile do vao tuong. Slug khong sach thi bi bo qua, va anh 404 thi tile tu go minh ra khoi tuong.

---

## Kiem tra truoc khi push

- [ ] `node tools/dev-server.mjs` chay len duoc, `/` va tung route `/api/*` deu tra 200.
- [ ] `node tools/check.js` o thu muc goc ra `KHONG CO LOI`.
- [ ] `node tools/sync-data.mjs` chay sach, khong bao anh nao thieu kich thuoc.
- [ ] Doi tam `assetId` trong `api/tape.js` thanh sai roi goi lai `/api/tape`: phai ra `source:"snapshot"`, khong duoc 500. Nho doi lai.
- [ ] Bam thu bo loc `poster` / `scene` / `video`: so anh con lai phai khop voi dong dem ben duoi.
- [ ] Mo mot meme, bam `next` vai lan, bam `close`: focus phai quay ve dung o anh dang xem.
- [ ] Console trinh duyet sach.
- [ ] Xem tren man hinh 375px: khong tran ngang, header khong an qua mot phan nam man hinh.
- [ ] Khong commit `.env`, `.env.local`, `.vercel/`, hay file nao chua token.
- [ ] Link ngoai tro dung cho: [coin page](https://shld.fun/coin?a=dbc23d99cf614e1146c1c49d8e94646227f71c59cb1c2ea3731ce264c48bc32a), [x.com/ZecatZcash](https://x.com/ZecatZcash), [t.me/zcashalpha](https://t.me/zcashalpha), [x.com/SHLDdotfun](https://x.com/SHLDdotfun).

---

## Hai viec con lai, can nguoi lam

- **Phu de cho clip.** `public/zecat-dox-attempt.mp4` dai 18 giay va **co tieng**. Khong ai o day nghe duoc no de chep lai, nen tam thoi duoi clip co mot doan mo ta bang chu. Viet file `public/zecat-dox-attempt.vtt` roi them `<track kind="captions" src="zecat-dox-attempt.vtt" srclang="en" label="english" default>` vao trong the `<video>`. **Dung them the `<track>` truoc khi file vtt ton tai**, trinh phat se hien menu phu de rong.
- **Cau chu chay san trong clip.** Clip co dong chu "THE FIRST MEME COIN ON ZCASH" chay san trong hinh, va bio cua @ZecatZcash cung dang ghi "First memecoin on @Zcash". Website da bo cau do theo `brand/VOICE.md` muc 4, nhung hai cho kia van con. Sua duoc thi sua, vi do la be mat nhieu nguoi thay hon ca website.
