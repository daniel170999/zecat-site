-- SINH TU DONG boi tools/sync-data.mjs. Dung sua tay.
-- Nguon that la public/index.html; hai file public/data/*.json nam giua.
--
-- Ap dung (chay tu thu muc site/):
--   npx wrangler d1 execute zecat --remote --file=./db/schema.sql
--   npx wrangler d1 execute zecat --remote --file=./db/seed.sql
--
-- Than bai dang la BAN LUU cua nhung gi da dang tren X. Giu nguyen van,
-- ke ca chu thuong. Sua chu trong do la lam sai ban luu.
--
-- O day khong co mat khau. Bang admin duoc dat bang tools/set-password.mjs.

INSERT OR IGNORE INTO memes (id, slug, title, alt, tag, credit, featured, sort, stored) VALUES
  (1, 'wanted-on-zcash', 'Wanted on Zcash', 'A pinned wanted poster reading wanted on Zcash, with a mugshot of the tabby cat in dark sunglasses holding a board that says ZECAT.', 'poster', NULL, 1, 10, 0),
  (2, 'cant-dox-the-cat', 'You cannot dox the cat', 'The tabby cat in dark sunglasses beside lettering about being impossible to identify.', 'poster', NULL, 1, 20, 0),
  (3, 'zero-identity', 'Zero identity', 'The tabby cat in dark sunglasses on a near black ground with gold lettering.', 'poster', NULL, 1, 30, 0),
  (4, 'born-at-SHLD-FUN', 'Born at shld.fun', 'The tabby cat in dark sunglasses with gold lettering naming shld.fun as his birthplace.', 'poster', NULL, 0, 40, 0),
  (5, 'selectively-active', 'Selectively active', 'The tabby cat in dark sunglasses, lying down, with gold lettering.', 'poster', NULL, 0, 50, 0),
  (6, 'the-ZECATfather', 'The Zecatfather', 'The tabby cat in dark sunglasses sitting behind a desk in a dim room, posed like a crime boss.', 'scene', NULL, 0, 60, 0),
  (7, 'newspaper', 'The morning paper', 'The tabby cat in dark sunglasses reading a newspaper.', 'scene', NULL, 0, 70, 0),
  (8, 'programmers-WAITING', 'The programmers wait', 'A wide dim room of screens with the tabby cat in dark sunglasses among them.', 'scene', NULL, 0, 80, 0),
  (9, 'alone-at-the-bar', 'Alone at the bar', 'The tabby cat in dark sunglasses sitting alone at a bar counter under a warm light.', 'scene', NULL, 0, 90, 0),
  (10, 'waiting-for-the-grill', 'Waiting for the grill', 'The tabby cat in dark sunglasses waiting beside a grill.', 'scene', NULL, 0, 100, 0),
  (11, 'floor-after-one-drink', 'One drink in', 'The tabby cat in dark sunglasses lying on the floor beside a glass.', 'scene', NULL, 0, 110, 0),
  (12, 'meditation', 'Meditation', 'The tabby cat in dark sunglasses sitting still in a calm pose.', 'scene', NULL, 0, 120, 0),
  (13, 'motorcycle', 'Night ride', 'The tabby cat in dark sunglasses on a motorcycle at night.', 'scene', NULL, 0, 130, 0),
  (14, 'mural-and-cat', 'The mural', 'The tabby cat in dark sunglasses in front of a tall painted wall.', 'scene', NULL, 0, 140, 0),
  (15, 'flying', 'Flying', 'The tabby cat in dark sunglasses up in the air over a dark ground.', 'scene', NULL, 0, 150, 0);

INSERT OR IGNORE INTO posts (id, posted_at, body, views, url, pinned) VALUES
  (1, '2026-09-08T00:00:00Z', 'wanted on Zcash

name: $ZECAT
identity: unknown
eyes: redacted
location: shielded
birthplace: shld.fun

crime: becoming the first meme coin on Zcash

the chase has begun. 🐈', '2.9k', 'https://x.com/ZecatZcash/status/2097315787010936926', 1),
  (2, '2026-09-07T00:00:00Z', '@SHLDdotfun has been live on @Zcash for 3 days. here is the complete walkthrough, every step.

funding, trading, slippage, patience.', '7.8k', 'https://x.com/ZecatZcash/status/2096742356544598058', 0),
  (3, '2026-09-18T00:00:00Z', 'everyone is running around, unaware that something big is brewing.', '848', 'https://x.com/ZecatZcash/status/2100948668342030832', 0),
  (4, '2026-09-19T00:00:00Z', 'interesting. all signs point to zec season.', '823', 'https://x.com/ZecatZcash/status/2101168271525601470', 0),
  (5, '2026-09-19T00:00:00Z', '$ZECAT does not want you to become somebody else''s exit liquidity.', '143', 'https://x.com/ZecatZcash/status/2101413934301696033', 0);
