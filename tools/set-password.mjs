/* ===========================================================================
   set-password.mjs  -  set or reset the admin password
   ---------------------------------------------------------------------------
       node tools/set-password.mjs

   This tool reads a password without echoing it. It does not write the
   password to a file, shell history, or the repository. It prints a SQL
   command containing only the salted scrypt hash, and a fresh signing key.

   Do not pass passwords as command-line arguments: they appear in shell
   history, process lists, and potentially CI logs.

   Hashing uses the same parameters as api/_auth.js.
   =========================================================================== */

import { createInterface } from 'node:readline';
import crypto from 'node:crypto';
import { hashPassword, newSalt } from '../api/_auth.js';

/** Keep this in sync with MIN_PASSWORD in api/admin.js. */
const MIN = 12;

/**
 * Read one line from the terminal without echoing characters.
 * Raw mode handles each keypress without another dependency.
 */
function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new Error('Run this command directly in an interactive terminal.'));
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
        if (code === 13 || code === 10) return done(null, value);          // Enter
        if (code === 3) return done(new Error('Cancelled.'));               // Ctrl+C
        if (code === 127 || code === 8) { value = value.slice(0, -1); continue; } // Backspace
        if (code < 32) continue;                                            // Control keys
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
console.log('  Set the $ZECAT admin password.');
console.log('  Your password will not appear on screen.');
console.log('');

let password;
try {
  password = await askHidden('  New password:       ');
  const again = await askHidden('  Repeat password:    ');
  if (password !== again) {
    console.error('\n  Passwords do not match. Nothing was written.\n');
    process.exit(1);
  }
} catch (err) {
  console.error('\n  ' + err.message + '\n');
  process.exit(1);
}

if (password.length < MIN) {
  console.error('\n  At least ' + MIN + ' characters are required. Nothing was written.\n');
  process.exit(1);
}

/* Warn about predictable patterns without storing the password. */
const weak = /^[a-z]+[0-9]{1,6}[^a-z0-9]?$/i.test(password);
if (weak) {
  console.log('');
  console.log('  This password follows a common guessed pattern. A passphrase made');
  console.log('  from four random words would be much stronger.');
  const go = await ask('  Use this password anyway? (y/N) ');
  if (go.toLowerCase() !== 'y') { console.log('\n  Cancelled. Nothing was written.\n'); process.exit(1); }
}

const salt = newSalt();
const hash = hashPassword(password, salt);
password = null;                                   // Release plaintext as soon as possible.

const now = new Date().toISOString();

/* Increment token_version on reset so existing sessions become invalid.
   The first password starts with version 1. */
const sql =
  "INSERT INTO admin (id, pass_hash, pass_salt, token_version, updated_at) " +
  "VALUES (1, '" + hash + "', '" + salt + "', 1, '" + now + "') " +
  "ON CONFLICT(id) DO UPDATE SET pass_hash = excluded.pass_hash, " +
  "pass_salt = excluded.pass_salt, token_version = admin.token_version + 1, " +
  "updated_at = excluded.updated_at";

console.log('');
console.log('  Run this command from the site/ directory:');
console.log('');
console.log('  npx wrangler d1 execute zecat --remote --command "' + sql + '"');
console.log('');
console.log('  The command contains a salted hash, not the plaintext password.');
console.log('');

/* The tool cannot read Vercel's current environment settings. This new key
   is only for first-time setup or intentional key rotation. */
console.log('  Use the following key only if ADMIN_SECRET has not been set.');
console.log('  Replacing an existing ADMIN_SECRET signs out every active session.');
console.log('');
console.log('    ADMIN_SECRET = ' + crypto.randomBytes(32).toString('base64url'));
console.log('');
console.log('  This key signs session tokens. Without it, the admin area is disabled.');
console.log('  Keep the key only in the Vercel environment settings.');
console.log('');
