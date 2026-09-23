# $ZECAT website

This repository is the `site/` directory. It contains the public website, Vercel API routes, Cloudflare D1 schema, and maintenance tools. The parent workspace is outside this repository. Do not copy private files into `site/`.

The production site is [zecat.st](https://zecat.st). Vercel serves `public/` as a static site and runs the functions in `api/`. The site has no build or install step and no npm dependencies.

## Local development and checks

Run these commands from `site/`:

```bash
node tools/dev-server.mjs
node tools/test-admin.mjs
node tools/sync-data.mjs
```

The development server listens on `http://localhost:8099`. The admin test suite currently has 50 checks. After editing website copy, run `node tools/check.js` from the parent project directory; it must report `KHONG CO LOI`. Re-running `sync-data.mjs` without content changes should leave the Git diff unchanged.

Do not run `sync-data.mjs --tape` merely to deploy. It refreshes the market snapshot and changes published data. To change the production origin, use `node tools/sync-data.mjs --origin https://NEW-DOMAIN` from `site/` and review the generated diff.

## Deployment

Push `main` over HTTPS. The Vercel project uses root `./`, framework preset `Other`, output directory `public`, and empty build and install commands. The production domain is `zecat.st`.

The `public/` directory contains the page, CSS, JavaScript, images, and static JSON fallbacks. The `api/` directory serves live market data and D1-backed content when available. If D1 is unavailable, content routes use the JSON files in `public/data/`.

Do not put passwords, API tokens, local environment files, or personal contact information in Git. `.env.example` lists variable names with empty values. Store actual values only in the hosting provider's environment settings. The project uses `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `CF_API_TOKEN`, and `ADMIN_SECRET` when D1-backed administration is enabled.

## Gallery and posts

The HTML includes 37 images so the gallery works without JavaScript. JavaScript adds pagination with 10 images per page, lightbox navigation, and any additional approved images stored in D1. D1 content can change the live total without a code deployment. The Posts section uses the X timeline when it renders successfully and keeps a readable archive as its fallback.

For a new image stored in the repository, add matching JPEGs to `public/meme/` and `public/thumb/`, add a tile to `public/index.html`, then run `node tools/sync-data.mjs`. Check the generated JSON and dimensions before committing.

## Administration and security

The admin API requires both D1 and a sufficiently long `ADMIN_SECRET`; otherwise it is unavailable. Password hashes and salts live in D1, never in the repository. Session cookies are `HttpOnly`, `Secure`, and `SameSite=Strict`. Changing the password increments the session version and invalidates earlier sessions.

`node tools/set-password.mjs` reads a new password interactively and prints a D1 command containing a salted hash. It also displays a newly generated `ADMIN_SECRET`. Execute the database command only in the intended Cloudflare account; do not replace an existing `ADMIN_SECRET` unless you intend to invalidate every active session. Never paste the generated output into a commit, issue, or chat.

Before a production push, run the copy check and admin tests, verify the generated data is stable, review the staged diff, and inspect the live site on desktop and mobile. The Content Security Policy in `vercel.json` is part of the security boundary; review any change to it carefully.
