-- $ZECAT site database. Cloudflare D1 (SQLite).
--
-- Apply from the site/ directory:
--   wrangler d1 execute zecat --remote --file=./db/schema.sql
--   wrangler d1 execute zecat --remote --file=./db/seed.sql
--
-- Safe to run repeatedly: every table and index uses IF NOT EXISTS.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- memes: the site's image library.
-- A slug matches public/meme/<slug>.jpg and public/thumb/<slug>.jpg.
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
  -- 1 = image uploaded to D1 and served through /api/meme-image
  -- 0 = image stored in the repository under public/meme/<slug>.jpg
  stored     INTEGER NOT NULL DEFAULT 0 CHECK (stored IN (0, 1)),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Default gallery order.
CREATE INDEX IF NOT EXISTS idx_memes_sort     ON memes (sort);
-- Featured images first.
CREATE INDEX IF NOT EXISTS idx_memes_featured ON memes (featured, sort);
-- Filter by poster, scene, or video tab.
CREATE INDEX IF NOT EXISTS idx_memes_tag      ON memes (tag, sort);

-- ---------------------------------------------------------------------------
-- posts: published X posts reproduced in the site's static feed.
-- views is TEXT because it is a display label (such as '2.9k').
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
  id        INTEGER PRIMARY KEY,
  posted_at TEXT    NOT NULL,
  body      TEXT    NOT NULL,
  views     TEXT,
  url       TEXT    NOT NULL UNIQUE,
  pinned    INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))
);

-- Show pinned posts first, then the newest remaining posts.
CREATE INDEX IF NOT EXISTS idx_posts_feed   ON posts (pinned DESC, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_recent ON posts (posted_at DESC);

-- ---------------------------------------------------------------------------
-- submissions: community memes remain pending until a moderator reviews them.
-- Duplicate URLs are allowed so moderators can review each submission.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS submissions (
  id         INTEGER PRIMARY KEY,
  handle     TEXT,
  url        TEXT    NOT NULL,
  note       TEXT,
  status     TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Review queue, oldest first.
CREATE INDEX IF NOT EXISTS idx_submissions_queue ON submissions (status, created_at);
-- Look up duplicate links before inserting.
CREATE INDEX IF NOT EXISTS idx_submissions_url   ON submissions (url);

-- ---------------------------------------------------------------------------
-- meme_blobs: base64-encoded uploaded image bytes.
--
-- Images live in D1 because the browser resizes and compresses each image
-- before upload. Each variant is small enough for a SQLite row, avoiding
-- another storage service and another credential.
--
-- There is no foreign key to memes: image bytes are written before the meme
-- row so the public gallery never points to a missing image.
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
-- admin: one row containing the administrator's password verifier.
--
-- No plaintext password is stored here, only a scrypt hash and salt.
-- Set or change it with:
--
--   node tools/set-password.mjs
--
-- The tool reads a password without echoing it or storing it in shell history.
-- It prints a Wrangler SQL command and, separately, a fresh ADMIN_SECRET.
--
-- Incrementing token_version after a password change invalidates old sessions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  pass_hash     TEXT    NOT NULL,
  pass_salt     TEXT    NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- For a database created before the admin area, run this migration once.
-- A new database already has this column and will report "duplicate column name".
--
--   wrangler d1 execute zecat --remote --command "ALTER TABLE memes ADD COLUMN stored INTEGER NOT NULL DEFAULT 0"
-- ---------------------------------------------------------------------------
