-- $ZECAT site database, dữ liệu khởi tạo. Cloudflare D1 (SQLite).
--
-- Áp dụng (chạy từ thư mục site/):
--   wrangler d1 execute zecat --remote --file=./db/schema.sql
--   wrangler d1 execute zecat --remote --file=./db/seed.sql
--
-- Toàn bộ dùng INSERT OR IGNORE nên chạy lại bao nhiêu lần cũng không nhân bản.
-- Sửa chữ đã seed thì phải UPDATE tay, INSERT OR IGNORE không ghi đè.
-- Chữ tiếng Anh trong file này khoá theo brand/VOICE.md. Đọc file đó trước khi sửa.

-- ---------------------------------------------------------------------------
-- memes: 15 ảnh, đúng thứ tự hiển thị. sort cách nhau 10 để chèn thêm về sau.
-- File ảnh: site/public/meme/<slug>.jpg + site/public/thumb/<slug>.jpg
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO memes (id, slug, title, alt, tag, credit, featured, sort, created_at) VALUES
  (1, 'wanted-on-zcash', 'wanted on Zcash',
   'a pixel art wanted poster pinned to a corkboard. the mugshot shows the cat against a height chart, visor on, face blurred out. the card below lists name $ZECAT, identity unknown, eyes redacted, location shielded, birthplace shld.fun.',
   'poster', NULL, 1, 10, '2026-09-20T00:00:00Z'),

  (2, 'cant-dox-the-cat', 'dox attempt: no match',
   'two investigators sit at an interrogation table with their heads in their hands. the cat sits between them under the lamp, calm, visor on. the folders stacked beside it read addresses, phone numbers, socials, wallets, identity. the screen on the wall reads no results. the caption reads you can''t dox the cat.',
   'poster', NULL, 1, 20, '2026-09-20T00:00:00Z'),

  (3, 'zero-identity', 'zero identity',
   'a corridor lined with security cameras. every screen shows a grey cat face, a red x and the words identity not found. the cat walks down the middle of it in gold, tail up, visor on.',
   'poster', NULL, 1, 30, '2026-09-20T00:00:00Z'),

  (4, 'born-at-SHLD-FUN', 'born at shld.fun',
   'the cat throws both paws in the air on top of a giant gold coin stamped with the Zcash z. gold blocks burst outward and two shield banners hang behind. the banner along the bottom reads born at shld.fun.',
   'poster', NULL, 0, 40, '2026-09-20T00:00:00Z'),

  (5, 'selectively-active', 'selectively active',
   'the cat lies flat on its back in a white bed, paws folded on its belly, visor still on. the caption calls this selectively active.',
   'poster', NULL, 0, 50, '2026-09-20T00:00:00Z'),

  (6, 'the-ZECATfather', 'the zecatfather',
   'a black movie poster parody. the cat head sits above a white tuxedo shirt with a red rose in the pocket, the title lettered beside it. small coloured words float around the edges.',
   'poster', NULL, 0, 60, '2026-09-20T00:00:00Z'),

  (7, 'newspaper', 'the morning paper',
   'the cat holds a broadsheet newspaper open at the table. only the ears, the visor and two paws show over the top of the page.',
   'scene', NULL, 0, 70, '2026-09-20T00:00:00Z'),

  (8, 'programmers-WAITING', 'still waiting',
   'two comic panels. in the first the cat sits in the middle of a crowded office while a room of programmers panics at their screens. in the second the cat fills the frame, unbothered, with one speech bubble: waiting.',
   'scene', NULL, 0, 80, '2026-09-20T00:00:00Z'),

  (9, 'alone-at-the-bar', 'alone at the bar',
   'a long dark wooden bar with one glass of white wine poured on it. the cat sits alone at the far end, back half turned, visor on.',
   'scene', NULL, 0, 90, '2026-09-20T00:00:00Z'),

  (10, 'waiting-for-the-grill', 'waiting for the grill',
   'a man crouches beside a smoking grill at the edge of a lake. the cat stands upright behind him on two legs, watching the skewers, saying nothing.',
   'scene', NULL, 0, 100, '2026-09-20T00:00:00Z'),

  (11, 'floor-after-one-drink', 'one drink in',
   'the cat lies face down on a tiled kitchen floor in jeans, one paw still around a wine glass, a bottle standing beside it. the visor is on.',
   'scene', NULL, 0, 110, '2026-09-20T00:00:00Z'),

  (12, 'meditation', 'sitting is the shill',
   'the cat sits cross legged on a mat in full lotus, paws resting on its knees, spine straight, visor on.',
   'scene', NULL, 0, 120, '2026-09-20T00:00:00Z'),

  (13, 'motorcycle', 'the getaway bike',
   'the cat rides a tiny red dirt bike across a wooden floor in a pink shirt, motion blurred, visor on.',
   'scene', NULL, 0, 130, '2026-09-20T00:00:00Z'),

  (14, 'mural-and-cat', 'my own mural',
   'a street mural under an overpass shows the cat face in orange and blue spray paint. the cat sits on the kerb below it in the same pose, visor on.',
   'scene', NULL, 0, 140, '2026-09-20T00:00:00Z'),

  (15, 'flying', 'above the clouds',
   'the cat glides high over a city with both paws stretched out in front and two striped party fireworks tied to its back. clouds in every direction, visor on.',
   'scene', NULL, 0, 150, '2026-09-20T00:00:00Z');

-- ---------------------------------------------------------------------------
-- posts: 5 bài đã đăng, viết lại theo VOICE.md. url là khoá chống trùng.
-- Bài 1 ghim vĩnh viễn: đây là poster truy nã, bài giới thiệu nhân vật.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO posts (id, posted_at, body, views, url, pinned) VALUES
  (1, '2026-09-08T13:27:04Z',
   'wanted.

name: $ZECAT
identity: unknown
eyes: redacted
location: shielded
birthplace: shld.fun

crime: being the first token ever launched on @SHLDdotfun

nobody knows. 🛡️',
   '2.9k', 'https://x.com/ZecatZcash/status/2097315787010936926', 1),

  (2, '2026-09-18T14:02:50Z',
   'everyone out there is running around.

busy. loud. very online.

not one of them has noticed the thing already moving.

nobody knows.',
   '848', 'https://x.com/ZecatZcash/status/2100948668342030832', 0),

  (3, '2026-09-19T04:35:28Z',
   'interesting.

every sign is pointing the same way.

ZEC season.

the cat does not explain.',
   '823', 'https://x.com/ZecatZcash/status/2101168271525601470', 0),

  (4, '2026-09-19T16:18:10Z',
   'soon you will understand why.

the visor stays on.',
   '323', 'https://x.com/ZecatZcash/status/2101345110785216721', 0),

  (5, '2026-09-19T20:51:38Z',
   '$ZECAT does not want you to become someone else''s exit liquidity.

experimental, interact at your own risk.

9 lives, 0 sells. 🐾',
   '143', 'https://x.com/ZecatZcash/status/2101413934301696033', 0);

-- ---------------------------------------------------------------------------
-- submissions: để trống. Đây là hàng đợi, form trên site ghi vào.
-- Mẫu dưới đây chỉ để thấy shape, đừng bỏ dấu chú thích.
-- id và created_at tự sinh, status mặc định là 'pending'.
-- ---------------------------------------------------------------------------
-- INSERT INTO submissions (handle, url, note) VALUES
--   ('@somecat', 'https://x.com/somecat/status/2101413934301696033', 'drew this in ms paint. the visor is on.');
