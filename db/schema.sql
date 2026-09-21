-- $ZECAT site database. Cloudflare D1 (SQLite).
--
-- Áp dụng (chạy từ thư mục site/):
--   wrangler d1 execute zecat --remote --file=./db/schema.sql
--   wrangler d1 execute zecat --remote --file=./db/seed.sql
--
-- Chạy lại được nhiều lần: mọi thứ đều IF NOT EXISTS.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- memes: thư viện ảnh của site.
-- slug khớp với site/public/meme/<slug>.jpg và site/public/thumb/<slug>.jpg
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memes (
  id         INTEGER PRIMARY KEY,
  slug       TEXT    NOT NULL UNIQUE,
  title      TEXT    NOT NULL,
  alt        TEXT    NOT NULL,
  tag        TEXT    NOT NULL CHECK (tag IN ('poster', 'scene', 'video')),
  credit     TEXT,
  featured   INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  sort       INTEGER NOT NULL DEFAULT 0,
  -- 1 = ảnh nằm trong D1 (upload qua khu quản trị), phục vụ bởi /api/meme-image
  -- 0 = ảnh nằm trong repo tại public/meme/<slug>.jpg
  stored     INTEGER NOT NULL DEFAULT 0 CHECK (stored IN (0, 1)),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- thứ tự hiển thị mặc định của lưới ảnh
CREATE INDEX IF NOT EXISTS idx_memes_sort     ON memes (sort);
-- lấy ba ảnh đầu trang
CREATE INDEX IF NOT EXISTS idx_memes_featured ON memes (featured, sort);
-- lọc theo tab poster / scene / video
CREATE INDEX IF NOT EXISTS idx_memes_tag      ON memes (tag, sort);

-- ---------------------------------------------------------------------------
-- posts: bài đã đăng trên X, dựng lại thành feed tĩnh trên site.
-- views để TEXT vì nó là nhãn hiển thị ('2.9k'), không phải số để tính toán.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
  id        INTEGER PRIMARY KEY,
  posted_at TEXT    NOT NULL,
  body      TEXT    NOT NULL,
  views     TEXT,
  url       TEXT    NOT NULL UNIQUE,
  pinned    INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))
);

-- feed: bài ghim lên trước, còn lại mới nhất trước
CREATE INDEX IF NOT EXISTS idx_posts_feed   ON posts (pinned DESC, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_recent ON posts (posted_at DESC);

-- ---------------------------------------------------------------------------
-- submissions: meme cộng đồng gửi lên, nằm ở 'pending' đến khi có người duyệt.
-- Không để UNIQUE trên url: hai người gửi trùng link là chuyện của moderator.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS submissions (
  id         INTEGER PRIMARY KEY,
  handle     TEXT,
  url        TEXT    NOT NULL,
  note       TEXT,
  status     TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- hàng đợi duyệt: cũ nhất lên trước
CREATE INDEX IF NOT EXISTS idx_submissions_queue ON submissions (status, created_at);
-- kiểm trùng link trước khi ghi
CREATE INDEX IF NOT EXISTS idx_submissions_url   ON submissions (url);

-- ---------------------------------------------------------------------------
-- meme_blobs: byte của ảnh upload, base64.
--
-- Vì sao ảnh nằm trong database thay vì một dịch vụ lưu trữ riêng: site này
-- đã dùng D1 rồi, và thêm R2 nghĩa là thêm một bucket, một API token, và một
-- thứ nữa phải nhớ gia hạn. Trình duyệt đã thu nhỏ và nén ảnh trước khi gửi
-- nên mỗi tấm chỉ vài chục KB. Với cỡ đó, một hàng trong SQLite là đủ.
--
-- Không có khóa ngoại tới memes: ảnh được ghi TRƯỚC hàng meme, để tường ảnh
-- không bao giờ hiện một ô trống.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meme_blobs (
  slug       TEXT    NOT NULL,
  variant    TEXT    NOT NULL CHECK (variant IN ('thumb', 'full')),
  mime       TEXT    NOT NULL,
  w          INTEGER NOT NULL DEFAULT 0,
  h          INTEGER NOT NULL DEFAULT 0,
  data       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (slug, variant)
);

-- ---------------------------------------------------------------------------
-- admin: đúng một hàng, giữ mật khẩu của khu quản trị.
--
-- Ở đây KHÔNG có mật khẩu. Chỉ có scrypt hash và salt của nó. Đặt hoặc đổi
-- mật khẩu bằng:
--
--   node tools/set-password.mjs
--
-- Lệnh đó đọc mật khẩu từ bàn phím, không hiện lên màn hình, không ghi vào
-- lịch sử shell, và in ra đúng một câu lệnh SQL để dán vào wrangler.
--
-- token_version: mỗi lần đổi mật khẩu thì số này tăng, và mọi phiên đang mở
-- trên máy khác chết ngay lập tức.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  pass_hash     TEXT    NOT NULL,
  pass_salt     TEXT    NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- NẾU database đã được tạo TRƯỚC khi có khu quản trị, chạy thêm một dòng này
-- một lần. Chạy trên database mới sẽ báo "duplicate column name", bỏ qua được.
--
--   wrangler d1 execute zecat --remote --command "ALTER TABLE memes ADD COLUMN stored INTEGER NOT NULL DEFAULT 0"
-- ---------------------------------------------------------------------------
